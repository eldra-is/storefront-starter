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
  withoutMe,
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
  if (isSessionId(previous)) await store().removeItem(sessionKey(previous));
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

/**
 * Remembers a successful `/me` answer on the stored session. Only when the stored session still holds
 * this request's refresh token: if another request rotated it meanwhile, its record is not overwritten.
 */
export async function cacheShopMe(
  sessionId: string,
  session: ShopSession,
  me: EldraCustomerMe
): Promise<void> {
  const stored = await readStored(sessionId);
  if (!stored || stored.refreshToken !== session.refreshToken) return;
  await storeSession(sessionId, { ...stored, me: { value: me, fetchedAt: Date.now() } });
}

/** Drops the cached `/me` answer (after a failed refresh or `/me`); the session itself stays. */
export async function clearShopMe(sessionId: string): Promise<void> {
  const stored = await readStored(sessionId);
  if (stored?.me) await storeSession(sessionId, withoutMe(stored));
}

export async function endShopSession(event: H3Event): Promise<void> {
  const sessionId = getCookie(event, SESSION_COOKIE);
  if (isSessionId(sessionId)) await store().removeItem(sessionKey(sessionId));
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
    });
    const next = mergeRefreshed(session, tokens);
    await storeSession(sessionId, next);
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
    if (step.failure.endSession) await store().removeItem(sessionKey(sessionId));
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
