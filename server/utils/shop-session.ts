import type { H3Event } from 'h3';
import { EldraOidcError, refreshTokens, type EldraCustomerMe } from '@eldrajs/sdk';
import {
  LOGIN_TTL_SECONDS,
  SESSION_STORAGE,
  isSessionId,
  loginCookieName,
  loginKey,
  mergeRefreshed,
  nextRefreshStep,
  randomId,
  refreshFailure,
  resolveRefreshConflict,
  sessionCookieName,
  sessionKey,
  sessionTtlSeconds,
  meKey,
  companyKey,
  freshMe,
  ME_CACHE_MS,
  type CachedMe,
  type AuthFailure,
  type PendingLogin,
  type ShopSession,
} from '~~/shared/utils/auth';

/**
 * Server-side session store for business login. The browser holds an opaque random id in an
 * httpOnly cookie; the tokens never leave the server. Records carry their own expiry so a read never
 * trusts a driver's TTL; both drivers also get the TTL so they drop records themselves.
 */
interface Stored<T> {
  value: T;
  expiresAt: number;
}

const store = () => useStorage(SESSION_STORAGE);
const SESSION_COOKIE = sessionCookieName(import.meta.dev);
const LOGIN_COOKIE = loginCookieName(import.meta.dev);

const cookieOptions = (path: string, maxAge: number) => ({
  httpOnly: true,
  secure: !import.meta.dev,
  sameSite: 'lax' as const,
  path,
  maxAge,
});

async function put<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const record: Stored<T> = { value, expiresAt: Date.now() + ttlSeconds * 1000 };
  await store().setItem(key, record, { ttl: ttlSeconds });
}

async function get<T>(key: string): Promise<T | null> {
  const record = await store().getItem<Stored<T>>(key);
  if (!record) return null;
  if (typeof record.expiresAt !== 'number' || record.expiresAt <= Date.now()) {
    await store().removeItem(key);
    return null;
  }
  return record.value;
}

const readStored = (sessionId: string) => get<ShopSession>(sessionKey(sessionId));

async function storeSession(sessionId: string, session: ShopSession): Promise<number> {
  const ttl = sessionTtlSeconds(session.refreshExpiresAt, Date.now());
  await put(sessionKey(sessionId), session, ttl);
  return ttl;
}

/** The signed-in session of this request, or null. */
export async function readShopSession(
  event: H3Event
): Promise<{ sessionId: string; session: ShopSession } | null> {
  const sessionId = getCookie(event, SESSION_COOKIE);
  if (!isSessionId(sessionId)) return null;
  const session = await readStored(sessionId);
  return session ? { sessionId, session } : null;
}

/** Stores the session under a NEW id (never one the browser had before) and sets the cookie. */
export async function startShopSession(event: H3Event, session: ShopSession): Promise<void> {
  const previous = getCookie(event, SESSION_COOKIE);
  if (isSessionId(previous)) {
    await store().removeItem(sessionKey(previous));
    await clearShopMe(previous);
    await clearActiveCompany(previous);
  }
  await saveShopSession(event, randomId(), session);
}

export async function saveShopSession(
  event: H3Event,
  sessionId: string,
  session: ShopSession
): Promise<void> {
  const ttl = await storeSession(sessionId, session);
  setCookie(event, SESSION_COOKIE, sessionId, cookieOptions('/', ttl));
}

/** The cached `/me` answer if still fresh. Best effort: a storage failure is a miss. */
export async function readCachedMe(sessionId: string): Promise<EldraCustomerMe | null> {
  try {
    return freshMe(await get<CachedMe>(meKey(sessionId)), Date.now());
  } catch {
    console.warn('[auth] could not read the cached me answer');
    return null;
  }
}

/** Keeps a successful `/me` answer under its own key for 30 s. The session record is never touched. */
export async function cacheShopMe(sessionId: string, me: EldraCustomerMe): Promise<void> {
  try {
    await put<CachedMe>(meKey(sessionId), { value: me, fetchedAt: Date.now() }, ME_CACHE_MS / 1000);
  } catch {
    console.warn('[auth] could not cache the me answer');
  }
}

/** Drops the cached `/me` answer. Best effort. */
export async function clearShopMe(sessionId: string): Promise<void> {
  try {
    await store().removeItem(meKey(sessionId));
  } catch {
    console.warn('[auth] could not clear the cached me answer');
  }
}

/** The company this session buys for, as chosen on /account (or defaulted to the only one). */
export async function readActiveCompany(sessionId: string): Promise<string | null> {
  try {
    return await get<string>(companyKey(sessionId));
  } catch {
    console.warn('[auth] could not read the active company');
    return null;
  }
}

/** Remembers the active company for as long as the session lives. */
export async function saveActiveCompany(
  sessionId: string,
  session: ShopSession,
  customerId: string
): Promise<void> {
  await put(
    companyKey(sessionId),
    customerId,
    sessionTtlSeconds(session.refreshExpiresAt, Date.now())
  );
}

/** Forgets the active company. Best effort. */
export async function clearActiveCompany(sessionId: string): Promise<void> {
  try {
    await store().removeItem(companyKey(sessionId));
  } catch {
    console.warn('[auth] could not clear the active company');
  }
}

export async function endShopSession(event: H3Event): Promise<void> {
  const sessionId = getCookie(event, SESSION_COOKIE);
  if (isSessionId(sessionId)) {
    await store().removeItem(sessionKey(sessionId));
    await clearShopMe(sessionId);
    await clearActiveCompany(sessionId);
  }
  deleteCookie(event, SESSION_COOKIE, cookieOptions('/', 0));
}

/** Remembers a login in flight for this browser until the callback, replacing any earlier one. */
export async function beginLogin(event: H3Event, pending: PendingLogin): Promise<void> {
  const previous = getCookie(event, LOGIN_COOKIE);
  if (isSessionId(previous)) await store().removeItem(loginKey(previous));
  const loginId = randomId();
  await put(loginKey(loginId), pending, LOGIN_TTL_SECONDS);
  setCookie(event, LOGIN_COOKIE, loginId, cookieOptions('/auth', LOGIN_TTL_SECONDS));
}

/** The login in flight for this browser, removed on the first read whatever happens next. */
export async function takeLogin(event: H3Event): Promise<PendingLogin | null> {
  const loginId = getCookie(event, LOGIN_COOKIE);
  deleteCookie(event, LOGIN_COOKIE, cookieOptions('/auth', 0));
  if (!isSessionId(loginId)) return null;
  const pending = await get<PendingLogin>(loginKey(loginId));
  await store().removeItem(loginKey(loginId));
  return pending;
}

/** Auth responses carry tokens' effects and one-time values: never cache them, never leak a referrer. */
export function authResponseHeaders(event: H3Event): void {
  setResponseHeaders(event, {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  });
}

export class SessionRefreshError extends Error {
  constructor(readonly failure: AuthFailure) {
    super(`session refresh failed with ${failure.statusCode}`);
  }
}

interface RefreshClient {
  clientId: string;
  clientSecret: string;
}

// A hung Keycloak must not hold the shared refresh promise (and every request waiting on it) forever.
export const TOKEN_REQUEST_TIMEOUT_MS = 10_000;
export const timedFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS) });

// One refresh per session at a time in this process: concurrent requests share its result instead
// of spending the same refresh token twice.
const refreshing = new Map<string, Promise<ShopSession>>();

async function refreshOnce(
  sessionId: string,
  session: ShopSession,
  client: RefreshClient,
  retried: boolean
): Promise<ShopSession> {
  try {
    const tokens = await refreshTokens({
      issuer: session.issuer,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      refreshToken: session.refreshToken,
      fetch: timedFetch,
    });
    const next = mergeRefreshed(session, tokens);
    await storeSession(sessionId, next);
    await clearShopMe(sessionId);
    // The session lives longer now; so does the company chosen for it.
    const company = await readActiveCompany(sessionId);
    if (company) await saveActiveCompany(sessionId, next, company).catch(() => undefined);
    return next;
  } catch (error) {
    if (!(error instanceof EldraOidcError) || error.error !== 'invalid_grant') {
      throw new SessionRefreshError(refreshFailure(error));
    }
    // Another server may have refreshed first and rotated the token: look before ending anything.
    const step = nextRefreshStep(
      resolveRefreshConflict(session.refreshToken, await readStored(sessionId), Date.now()),
      retried
    );
    if (step.kind === 'use') return step.session;
    if (step.kind === 'retry') return refreshOnce(sessionId, step.session, client, true);
    if (step.failure.endSession) {
      await store().removeItem(sessionKey(sessionId));
      await clearActiveCompany(sessionId);
    }
    await clearShopMe(sessionId);
    throw new SessionRefreshError(step.failure);
  }
}

/**
 * Fresh tokens for a session, refreshed on the server and shared between concurrent requests.
 * Throws `SessionRefreshError`; its `failure.endSession` says the stored session is already gone.
 */
export function refreshShopSession(
  sessionId: string,
  session: ShopSession,
  client: RefreshClient
): Promise<ShopSession> {
  const running = refreshing.get(sessionId);
  if (running) return running;
  const pending = refreshOnce(sessionId, session, client, false).finally(() =>
    refreshing.delete(sessionId)
  );
  refreshing.set(sessionId, pending);
  return pending;
}

/** Keeps the cookie's lifetime in step with a refreshed session. */
export function touchSessionCookie(event: H3Event, sessionId: string, session: ShopSession): void {
  const ttl = sessionTtlSeconds(session.refreshExpiresAt, Date.now());
  setCookie(event, SESSION_COOKIE, sessionId, cookieOptions('/', ttl));
}

const BACKCHANNEL_LOGOUT_TIMEOUT_MS = 3000;

/**
 * Ends the Keycloak session from the server with the refresh token and the client secret, so it ends
 * even if the browser never follows the logout redirect. Best effort: a failure is logged by its
 * status only, and the browser redirect still runs.
 */
export async function backchannelLogout(
  session: ShopSession,
  client: RefreshClient
): Promise<void> {
  if (!session.refreshToken || !session.issuer) return;
  const body = new URLSearchParams({
    client_id: client.clientId,
    refresh_token: session.refreshToken,
  });
  if (client.clientSecret) body.set('client_secret', client.clientSecret);
  try {
    const response = await fetch(
      `${session.issuer.replace(/\/+$/, '')}/protocol/openid-connect/logout`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(BACKCHANNEL_LOGOUT_TIMEOUT_MS),
      }
    );
    if (!response.ok) console.warn(`[auth] back-channel logout answered ${response.status}`);
  } catch {
    console.warn('[auth] back-channel logout did not complete');
  }
}
