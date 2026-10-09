import type { H3Event } from 'h3';
import type { EldraCustomerMe, EldraRequestContext } from '@eldrajs/sdk';
import { dropOrganizationCache } from '~~/app/utils/organization';
import { meFailure, meRequestContext, needsRefresh, toAccountResponse } from '~~/shared/utils/auth';
import type { ShopSession } from '~~/shared/utils/auth';
import {
  activeCompany,
  PRICED_RESPONSE_HEADERS,
  routeErrorOf,
  runPriced,
  SIGNED_OUT_PRICING,
  type CustomerPricingState,
  type PricedCaller,
} from '~~/shared/utils/customer-prices';

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

/**
 * A catalog read or a cart write for this request: as the signed-in person and their active
 * company, or as a guest. Sets `private, no-store` first, whatever happens next; retries once as a
 * guest when the person cannot have customer prices here (`runPriced`); answers any other failure
 * with the gateway's status and reason, never its message.
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
  let caller: PricedCaller | null = null;
  let sessionId: string | null = null;
  if (auth.enabled) {
    let current: CurrentSession | null = null;
    try {
      current = await freshShopSession(event, auth);
    } catch (error) {
      // 401: the refresh ended the session, so this person is a guest now; else an outage.
      if ((error as { statusCode?: number }).statusCode !== 401) throw error;
    }
    if (current) {
      sessionId = current.sessionId;
      caller = {
        accessToken: current.session.accessToken,
        orgId: auth.orgId,
        customerId: await readActiveCompany(current.sessionId),
      };
    }
  }
  try {
    return await runPriced({
      kind,
      caller,
      setHeaders,
      call: (context) => call(auth.eldra, context),
      endSession: async ({ featureDisabled }) => {
        if (featureDisabled) dropOrganizationCache(auth.orgKey);
        await endShopSession(event);
      },
      dropCompany: async () => {
        if (sessionId) await clearActiveCompany(sessionId);
      },
    });
  } catch (error) {
    const { statusCode, data } = routeErrorOf(error);
    throw createError({ statusCode, data });
  }
}
