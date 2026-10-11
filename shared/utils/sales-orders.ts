import {
  customerHeaders,
  EldraHttpError,
  type EldraCreateSalesOrderInput,
  type EldraRequestContext,
  type EldraSalesOrder,
  type EldraSalesOrderListOptions,
  type EldraSalesOrderPreviewInput,
  type EldraSalesOrderStatus,
} from '@eldrajs/sdk';
import {
  B2B_OFF_ERRORS,
  PRICED_RESPONSE_HEADERS,
  companiesFor,
  pricedFailure,
  type CustomerPricingState,
  type PricedCaller,
} from './customer-prices';

/**
 * Orders on account (B2B phase 5): the pure parts. A signed-in business customer places the
 * company's bound cart as a sales order from /checkout/account, and reads the company's orders on
 * /account/orders. Every call goes through the Nitro routes in server/api/sales-orders and
 * server/api/customer (`businessCall` in server/utils/customer-pricing.ts), which add the session's
 * token and the active company; nothing here ever runs as a guest.
 */

/** The gateway's limits on the create body (contract 2.18.0). */
export const PO_NUMBER_MAX_LENGTH = 40;
export const NOTE_MAX_LENGTH = 1000;
/** The gateway refuses a longer `Idempotency-Key`. */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;
/** Orders per history page; the gateway allows 1–50. */
export const ORDER_PAGE_SIZE = 20;
export const MAX_ORDER_PAGE_SIZE = 50;

export const SALES_ORDER_STATUSES: readonly EldraSalesOrderStatus[] = [
  'OPEN',
  'ON_HOLD',
  'PART_DELIVERED',
  'DELIVERED',
  'CANCELLED',
];

/** What a business route answers without a session: sign in again (the gateway's own reason). */
export const SIGN_IN_REQUIRED = 'SHOP_TOKEN_INVALID';
/** What it answers while the person has several companies and none is chosen. */
export const COMPANY_REQUIRED = 'SHOP_CUSTOMER_REQUIRED';

/** A refusal made here, before the gateway is called; `routeErrorOf` reads it like a gateway's. */
function refusal(status: number, errorId: string) {
  return Object.assign(new Error(errorId), { status, errorId });
}

/**
 * The SDK context of a business call: the token and the active company, always both. Null when
 * either is missing, so a call is never sent without `Authorization` or for a company the gateway
 * would pick itself.
 */
export function businessContext(caller: PricedCaller | null): EldraRequestContext | null {
  if (!caller?.accessToken || !caller.customerId) return null;
  return {
    orgId: caller.orgId || undefined,
    headers: customerHeaders(caller.accessToken, caller.customerId),
  };
}

export interface BusinessRun<T> {
  /** The person and their active company, from the server session; null when signed out. */
  caller: PricedCaller | null;
  /** Sets response headers; called first, so failures are never cached either. */
  setHeaders: (headers: Record<string, string>) => void;
  call: (context: EldraRequestContext) => Promise<T>;
  /** Ends the business session; `featureDisabled` also means the cached organization is stale. */
  endSession: (reason: { featureDisabled: boolean }) => Promise<void>;
  /** Forgets the stored active company. */
  dropCompany: () => Promise<void>;
  /** The companies the person can buy for; asked only when the active one is unavailable. */
  companyCount?: () => Promise<number>;
}

/**
 * Runs a business call as the signed-in person for their active company. Unlike `runPriced` it is
 * never retried, as a guest or for another company: an order is the company's or nothing.
 * - Signed out: 401 `SHOP_TOKEN_INVALID`, nothing sent. No company chosen: 409
 *   `SHOP_CUSTOMER_REQUIRED`, nothing sent.
 * - 401, B2B off (`FEATURE_DISABLED`, `ORDER_CUSTOMER_PRICES_OFF`) or the person's only company
 *   unavailable: the session is ended, and the refusal passed on.
 * - A company that is no longer the person's, or unavailable while they have others: that company is
 *   forgotten, the session kept, and the refusal passed on.
 * - Anything else, 502 `SALES_ORDER_UPSTREAM_REFUSED` and every outage included, is passed on.
 */
export async function runBusiness<T>(run: BusinessRun<T>): Promise<T> {
  run.setHeaders({ ...PRICED_RESPONSE_HEADERS });
  if (!run.caller?.accessToken) throw refusal(401, SIGN_IN_REQUIRED);
  const context = businessContext(run.caller);
  if (!context) throw refusal(409, COMPANY_REQUIRED);
  try {
    return await run.call(context);
  } catch (error) {
    const failure = pricedFailure(error, 'write', await companiesFor(error, run.companyCount));
    if (failure === 'end-session') {
      const { errorId } = (error ?? {}) as { errorId?: unknown };
      await run.endSession({ featureDisabled: B2B_OFF_ERRORS.has(String(errorId)) });
    } else if (failure === 'drop-company') {
      await run.dropCompany();
    }
    throw error;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/** An optional id from a body: absent or empty is undefined, a malformed one is `false`. */
function optionalUuid(value: unknown): string | undefined | false {
  if (value === undefined || value === null || value === '') return undefined;
  return isUuid(value) ? value : false;
}

/** An optional text field: trimmed, empty is undefined, too long or not text is `false`. */
function optionalText(value: unknown, max: number): string | undefined | false {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (!text) return undefined;
  return text.length <= max ? text : false;
}

/** A calendar date `YYYY-MM-DD` that exists. */
function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** The preview body the route forwards: the cart and an optional delivery location; else null. */
export function previewInput(body: unknown): EldraSalesOrderPreviewInput | null {
  const { cartId, locationId } = (body ?? {}) as Record<string, unknown>;
  if (!isUuid(cartId)) return null;
  const location = optionalUuid(locationId);
  if (location === false) return null;
  return { cartId, ...(location ? { locationId: location } : {}) };
}

/**
 * The create body the route forwards: only the fields the gateway takes, trimmed and checked
 * against its limits; else null. Never a company, a price or a line: those come from the session
 * and the supplier.
 */
export function createOrderInput(body: unknown): EldraCreateSalesOrderInput | null {
  const preview = previewInput(body);
  if (!preview) return null;
  const { purchaseOrderNumber, customerOrderDate, note } = (body ?? {}) as Record<string, unknown>;
  const po = optionalText(purchaseOrderNumber, PO_NUMBER_MAX_LENGTH);
  const text = optionalText(note, NOTE_MAX_LENGTH);
  const date = optionalText(customerOrderDate, 10);
  if (po === false || text === false || date === false) return null;
  if (date && !isDate(date)) return null;
  return {
    ...preview,
    ...(po ? { purchaseOrderNumber: po } : {}),
    ...(date ? { customerOrderDate: date } : {}),
    ...(text ? { note: text } : {}),
  };
}

/** The `Idempotency-Key` a create must carry: 1–255 visible ASCII characters, else null. */
export function idempotencyKeyOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!value.trim() || value.length > IDEMPOTENCY_KEY_MAX_LENGTH) return null;
  return /^[\x21-\x7e]+$/.test(value) ? value : null;
}

/** The history query the route forwards: a page from 1, a page size within 1–50, a known status. */
export function orderListQuery(query: Record<string, unknown>): EldraSalesOrderListOptions {
  const whole = (value: unknown) => {
    const n = Number(typeof value === 'string' ? value : NaN);
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  const status = SALES_ORDER_STATUSES.find((s) => s === query.status);
  return {
    page: whole(query.page) ?? 1,
    pageSize: Math.min(whole(query.pageSize) ?? ORDER_PAGE_SIZE, MAX_ORDER_PAGE_SIZE),
    ...(status ? { status } : {}),
  } as EldraSalesOrderListOptions;
}

/** A sales order id from a route parameter, else null. */
export function salesOrderParam(value: unknown): string | null {
  return isUuid(value) ? value : null;
}

/** The reason and details of a refused call: the SDK's error, or one of this site's routes. */
function problemOf(error: unknown): {
  status?: number;
  errorId?: string;
  salesOrderId?: unknown;
  variantId?: unknown;
  variantIds?: unknown;
} {
  if (error instanceof EldraHttpError) {
    const errors = (error.errors ?? {}) as Record<string, unknown>;
    return {
      status: error.status,
      errorId: error.errorId ?? error.code,
      salesOrderId: errors.salesOrderId,
      variantId: errors.variantId,
      variantIds: errors.variantIds,
    };
  }
  if (!error || typeof error !== 'object') return {};
  const { statusCode, status, data } = error as {
    statusCode?: unknown;
    status?: unknown;
    data?: { statusCode?: unknown; data?: Record<string, unknown> };
  };
  const body = data?.data ?? {};
  const code = [statusCode, status, data?.statusCode].find((v) => typeof v === 'number') as
    | number
    | undefined;
  const id = body.errorId ?? body.code;
  return {
    status: code,
    errorId: typeof id === 'string' ? id : undefined,
    salesOrderId: body.salesOrderId,
    variantId: body.variantId,
    variantIds: body.variantIds,
  };
}

/** The order a refused create says the cart already became, if it names one. */
export function salesOrderIdOf(error: unknown): string | undefined {
  const { salesOrderId } = problemOf(error);
  return typeof salesOrderId === 'string' && salesOrderId ? salesOrderId : undefined;
}

/**
 * What the checkout page does about a refused preview or create, and the message it shows (an i18n
 * key). Never a credit figure: the gateway sends none, and the message names none.
 * - `show`: say why; the person changes something (or contacts the supplier) and tries again.
 * - `retry`: no answer, a 5xx (502 `SALES_ORDER_UPSTREAM_REFUSED` included) or 429: try again with
 *   the same key, which replays an order that was placed.
 * - `to-guest`: the company can no longer buy at its prices: the server ended the session (or
 *   dropped the company when the person has others); the cart follows (a guest cart, or a choice).
 * - `rebind`: the cart is not bound to the company: replay its lines into a company cart.
 * - `open-order`: the cart is already that order.
 * - `reload-locations`: the delivery location is no longer the company's.
 * - `sign-in`: 401 only.
 * - `choose-company`: none chosen, or the chosen one is no longer the person's.
 */
export type SalesOrderRefusal =
  | { action: 'open-order'; salesOrderId: string }
  | {
      action:
        | 'show'
        | 'retry'
        | 'to-guest'
        | 'rebind'
        | 'reload-locations'
        | 'sign-in'
        | 'choose-company';
      message: string;
      /** SALES_ORDER_LINE_INVALID: the cart line that cannot be ordered. */
      variantId?: string;
      /** ORDER_PRODUCT_UNAVAILABLE: the cart lines no longer sold. */
      variantIds?: string[];
    };

export function salesOrderRefusal(error: unknown): SalesOrderRefusal {
  const { status, errorId, variantId, variantIds } = problemOf(error);
  switch (errorId) {
    case 'CUSTOMER_BLOCKED':
      return { action: 'show', message: 'salesOrderBlocked' };
    case 'SALES_ORDER_CREDIT_LIMIT_EXCEEDED':
      return { action: 'show', message: 'salesOrderCreditLimit' };
    case 'ORDER_CUSTOMER_PRICES_OFF':
      return { action: 'to-guest', message: 'salesOrderCompanyUnavailable' };
    case 'ORDER_CUSTOMER_UNAVAILABLE':
      // Neutral until who is buying is read again (companyGoneMessage): the session may have
      // ended (list prices) or only this company was dropped (choose another).
      return { action: 'to-guest', message: 'salesOrderCompanyGone' };
    case 'SALES_ORDER_CART_NOT_BOUND':
      return { action: 'rebind', message: 'salesOrderCartRebound' };
    case 'SALES_ORDER_CART_ALREADY_ORDERED': {
      const id = salesOrderIdOf(error);
      return id
        ? { action: 'open-order', salesOrderId: id }
        : { action: 'show', message: 'salesOrderAlreadyOrdered' };
    }
    case 'SALES_ORDER_LOCATION_UNKNOWN':
      return { action: 'reload-locations', message: 'salesOrderLocationUnknown' };
    case 'SALES_ORDER_LINE_INVALID':
      return typeof variantId === 'string' && variantId
        ? { action: 'show', message: 'salesOrderLineInvalid', variantId }
        : { action: 'show', message: 'salesOrderLineInvalid' };
    case 'ORDER_PRODUCT_UNAVAILABLE': {
      const ids = Array.isArray(variantIds)
        ? variantIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [];
      return ids.length
        ? { action: 'show', message: 'salesOrderProductUnavailable', variantIds: ids }
        : { action: 'show', message: 'salesOrderProductUnavailable' };
    }
    case 'SALES_ORDER_NOT_FOUND':
      return { action: 'show', message: 'orderNotFound' };
    case 'ORIGIN_NOT_REGISTERED':
      return { action: 'show', message: 'salesOrderOriginNotRegistered' };
    case 'SALES_ORDER_CART_UNAVAILABLE':
      return { action: 'retry', message: 'salesOrderCartUnavailable' };
    case 'SHOP_LOGIN_UNAVAILABLE':
      return { action: 'retry', message: 'salesOrderLoginUnavailable' };
    case 'SALES_ORDER_CART_EMPTY':
    case 'CART_NOT_FOUND':
      return { action: 'show', message: 'emptyCart' };
    case 'SALES_ORDER_TOO_MANY_LINES':
      return { action: 'show', message: 'salesOrderTooManyLines' };
    case 'SALES_ORDER_TERMS_UNAVAILABLE':
    case 'SALES_ORDER_CREDIT_CHECK_UNAVAILABLE':
    case 'ORDER_PRICES_UNAVAILABLE':
      return { action: 'retry', message: 'salesOrderTermsUnavailable' };
    case 'SHOP_CUSTOMER_REQUIRED':
    case 'SHOP_CUSTOMER_NOT_MEMBER':
      return { action: 'choose-company', message: 'companyRequired' };
    case 'ORDER_IDEMPOTENCY_CONFLICT':
      return { action: 'show', message: 'salesOrderChanged' };
    case 'FEATURE_DISABLED':
      return { action: 'to-guest', message: 'salesOrderUnavailable' };
    case 'SHOP_NO_MEMBERSHIP':
      return { action: 'show', message: 'noMembership' };
  }
  if (status === 401) return { action: 'sign-in', message: 'salesOrderSignIn' };
  if (mayHavePlaced(status)) return { action: 'retry', message: 'salesOrderRetry' };
  return { action: 'show', message: 'salesOrderFailed' };
}

/**
 * The message after a company refusal (`to-guest`), once who is buying has been read again: the
 * person still signed in but choosing (only this company was dropped) is asked to choose another;
 * a person now signed out buys at list prices; otherwise the refusal's own message stands.
 */
export function companyGoneMessage(message: string, pricing: CustomerPricingState): string {
  if (pricing.signedIn && pricing.needsCompany) return 'salesOrderCompanyChooseAnother';
  if (!pricing.signedIn) return 'salesOrderCompanyUnavailable';
  return message;
}

/**
 * Whether a refused create should be followed by a fresh preview: after a credit or blocked
 * refusal the preview's `credit.wouldBlock` (or its own refusal) then decides whether placing is
 * offered, instead of leaving the button on for a retry that cannot pass. A refused preview is
 * never followed by another, or a blocked customer's page would ask until it is rate limited.
 */
export function refreshesPreview(
  refusal: SalesOrderRefusal,
  /** What was refused. Only a create asks for a preview: a refused preview never asks for another. */
  from: 'create' | 'preview'
): boolean {
  return (
    from === 'create' &&
    refusal.action === 'show' &&
    (refusal.message === 'salesOrderCreditLimit' || refusal.message === 'salesOrderBlocked')
  );
}

/**
 * Previews asked one after another (the location changed meanwhile) can answer out of order. Each
 * call gets a number; only the answer of the latest counts, and `loading` stays true until every
 * call has settled, so Place order is never enabled beside a preview still on its way.
 */
export interface PreviewSequence {
  start(): number;
  settle(token: number): boolean;
  readonly loading: boolean;
}

export function createPreviewSequence(): PreviewSequence {
  let latest = 0;
  let inFlight = 0;
  return {
    start() {
      inFlight += 1;
      latest += 1;
      return latest;
    },
    settle(token) {
      inFlight = Math.max(0, inFlight - 1);
      return token === latest;
    },
    get loading() {
      return inFlight > 0;
    },
  };
}

/** Runs one preview through the sequence; `latest` says whether its answer (or refusal) counts. */
export async function latestAnswer<T>(
  sequence: PreviewSequence,
  call: () => Promise<T>
): Promise<{ latest: boolean; value?: T; error?: unknown }> {
  const token = sequence.start();
  try {
    const value = await call();
    return { latest: sequence.settle(token), value };
  } catch (error) {
    return { latest: sequence.settle(token), error };
  }
}

/**
 * Why the order history or an order cannot be read, for a 403 or 409 (401 is a sign-in, 404 not
 * found): choose a company only when that is the reason; business login off or no membership say
 * so instead. `linkToAccount` offers the account page, where companies are chosen.
 */
export function readRefusal(error: unknown): { message: string; linkToAccount: boolean } {
  const refusal = salesOrderRefusal(error);
  if (refusal.action === 'choose-company')
    return { message: 'companyRequired', linkToAccount: true };
  if (refusal.action === 'to-guest' && refusal.message === 'salesOrderUnavailable') {
    return { message: 'salesOrderUnavailable', linkToAccount: false };
  }
  if (refusal.action === 'show' && refusal.message === 'noMembership') {
    return { message: 'noMembership', linkToAccount: true };
  }
  return { message: 'ordersError', linkToAccount: false };
}

/** No answer, a 5xx or a rate limit: an order may have been placed (or nothing was done). */
function mayHavePlaced(status: number | undefined): boolean {
  return status === undefined || status >= 500 || status === 429;
}

/**
 * One checkout attempt: the `Idempotency-Key` its create carries, and what it was minted for. Kept
 * in session storage (per tab, gone when the tab closes) under CHECKOUT_ATTEMPT_KEY.
 */
export interface CheckoutAttempt {
  key: string;
  fingerprint: string;
}

export const CHECKOUT_ATTEMPT_KEY = 'storefront-starter.salesOrderAttempt';

export interface CheckoutForm {
  locationId: string;
  purchaseOrderNumber: string;
  customerOrderDate: string;
  note: string;
}

/** What a key is minted for: the cart (id and version, so any cart change) and the whole form. */
export function attemptFingerprint(input: {
  cartId: string;
  cartVersion: number | string | null | undefined;
  form: CheckoutForm;
}): string {
  const { form } = input;
  return JSON.stringify([
    input.cartId,
    input.cartVersion ?? null,
    form.locationId.trim(),
    form.purchaseOrderNumber.trim(),
    form.customerOrderDate.trim(),
    form.note.trim(),
  ]);
}

/**
 * The attempt a submit uses: the stored one while the cart and the form are unchanged (a retry
 * after no answer or a 5xx replays an order that was placed), else a new key.
 */
export function attemptFor(
  stored: CheckoutAttempt | null,
  fingerprint: string,
  mint: () => string
): CheckoutAttempt {
  if (stored && stored.fingerprint === fingerprint) return stored;
  return { key: mint(), fingerprint };
}

/**
 * The attempt to keep after a submit: kept when the answer may follow a placed order (no answer, a
 * 5xx, 429), so the next submit retries with the same key; spent (null) after an order or any other
 * refusal, so the next submit is a new attempt with a new key.
 */
export function attemptAfter(attempt: CheckoutAttempt, error: unknown): CheckoutAttempt | null {
  if (!error) return null;
  return mayHavePlaced(problemOf(error).status) ? attempt : null;
}

/** A stored attempt, when it is well formed. */
export function readAttempt(raw: string | null | undefined): CheckoutAttempt | null {
  if (!raw) return null;
  try {
    const { key, fingerprint } = JSON.parse(raw) as Partial<CheckoutAttempt>;
    if (idempotencyKeyOf(key) && typeof fingerprint === 'string') return { key: key!, fingerprint };
  } catch {
    // Not ours, or damaged: start a new attempt.
  }
  return null;
}

export interface ReorderLine {
  productId: string;
  variantId: string;
  quantity: number;
}

/** The cart's largest line quantity (`quantityOf`). */
const MAX_LINE_QUANTITY = 9_999;

/**
 * "Order again": the order's lines as cart lines at the quantity ordered, whether delivered or
 * still on backorder, one per variant. Lines with no product or variant any more cannot be added
 * and are counted in `skipped`. The cart then prices them at today's terms.
 */
export function reorderLines(order: Pick<EldraSalesOrder, 'lines'>): {
  lines: ReorderLine[];
  skipped: number;
} {
  const byVariant = new Map<string, ReorderLine>();
  let skipped = 0;
  for (const line of order.lines ?? []) {
    const { productId, variantId, quantity } = line;
    if (!productId || !variantId || !Number.isInteger(quantity) || quantity < 1) {
      skipped += 1;
      continue;
    }
    const existing = byVariant.get(variantId);
    if (existing) existing.quantity = Math.min(existing.quantity + quantity, MAX_LINE_QUANTITY);
    else
      byVariant.set(variantId, {
        productId,
        variantId,
        quantity: Math.min(quantity, MAX_LINE_QUANTITY),
      });
  }
  return { lines: [...byVariant.values()], skipped };
}

/**
 * Who placed an order, for the order page. The gateway falls back to the person's email when they
 * have no name; an email is not shown to the company's other buyers as a name, so it reads "—".
 */
export function placedByLabel(name: string | null | undefined): string {
  const value = (name ?? '').trim();
  if (!value || /^[^\s@]+@[^\s@]+$/.test(value)) return '—';
  return value;
}

/** The i18n key of a sales status. */
export function salesStatusKey(status: string | null | undefined): string {
  switch (status) {
    case 'OPEN':
      return 'salesStatusOpen';
    case 'ON_HOLD':
      return 'salesStatusOnHold';
    case 'PART_DELIVERED':
      return 'salesStatusPartDelivered';
    case 'DELIVERED':
      return 'salesStatusDelivered';
    case 'CANCELLED':
      return 'salesStatusCancelled';
    default:
      return 'salesStatusOpen';
  }
}
