import type { H3Event } from 'h3';
import {
  LOGIN_COOKIE,
  LOGIN_TTL_SECONDS,
  SESSION_COOKIE,
  SESSION_STORAGE,
  isSessionId,
  loginKey,
  randomId,
  sessionKey,
  sessionTtlSeconds,
  type PendingLogin,
  type ShopSession,
} from '~~/shared/utils/auth';

/**
 * Server-side session store for business login. The browser holds an opaque random id in an
 * httpOnly cookie; the tokens never leave the server. Records carry their own expiry because the
 * memory driver ignores TTLs; Redis also gets the TTL so it drops them itself.
 */
interface Stored<T> {
  value: T;
  expiresAt: number;
}

const store = () => useStorage(SESSION_STORAGE);

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

/** The signed-in session of this request, or null. */
export async function readShopSession(
  event: H3Event
): Promise<{ sessionId: string; session: ShopSession } | null> {
  const sessionId = getCookie(event, SESSION_COOKIE);
  if (!isSessionId(sessionId)) return null;
  const session = await get<ShopSession>(sessionKey(sessionId));
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
  const ttl = sessionTtlSeconds(session.refreshExpiresAt, Date.now());
  await put(sessionKey(sessionId), session, ttl);
  setCookie(event, SESSION_COOKIE, sessionId, cookieOptions('/', ttl));
}

export async function endShopSession(event: H3Event): Promise<void> {
  const sessionId = getCookie(event, SESSION_COOKIE);
  if (isSessionId(sessionId)) await store().removeItem(sessionKey(sessionId));
  deleteCookie(event, SESSION_COOKIE, cookieOptions('/', 0));
}

/** Remembers a login in flight for this browser until the callback. */
export async function beginLogin(event: H3Event, pending: PendingLogin): Promise<void> {
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
