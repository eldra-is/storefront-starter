import {
  customerHeaders,
  type EldraCustomerMembership,
  type EldraRequestContext,
} from '@eldrajs/sdk';

/**
 * Customer prices: the pure parts. A signed-in business customer's catalog reads and cart writes go
 * through the Nitro routes in server/api/catalog and server/api/cart, which attach the session's
 * access token and the active company; a guest's go from the browser straight to the gateway, as
 * before. Nothing priced is ever cached: see `PRICED_RESPONSE_HEADERS`.
 */

/**
 * Every answer of a priced route, the signed-out ones and the errors too: the same URL answers
 * another company's prices for the next person, so no cache (browser, proxy, CDN) may keep it.
 */
export const PRICED_RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
} as const;

/** What a signed-in page render sends: it carries one person's prices in its HTML and payload. */
export const SIGNED_IN_PAGE_CACHE_CONTROL = 'private, no-store';

/** The person behind a priced call, from the server session. Null is a guest. */
export interface PricedCaller {
  accessToken: string;
  /** The organization's UUID: the gateway refuses an alias in X-Org-Id on a shop token. */
  orgId: string;
  /** The active company; absent lets the gateway use the person's only company. */
  customerId?: string | null;
}

/**
 * The SDK context of a priced call. A guest (or a caller without a token) gets `undefined`: no
 * `Authorization` header at all, never an empty one, and the client's own organization id.
 */
export function pricedContext(caller: PricedCaller | null): EldraRequestContext | undefined {
  if (!caller?.accessToken) return undefined;
  return {
    orgId: caller.orgId || undefined,
    headers: customerHeaders(caller.accessToken, caller.customerId || undefined),
  };
}

/**
 * What to do when a signed-in priced call fails, read by the gateway's `errorId`:
 * - `end-session`: business login is off (`FEATURE_DISABLED`) or the token is no good (401). The
 *   session is ended and the call made once more as a guest.
 * - `drop-company`: the stored company is no longer one of the person's (`SHOP_CUSTOMER_NOT_MEMBER`).
 *   It is forgotten and the call made once more without it.
 * - `guest`: the person has no company (`SHOP_NO_MEMBERSHIP`), or, on a read, has several and has
 *   not chosen one (`SHOP_CUSTOMER_REQUIRED`). The call is made as a guest (list prices, shown
 *   without the company label) and the session is kept.
 * - `throw`: everything else, including `CUSTOMER_PRICES_UNAVAILABLE` and the cart's 409s. A failure
 *   never quietly turns into list prices.
 */
export type PricedFailure = 'end-session' | 'drop-company' | 'guest' | 'throw';

export function pricedFailure(error: unknown, kind: 'read' | 'write'): PricedFailure {
  const { status, errorId } = (error ?? {}) as { status?: unknown; errorId?: unknown };
  if (status === 401) return 'end-session';
  if (status === 403 && errorId === 'FEATURE_DISABLED') return 'end-session';
  if (status === 403 && errorId === 'SHOP_CUSTOMER_NOT_MEMBER') return 'drop-company';
  if (status === 403 && errorId === 'SHOP_NO_MEMBERSHIP') return 'guest';
  if (status === 409 && errorId === 'SHOP_CUSTOMER_REQUIRED' && kind === 'read') return 'guest';
  return 'throw';
}

export interface PricedRun<T> {
  kind: 'read' | 'write';
  caller: PricedCaller | null;
  /** Sets response headers; called first, so failures are never cached either. */
  setHeaders: (headers: Record<string, string>) => void;
  call: (context: EldraRequestContext | undefined) => Promise<T>;
  /** Ends the business session; `featureDisabled` also means the cached organization is stale. */
  endSession: (reason: { featureDisabled: boolean }) => Promise<void>;
  /** Forgets the stored active company. */
  dropCompany: () => Promise<void>;
}

/**
 * Runs a priced call: as the signed-in person when there is one, else as a guest. A refusal that
 * means the person cannot have customer prices here (see `pricedFailure`) is retried exactly once,
 * as a guest or without the stale company; anything else is thrown to the caller.
 */
export async function runPriced<T>(run: PricedRun<T>): Promise<T> {
  run.setHeaders({ ...PRICED_RESPONSE_HEADERS });
  const context = pricedContext(run.caller);
  if (!context || !run.caller) return run.call(undefined);
  try {
    return await run.call(context);
  } catch (error) {
    const failure = pricedFailure(error, run.kind);
    if (failure === 'end-session') {
      const { errorId } = (error ?? {}) as { errorId?: unknown };
      await run.endSession({ featureDisabled: errorId === 'FEATURE_DISABLED' });
      return run.call(undefined);
    }
    if (failure === 'guest') return run.call(undefined);
    if (failure === 'drop-company' && run.caller.customerId) {
      await run.dropCompany();
      return run.call(pricedContext({ ...run.caller, customerId: null }));
    }
    throw error;
  }
}

/** The status and the gateway's reason of a failed call, for a route to answer with (never the message). */
export interface RouteError {
  statusCode: number;
  data: { errorId?: string; code?: string };
}

export function routeErrorOf(error: unknown): RouteError {
  const { status, errorId, code } = (error ?? {}) as {
    status?: unknown;
    errorId?: unknown;
    code?: unknown;
  };
  const statusCode = typeof status === 'number' && status >= 400 && status < 600 ? status : 502;
  const data: RouteError['data'] = {};
  if (typeof errorId === 'string') data.errorId = errorId;
  if (typeof code === 'string') data.code = code;
  return { statusCode, data };
}

/** Companies a person can buy for: the gateway accepts INVITED and ACTIVE memberships. */
export function selectableCompanies(
  memberships: readonly EldraCustomerMembership[] | null | undefined
): EldraCustomerMembership[] {
  return (memberships ?? []).filter((m) => m.status === 'ACTIVE' || m.status === 'INVITED');
}

export type ActiveCompany =
  | { kind: 'chosen'; customerId: string }
  | { kind: 'only'; customerId: string }
  | { kind: 'choose' }
  | { kind: 'none' };

/**
 * The company a signed-in person buys for: the one they chose while it is still theirs, else their
 * only company, else they must choose (several) or have none.
 */
export function activeCompany(
  stored: string | null | undefined,
  memberships: readonly EldraCustomerMembership[] | null | undefined
): ActiveCompany {
  const companies = selectableCompanies(memberships);
  if (stored && companies.some((m) => m.customerId === stored))
    return { kind: 'chosen', customerId: stored };
  if (companies.length === 1) return { kind: 'only', customerId: companies[0]!.customerId };
  return companies.length > 1 ? { kind: 'choose' } : { kind: 'none' };
}

/** A company id from a form or JSON body, if it is one of the person's companies. */
export function chosenCompany(
  body: unknown,
  memberships: readonly EldraCustomerMembership[] | null | undefined
): string | null {
  const value = (body as { customerId?: unknown } | null)?.customerId;
  if (typeof value !== 'string') return null;
  return selectableCompanies(memberships).some((m) => m.customerId === value) ? value : null;
}

/** What the browser knows about pricing: never a token, only whether calls go through the server. */
export interface CustomerPricingState {
  /** A business session exists: catalog reads and cart writes go through the server routes. */
  signedIn: boolean;
  /** The active company, when known. */
  customerId: string | null;
  /** Signed in with several companies and none chosen yet: prices are list prices until they pick. */
  needsCompany: boolean;
}

export const SIGNED_OUT_PRICING: CustomerPricingState = {
  signedIn: false,
  customerId: null,
  needsCompany: false,
};

/**
 * The `useAsyncData` key of a catalog read. A signed-in person's key names the company, so a
 * payload or a client-side cache entry made for one company (or for a guest) is never reused for
 * another; a guest's key is unchanged.
 */
export function catalogKey(base: string, pricing: CustomerPricingState): string {
  if (!pricing.signedIn) return base;
  return `${base}:customer:${pricing.customerId ?? (pricing.needsCompany ? 'choose' : 'default')}`;
}

/** What the cart does about a refused write, by the gateway's (or the cart route's) reason. */
export type CartRefusal =
  /** The cart is bound to another company, or needs a sign-in: start a new one, and say so. */
  | 'new-cart-other-company'
  | 'new-cart-sign-in'
  | 'company-required'
  | 'prices-unavailable'
  | 'discount-not-for-customer-prices'
  | 'out-of-stock'
  | null;

export function cartRefusal(errorId: string | undefined): CartRefusal {
  switch (errorId) {
    case 'CART_CUSTOMER_MISMATCH':
      return 'new-cart-other-company';
    case 'CART_SIGN_IN_REQUIRED':
      return 'new-cart-sign-in';
    case 'SHOP_CUSTOMER_REQUIRED':
      return 'company-required';
    case 'CART_PRICES_UNAVAILABLE':
    case 'CUSTOMER_PRICES_UNAVAILABLE':
    case 'SHOP_LOGIN_UNAVAILABLE':
      return 'prices-unavailable';
    case 'CART_DISCOUNT_NOT_FOR_CUSTOMER_PRICES':
      return 'discount-not-for-customer-prices';
    case 'CART_INSUFFICIENT_STOCK':
    case 'CONFLICT':
      return 'out-of-stock';
    default:
      return null;
  }
}

/** A single string query value, else undefined (a repeated or missing parameter is ignored). */
export function queryString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/** Catalog lists are not paginated yet: at most 100 (README, Known limits). */
export const MAX_PAGE_SIZE = 100;

export function pageSizeOf(value: unknown): number {
  const size = Number(typeof value === 'string' ? value : NaN);
  return Number.isInteger(size) && size > 0 ? Math.min(size, MAX_PAGE_SIZE) : MAX_PAGE_SIZE;
}

const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128;

/** A line quantity from a request body: a whole number from 1 to 9,999, else null. */
export function quantityOf(body: unknown): number | null {
  const quantity = (body as { quantity?: unknown } | null)?.quantity;
  return typeof quantity === 'number' &&
    Number.isInteger(quantity) &&
    quantity >= 1 &&
    quantity < 10_000
    ? quantity
    : null;
}

/** The add-to-cart body the cart route forwards: only the known fields, checked; else null. */
export function addItemInput(
  body: unknown
): { productId: string; variantId: string; quantity: number; cartId?: string } | null {
  const { productId, variantId, cartId } = (body ?? {}) as Record<string, unknown>;
  const quantity = quantityOf(body);
  if (!isId(productId) || !isId(variantId) || quantity === null) return null;
  if (cartId !== undefined && !isId(cartId)) return null;
  return { productId, variantId, quantity, ...(cartId ? { cartId } : {}) };
}

/** The message key for the cart store's `lastError`, else `fallback`. */
export function cartErrorMessageKey(
  lastError: string | null | undefined,
  fallback: string
): string {
  switch (lastError) {
    case 'INSUFFICIENT_STOCK':
      return 'notEnoughStock';
    case 'COMPANY_REQUIRED':
      return 'companyRequired';
    case 'PRICES_UNAVAILABLE':
      return 'pricesUnavailable';
    case 'DISCOUNT_NOT_FOR_CUSTOMER_PRICES':
      return 'discountNotForCompanyPrices';
    default:
      return fallback;
  }
}

/** The message key telling the person why their cart was replaced, or null. */
export function cartNoticeKey(notice: CartRefusal): string | null {
  if (notice === 'new-cart-other-company') return 'newCartOtherCompany';
  if (notice === 'new-cart-sign-in') return 'newCartSignIn';
  return null;
}
