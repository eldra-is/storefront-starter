import { isError, type H3Event } from 'h3';
import type { EldraCustomerMe, EldraRequestContext } from '@eldrajs/sdk';
import { dropOrganizationCache } from '~~/app/utils/organization';
import {
  isSameOriginRequest,
  meFailure,
  meRequestContext,
  needsRefresh,
  toAccountResponse,
} from '~~/shared/utils/auth';
import type { ShopSession } from '~~/shared/utils/auth';
import {
  activeCompany,
  PRICED_RESPONSE_HEADERS,
  routeErrorOf,
  runPriced,
  selectableCompanies,
  SIGNED_OUT_PRICING,
  type CustomerPricingState,
  type PricedCaller,
} from '~~/shared/utils/customer-prices';
import { runBusiness } from '~~/shared/utils/sales-orders';

type ShopAuth = Awaited<ReturnType<typeof useShopAuth>>;
interface CurrentSession {
  sessionId: string;
  session: ShopSession;
}

/**
 * This request's session with an access token that is good for at least another minute. Null when
 * signed out. A refresh that ends the session ends it here and throws 401; an outage throws 502.
 */
export async function freshShopSession(
  event: H3Event,
  auth: Pick<ShopAuth, 'clientId' | 'clientSecret'>
): Promise<CurrentSession | null> {
  const current = await readShopSession(event);
  if (!current || !needsRefresh(current.session, Date.now())) return current;
  try {
    const session = await refreshShopSession(current.sessionId, current.session, auth);
    touchSessionCookie(event, current.sessionId, session);
    return { sessionId: current.sessionId, session };
  } catch (error) {
    const failure =
      error instanceof SessionRefreshError
        ? error.failure
        : { statusCode: 502 as const, endSession: false };
    if (failure.endSession) await endShopSession(event);
    await clearShopMe(current.sessionId);
    throw createError({ statusCode: failure.statusCode });
  }
}

/**
 * The signed-in person and their companies, from the 30-second cache or the gateway. Throws the
 * status `/api/auth/me` answers (see `meFailure`); FEATURE_DISABLED drops the cached organization.
 */
export async function loadShopMe(
  event: H3Event,
  auth: ShopAuth,
  current: CurrentSession
): Promise<EldraCustomerMe> {
  const cached = await readCachedMe(current.sessionId);
  if (cached) return toAccountResponse(cached);
  try {
    const me = toAccountResponse(
      await auth.eldra.customer.me(meRequestContext(auth.orgId, current.session.accessToken))
    );
    await cacheShopMe(current.sessionId, me);
    return me;
  } catch (error) {
    const failure = meFailure(error);
    // 404 is FEATURE_DISABLED: B2B was switched off, so the cached organization is stale. Drop it and
    // the header and /auth/login catch up at once instead of after five minutes.
    if (failure.statusCode === 404) dropOrganizationCache(auth.orgKey);
    if (failure.endSession) await endShopSession(event);
    await clearShopMe(current.sessionId);
    throw createError({ statusCode: failure.statusCode });
  }
}

/**
 * What the pages need to know: whether a business session exists, and which company it buys for.
 * With no stored choice the person's only company becomes the active one; with several they choose.
 * Never throws: anything it cannot work out leaves the person signed in without a company, and the
 * priced routes still decide per call.
 */
export async function readPricingState(event: H3Event): Promise<CustomerPricingState> {
  const auth = await useShopAuth(event);
  if (!auth.enabled) return SIGNED_OUT_PRICING;
  let current: CurrentSession | null;
  try {
    current = await freshShopSession(event, auth);
  } catch {
    current = await readShopSession(event);
  }
  if (!current) return SIGNED_OUT_PRICING;
  const stored = await readActiveCompany(current.sessionId);
  let memberships: EldraCustomerMe['memberships'] | null = null;
  try {
    memberships = (await loadShopMe(event, auth, current)).memberships;
  } catch (error) {
    // 404 is FEATURE_DISABLED: B2B was switched off, so the business session is ended here (as the
    // priced routes do) and the person continues as a guest.
    if ((error as { statusCode?: number }).statusCode === 404) {
      await endShopSession(event);
      return SIGNED_OUT_PRICING;
    }
    // The session may just have ended (401) or the gateway is down: keep what is stored and let the
    // priced routes decide per call.
    if (!(await readShopSession(event))) return SIGNED_OUT_PRICING;
    return {
      signedIn: true,
      customerId: stored,
      needsCompany: false,
      customerName: null,
      noCompany: false,
    };
  }
  const choice = activeCompany(stored, memberships);
  const nameOf = (id: string) =>
    memberships?.find((m) => m.customerId === id)?.customerName ?? null;
  if (choice.kind === 'chosen' || choice.kind === 'only') {
    if (choice.kind === 'only' && choice.customerId !== stored) {
      await saveActiveCompany(current.sessionId, current.session, choice.customerId).catch(
        () => undefined
      );
    }
    return {
      signedIn: true,
      customerId: choice.customerId,
      needsCompany: false,
      customerName: nameOf(choice.customerId),
      noCompany: false,
    };
  }
  // A stored company the person no longer belongs to is forgotten.
  if (stored) await clearActiveCompany(current.sessionId);
  return {
    signedIn: true,
    customerId: null,
    needsCompany: choice.kind === 'choose',
    customerName: null,
    noCompany: choice.kind === 'none',
  };
}

/** Refuses a write that does not come from this site's own pages (403), as the company choice. */
function requireSameOrigin(event: H3Event, auth: ShopAuth) {
  const sameOrigin = isSameOriginRequest({
    secFetchSite: getRequestHeader(event, 'sec-fetch-site'),
    origin: getRequestHeader(event, 'origin'),
    requestOrigin: auth.origin,
  });
  if (!sameOrigin) throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
}

/**
 * This request's session (refreshed when due), or null when signed out or when the refresh just
 * ended it (401). An outage refreshing the token is thrown (502).
 */
async function sessionOrGuest(event: H3Event, auth: ShopAuth): Promise<CurrentSession | null> {
  if (!auth.enabled) return null;
  try {
    return await freshShopSession(event, auth);
  } catch (error) {
    // 401: the refresh ended the session, so this person is a guest now; else an outage.
    if ((error as { statusCode?: number }).statusCode !== 401) throw error;
    return null;
  }
}

/**
 * What a failed signed-in call may do to the session: end it (dropping the cached organization when
 * B2B is off), forget the active company, and count the person's companies (from the cached /me) to
 * tell the two apart when the active company is no longer available.
 */
function sessionActions(event: H3Event, auth: ShopAuth, current: CurrentSession | null) {
  return {
    endSession: async ({ featureDisabled }: { featureDisabled: boolean }) => {
      if (featureDisabled) dropOrganizationCache(auth.orgKey);
      await endShopSession(event);
    },
    dropCompany: async () => {
      if (current) await clearActiveCompany(current.sessionId);
    },
    companyCount: async () => {
      if (!current) return 0;
      return selectableCompanies((await loadShopMe(event, auth, current)).memberships).length;
    },
  };
}

/**
 * A catalog read or a cart write for this request: as the signed-in person and their active
 * company, or as a guest. Sets `private, no-store` first, whatever happens next; a write must come
 * from this site's own pages (403 otherwise, as the company choice); retries once as a guest when
 * the person cannot have customer prices here (`runPriced`); answers any other failure with the
 * gateway's status and reason, never its message.
 */
export async function pricedCall<T>(
  event: H3Event,
  kind: 'read' | 'write',
  call: (eldra: ShopAuth['eldra'], context: EldraRequestContext | undefined) => Promise<T>
): Promise<T> {
  const setHeaders = (headers: Record<string, string>) => setResponseHeaders(event, headers);
  // Before anything can fail: an error answer is no more cacheable than a price.
  setHeaders({ ...PRICED_RESPONSE_HEADERS });
  const auth = await useShopAuth(event);
  if (kind === 'write') requireSameOrigin(event, auth);
  const current = await sessionOrGuest(event, auth);
  const caller: PricedCaller | null = current
    ? {
        accessToken: current.session.accessToken,
        orgId: auth.orgId,
        customerId: await readActiveCompany(current.sessionId),
      }
    : null;
  try {
    return await runPriced({
      kind,
      caller,
      setHeaders,
      call: (context) => call(auth.eldra, context),
      ...sessionActions(event, auth, current),
      // The gateway priced for the person's only company: name it from the (cached) /me, so the
      // browser binds its cart to the company the server used, not to its own possibly stale idea.
      resolveCustomer: async () => {
        if (!current) return null;
        const choice = activeCompany(null, (await loadShopMe(event, auth, current)).memberships);
        return choice.kind === 'only' ? choice.customerId : null;
      },
    });
  } catch (error) {
    const { statusCode, data } = routeErrorOf(error);
    throw createError({ statusCode, data });
  }
}

/**
 * Refuses a business write from another site (403) before its body is read, so a cross-site
 * POST is answered 403 whatever it carries. `businessCall` checks again; the check is cheap.
 */
export async function requireSameOriginWrite(event: H3Event): Promise<void> {
  setResponseHeaders(event, { ...PRICED_RESPONSE_HEADERS });
  requireSameOrigin(event, await useShopAuth(event));
}

/**
 * A sales-order or delivery-location call for this request: only as the signed-in person, always
 * for their active company (`runBusiness`); never as a guest. The active company is the stored
 * choice, else the person's only company (named from /me, so `X-Customer-Id` is always sent). Sets
 * `private, no-store` first; 404 while business login is off; a write must come from this site's
 * own pages (403). Failures answer the gateway's status and reason (and the order id or line a page
 * acts on), never its message.
 */
export async function businessCall<T>(
  event: H3Event,
  kind: 'read' | 'write',
  call: (eldra: ShopAuth['eldra'], context: EldraRequestContext) => Promise<T>
): Promise<T> {
  const setHeaders = (headers: Record<string, string>) => setResponseHeaders(event, headers);
  setHeaders({ ...PRICED_RESPONSE_HEADERS });
  const auth = await useShopAuth(event);
  if (!auth.enabled) throw createError({ statusCode: 404, statusMessage: 'Not found' });
  if (kind === 'write') requireSameOrigin(event, auth);
  try {
    const current = await sessionOrGuest(event, auth);
    let customerId = current ? await readActiveCompany(current.sessionId) : null;
    if (current && !customerId) {
      const choice = activeCompany(null, (await loadShopMe(event, auth, current)).memberships);
      if (choice.kind === 'only') {
        customerId = choice.customerId;
        await saveActiveCompany(current.sessionId, current.session, customerId).catch(
          () => undefined
        );
      }
    }
    const caller: PricedCaller | null = current
      ? { accessToken: current.session.accessToken, orgId: auth.orgId, customerId }
      : null;
    return await runBusiness({
      caller,
      setHeaders,
      call: (context) => call(auth.eldra, context),
      ...sessionActions(event, auth, current),
    });
  } catch (error) {
    // This site's own refusals (an outage refreshing the token, /me) already carry their status.
    if (isError(error)) throw error;
    const { statusCode, data } = routeErrorOf(error);
    throw createError({ statusCode, data });
  }
}
