import { shopIssuer, type EldraCustomerMe, type EldraOidcTokens } from '@eldrajs/sdk';

/**
 * Business-customer login: the pure parts. The Nitro routes in server/routes/auth and
 * server/api/auth do the I/O. The browser holds only an opaque session id; tokens stay in the
 * server's `eldra-session` storage.
 */

/** Holds the opaque session id of a signed-in business customer (see `sessionCookieName`). */
export const SESSION_COOKIE = 'eldra_session';
/** Holds the id of a login in flight (state, PKCE verifier, return path), between login and callback. */
export const LOGIN_COOKIE = 'eldra_login';

/**
 * Outside development the session cookie is `__Host-` (Secure, Path=/, no Domain: no subdomain can
 * set or shadow it). The login cookie lives on /auth only, so it can be `__Secure-` but not `__Host-`.
 * Development serves plain http, where browsers refuse both prefixes.
 */
export const sessionCookieName = (dev: boolean) =>
  dev ? SESSION_COOKIE : `__Host-${SESSION_COOKIE}`;
export const loginCookieName = (dev: boolean) => (dev ? LOGIN_COOKIE : `__Secure-${LOGIN_COOKIE}`);
/** The Nitro storage mount for sessions and logins in flight (nuxt.config.ts, server/plugins). */
export const SESSION_STORAGE = 'eldra-session';
/** A login must come back from Keycloak within ten minutes. */
export const LOGIN_TTL_SECONDS = 600;
/** Session lifetime when Keycloak sends no refresh token expiry. */
export const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;
/** Refresh the access token when less than this is left. */
export const REFRESH_MARGIN_MS = 60_000;
export const DEFAULT_RETURN_TO = '/account';

const MAX_RETURN_TO_LENGTH = 2048;

export type ShopSession = Pick<
  EldraOidcTokens,
  'accessToken' | 'refreshToken' | 'idToken' | 'expiresAt' | 'refreshExpiresAt'
> & {
  /** The issuer that signed these tokens: refresh and logout go back to it, whatever config says now. */
  issuer: string;
};

/** Stored under a login id until the callback takes it (single use). */
export interface PendingLogin {
  state: string;
  codeVerifier: string;
  returnTo: string;
  redirectUri: string;
}

export const sessionKey = (sessionId: string) => `session:${sessionId}`;
export const loginKey = (loginId: string) => `login:${loginId}`;

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 32 random bytes from the platform CSPRNG as 43 base64url characters: session ids, login ids, state. */
export function randomId(): string {
  return base64Url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

/** The shape `randomId()` produces; anything else in a cookie is ignored without a storage read. */
export function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/**
 * A same-origin relative path to return to after sign-in, else `fallback`. Accepts `/path?query#hash`
 * only: no scheme, no `//` (protocol-relative), no backslashes (browsers read `/\` as `//`), no
 * whitespace or control characters (browsers strip tabs and newlines, which can turn `/\t/x` into
 * `//x`), and never the auth routes themselves.
 */
export function safeReturnTo(value: unknown, fallback: string = DEFAULT_RETURN_TO): string {
  if (typeof value !== 'string' || value.length > MAX_RETURN_TO_LENGTH) return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  // oxlint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (/[\\\s\u0000-\u001f\u007f]/.test(value)) return fallback;
  if (value === '/auth' || value.startsWith('/auth/') || value.startsWith('/auth?'))
    return fallback;
  return value;
}

/** Seconds a session lives: until the refresh token expires, else eight hours. */
export function sessionTtlSeconds(refreshExpiresAt: number | undefined, now: number): number {
  // Keycloak sends refresh_expires_in 0 for tokens that do not expire on their own.
  if (refreshExpiresAt === undefined || refreshExpiresAt <= now) return DEFAULT_SESSION_TTL_SECONDS;
  return Math.max(1, Math.floor((refreshExpiresAt - now) / 1000));
}

export function needsRefresh(session: Pick<ShopSession, 'expiresAt'>, now: number): boolean {
  return session.expiresAt - now < REFRESH_MARGIN_MS;
}

/** Compares the stored state with the callback's in constant time; an empty or repeated value never matches. */
export function statesMatch(expected: string, actual: unknown): boolean {
  if (!expected || typeof actual !== 'string' || actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1)
    diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  return diff === 0;
}

export function toShopSession(tokens: EldraOidcTokens, issuer: string): ShopSession {
  return {
    issuer,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    idToken: tokens.idToken,
    expiresAt: tokens.expiresAt,
    refreshExpiresAt: tokens.refreshExpiresAt,
  };
}

/**
 * The shop realm's issuer: `NUXT_PUBLIC_SHOP_ISSUER` when set, else derived from the Keycloak base
 * URL and the organization's id (its UUID, never an alias). Empty when neither is possible.
 */
export function resolveShopIssuer(options: {
  issuer: string;
  keycloakBaseUrl: string;
  orgId: string;
}): string {
  const issuer = options.issuer.trim().replace(/\/+$/, '');
  if (issuer) return issuer;
  const base = options.keycloakBaseUrl.trim();
  const orgId = options.orgId.trim();
  return base && orgId ? shopIssuer({ keycloakBaseUrl: base, orgId }) : '';
}

/** Sign-in shows only when the organization sells to businesses and the storefront client is configured. */
export function businessLoginEnabled(options: {
  b2b: boolean;
  clientSecret: string;
  issuer: string;
}): boolean {
  return options.b2b && Boolean(options.clientSecret) && Boolean(options.issuer);
}

export type AccountState = 'signed-in' | 'signed-out' | 'no-membership' | 'unavailable' | 'error';

/** What `/account` shows for the status of `/api/auth/me`; `undefined` is a success. */
export function accountState(status: number | undefined): AccountState {
  if (status === undefined) return 'signed-in';
  if (status === 401) return 'signed-out';
  if (status === 403) return 'no-membership';
  if (status === 404) return 'unavailable';
  return 'error';
}

/** The session after a refresh; Keycloak may leave out a refresh or id token it did not rotate. */
export function mergeRefreshed(previous: ShopSession, tokens: EldraOidcTokens): ShopSession {
  return {
    issuer: previous.issuer,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || previous.refreshToken,
    idToken: tokens.idToken || previous.idToken,
    expiresAt: tokens.expiresAt,
    refreshExpiresAt: tokens.refreshExpiresAt ?? previous.refreshExpiresAt,
  };
}

/**
 * The authorization code of a callback that belongs to the pending login of this browser, else null:
 * no pending login, a state that does not match, an `error` from Keycloak, or no single code.
 */
export function callbackCode(
  pending: Pick<PendingLogin, 'state'> | null,
  query: Record<string, unknown>
): string | null {
  if (!pending || query.error !== undefined) return null;
  if (!statesMatch(pending.state, query.state)) return null;
  return typeof query.code === 'string' && query.code ? query.code : null;
}

export interface AuthFailure {
  statusCode: 401 | 403 | 502;
  /** Delete the stored session and clear the cookie. */
  endSession: boolean;
}

/** A failed refresh: `invalid_grant` means the Keycloak session is over; anything else is an outage. */
export function refreshFailure(error: unknown): AuthFailure {
  const code = (error as { error?: unknown } | null)?.error;
  return code === 'invalid_grant'
    ? { statusCode: 401, endSession: true }
    : { statusCode: 502, endSession: false };
}

/** A failed `customer.me`: 401 SHOP_TOKEN_INVALID signs out, 403 SHOP_NO_MEMBERSHIP keeps the session. */
export function meFailure(error: unknown): AuthFailure {
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 401) return { statusCode: 401, endSession: true };
  if (status === 403) return { statusCode: 403, endSession: false };
  return { statusCode: 502, endSession: false };
}

export type RefreshConflict =
  | { action: 'end' }
  | { action: 'use'; session: ShopSession }
  | { action: 'retry'; session: ShopSession };

/**
 * A refresh answered `invalid_grant`. Another request (another server, or a tab) may have refreshed
 * first and rotated the token, so the store is read again before anything ends: the session ends
 * only when the store is empty or still holds the token that failed.
 */
export function resolveRefreshConflict(
  failedRefreshToken: string,
  stored: ShopSession | null,
  now: number
): RefreshConflict {
  if (!stored || stored.refreshToken === failedRefreshToken) return { action: 'end' };
  if (!needsRefresh(stored, now)) return { action: 'use', session: stored };
  return { action: 'retry', session: stored };
}

/**
 * A state-changing request (sign-out) made by this site's own pages: the browser says
 * `Sec-Fetch-Site: same-origin`, or, where it sends no fetch metadata, an `Origin` equal to the
 * request's. A browser that reports another site is refused whatever its Origin says.
 */
export function isSameOriginRequest(options: {
  secFetchSite?: string | null;
  origin?: string | null;
  requestOrigin: string;
}): boolean {
  const site = options.secFetchSite?.trim().toLowerCase();
  if (site) return site === 'same-origin';
  return Boolean(options.requestOrigin) && options.origin === options.requestOrigin;
}

export type SessionStoreChoice =
  | { kind: 'memory' }
  | { kind: 'redis' }
  | { kind: 'error'; message: string };

/**
 * Where sessions live. Memory is only for one server: in production with business login configured
 * it must be asked for (NUXT_SESSION_STORAGE_DRIVER=memory), so a missing setting cannot quietly
 * sign people out on every restart or every second request behind a load balancer.
 */
export function chooseSessionStore(options: {
  driver: string;
  url: string;
  production: boolean;
  businessLoginConfigured: boolean;
}): SessionStoreChoice {
  const driver = options.driver.trim().toLowerCase();
  if (driver === 'redis') {
    return options.url.trim()
      ? { kind: 'redis' }
      : {
          kind: 'error',
          message: 'NUXT_SESSION_STORAGE_URL is required when the driver is redis.',
        };
  }
  if (driver === 'memory') return { kind: 'memory' };
  if (driver) {
    return {
      kind: 'error',
      message: `Unknown NUXT_SESSION_STORAGE_DRIVER "${driver}": use redis or memory.`,
    };
  }
  if (options.production && options.businessLoginConfigured) {
    return {
      kind: 'error',
      message:
        'Business login is configured but NUXT_SESSION_STORAGE_DRIVER is not set. Set it to redis ' +
        '(with NUXT_SESSION_STORAGE_URL), or to memory for a single server that may lose sign-ins on restart.',
    };
  }
  return { kind: 'memory' };
}

/** What `/api/auth/me` answers: the person and their companies, and nothing the SDK may add later. */
export function toAccountResponse(me: EldraCustomerMe): EldraCustomerMe {
  return { shopUser: me.shopUser, memberships: me.memberships };
}

export type RefreshStep =
  | { kind: 'use'; session: ShopSession }
  | { kind: 'retry'; session: ShopSession }
  | { kind: 'fail'; failure: AuthFailure };

/**
 * What to do after a refresh answered `invalid_grant` and the store was read again. The stored
 * session is deleted only when it still holds the token that failed; when a retry with a newer
 * token has failed too, this request is signed out but the stored session is left for whoever
 * wrote it.
 */
export function nextRefreshStep(conflict: RefreshConflict, retried: boolean): RefreshStep {
  if (conflict.action === 'use') return { kind: 'use', session: conflict.session };
  if (conflict.action === 'retry' && !retried) return { kind: 'retry', session: conflict.session };
  return {
    kind: 'fail',
    failure: { statusCode: 401, endSession: conflict.action === 'end' },
  };
}

const firstListValue = (value: string | null | undefined) =>
  (value ?? '').split(',')[0]?.trim() ?? '';

/**
 * This request's origin, for the sign-out origin check and the OAuth redirect URI. Forwarded headers
 * are anyone's to send, so they count only behind a proxy the operator says to trust
 * (NUXT_TRUST_PROXY=true), and then only the first value, the one the outermost proxy set.
 */
export function requestOrigin(options: {
  protocol: string;
  host: string;
  forwardedProto?: string | null;
  forwardedHost?: string | null;
  trustProxy: boolean;
}): string {
  let protocol = options.protocol;
  let host = options.host;
  if (options.trustProxy) {
    const proto = firstListValue(options.forwardedProto).toLowerCase();
    if (proto === 'http' || proto === 'https') protocol = proto;
    const forwardedHost = firstListValue(options.forwardedHost);
    if (forwardedHost) host = forwardedHost;
  }
  return `${protocol}://${host}`;
}
