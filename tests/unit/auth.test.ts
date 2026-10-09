import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RETURN_TO,
  DEFAULT_SESSION_TTL_SECONDS,
  accountState,
  businessLoginEnabled,
  callbackCode,
  isSessionId,
  meFailure,
  mergeRefreshed,
  refreshFailure,
  needsRefresh,
  randomId,
  resolveShopIssuer,
  safeReturnTo,
  sessionTtlSeconds,
  statesMatch,
  toShopSession,
  isSameOriginRequest,
  resolveRefreshConflict,
  sessionCookieName,
  loginCookieName,
  chooseSessionStore,
  toAccountResponse,
} from '../../shared/utils/auth';

describe('safeReturnTo', () => {
  it('keeps same-origin relative paths with their query and hash', () => {
    expect(safeReturnTo('/account')).toBe('/account');
    expect(safeReturnTo('/products/mat?size=l#reviews')).toBe('/products/mat?size=l#reviews');
    expect(safeReturnTo('/')).toBe('/');
  });

  it('falls back for anything that could leave the site', () => {
    for (const value of [
      'https://evil.example.com',
      'http:/evil.example.com',
      'javascript:alert(1)',
      '//evil.example.com',
      '///evil.example.com',
      '/\\evil.example.com',
      '\\\\evil.example.com',
      '/foo\\bar',
      '/\t/evil.example.com',
      '/\n/evil.example.com',
      ' /account',
      'account',
      '',
      `/${'a'.repeat(2048)}`,
    ]) {
      expect(safeReturnTo(value), JSON.stringify(value)).toBe(DEFAULT_RETURN_TO);
    }
  });

  it('falls back for non-strings, repeated query values and the auth routes', () => {
    expect(safeReturnTo(undefined)).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo(['/a', '/b'])).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo(42)).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo('/auth/logout')).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo('/auth/login?returnTo=/x')).toBe(DEFAULT_RETURN_TO);
  });

  it('takes a custom fallback', () => {
    expect(safeReturnTo('//x', '/')).toBe('/');
  });
});

describe('randomId and isSessionId', () => {
  it('makes 32 random bytes as 43 base64url characters', () => {
    const a = randomId();
    const b = randomId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(isSessionId(a)).toBe(true);
  });

  it('rejects anything else as a session id', () => {
    expect(isSessionId(undefined)).toBe(false);
    expect(isSessionId('')).toBe(false);
    expect(isSessionId('short')).toBe(false);
    expect(isSessionId(`${'a'.repeat(42)}=`)).toBe(false);
    expect(isSessionId(`${'a'.repeat(42)}:`)).toBe(false);
  });
});

describe('sessionTtlSeconds', () => {
  const now = 1_000_000;

  it('lasts until the refresh token expires', () => {
    expect(sessionTtlSeconds(now + 1_800_000, now)).toBe(1800);
    expect(sessionTtlSeconds(now + 1_500, now)).toBe(1);
  });

  it('uses eight hours when Keycloak sent no refresh expiry', () => {
    expect(DEFAULT_SESSION_TTL_SECONDS).toBe(8 * 60 * 60);
    expect(sessionTtlSeconds(undefined, now)).toBe(DEFAULT_SESSION_TTL_SECONDS);
  });

  it('uses eight hours when the expiry is not in the future (refresh_expires_in 0)', () => {
    expect(sessionTtlSeconds(now, now)).toBe(DEFAULT_SESSION_TTL_SECONDS);
    expect(sessionTtlSeconds(now - 5, now)).toBe(DEFAULT_SESSION_TTL_SECONDS);
  });
});

describe('needsRefresh', () => {
  const now = 1_000_000;

  it('refreshes when less than 60 seconds are left', () => {
    expect(needsRefresh({ expiresAt: now + 59_999 }, now)).toBe(true);
    expect(needsRefresh({ expiresAt: now - 1 }, now)).toBe(true);
  });

  it('keeps a token with a minute or more left', () => {
    expect(needsRefresh({ expiresAt: now + 60_000 }, now)).toBe(false);
    expect(needsRefresh({ expiresAt: now + 300_000 }, now)).toBe(false);
  });
});

describe('statesMatch', () => {
  it('matches equal non-empty strings only', () => {
    expect(statesMatch('abc', 'abc')).toBe(true);
    expect(statesMatch('abc', 'abd')).toBe(false);
    expect(statesMatch('abc', 'abcd')).toBe(false);
    expect(statesMatch('', '')).toBe(false);
    expect(statesMatch('abc', undefined)).toBe(false);
    expect(statesMatch('abc', ['abc'])).toBe(false);
  });
});

describe('toShopSession', () => {
  it('keeps the tokens, expiries and the issuer that signed them, nothing else', () => {
    const session = toShopSession(
      {
        accessToken: 'a',
        refreshToken: 'r',
        idToken: 'i',
        expiresAt: 10,
        refreshExpiresAt: undefined,
        extra: 'x',
      } as never,
      'https://kc.example.com/realms/shop-1'
    );
    expect(session).toEqual({
      issuer: 'https://kc.example.com/realms/shop-1',
      accessToken: 'a',
      refreshToken: 'r',
      idToken: 'i',
      expiresAt: 10,
      refreshExpiresAt: undefined,
    });
  });
});

describe('resolveShopIssuer', () => {
  const orgId = '6f1c2f8e-0000-4000-8000-000000000001';

  it('prefers the configured issuer without a trailing slash', () => {
    expect(
      resolveShopIssuer({
        issuer: 'https://auth.example.com/realms/custom/',
        keycloakBaseUrl: 'https://kc.example.com',
        orgId,
      })
    ).toBe('https://auth.example.com/realms/custom');
  });

  it('derives the shop realm from the Keycloak base URL and the organization id', () => {
    expect(
      resolveShopIssuer({ issuer: '', keycloakBaseUrl: 'https://kc.example.com/', orgId })
    ).toBe(`https://kc.example.com/realms/shop-${orgId}`);
  });

  it('has no issuer without a base URL or an organization id', () => {
    expect(resolveShopIssuer({ issuer: '', keycloakBaseUrl: '', orgId })).toBe('');
    expect(
      resolveShopIssuer({ issuer: '', keycloakBaseUrl: 'https://kc.example.com', orgId: '' })
    ).toBe('');
  });
});

describe('businessLoginEnabled', () => {
  const ready = { b2b: true, clientSecret: 'set', issuer: 'https://kc.example.com/realms/shop-1' };

  it('needs the B2B feature, a client secret and an issuer', () => {
    expect(businessLoginEnabled(ready)).toBe(true);
    expect(businessLoginEnabled({ ...ready, b2b: false })).toBe(false);
    expect(businessLoginEnabled({ ...ready, clientSecret: '' })).toBe(false);
    expect(businessLoginEnabled({ ...ready, issuer: '' })).toBe(false);
  });
});

describe('accountState', () => {
  it('maps the me endpoint status to what the account page shows', () => {
    expect(accountState(undefined)).toBe('signed-in');
    expect(accountState(401)).toBe('signed-out');
    expect(accountState(403)).toBe('no-membership');
    expect(accountState(404)).toBe('unavailable');
    expect(accountState(500)).toBe('error');
    expect(accountState(502)).toBe('error');
  });
});

describe('mergeRefreshed', () => {
  const previous = {
    issuer: 'https://kc.example.com/realms/shop-1',
    accessToken: 'a1',
    refreshToken: 'r1',
    idToken: 'i1',
    expiresAt: 1,
    refreshExpiresAt: 2,
  };

  it('takes the new tokens', () => {
    expect(
      mergeRefreshed(previous, {
        accessToken: 'a2',
        refreshToken: 'r2',
        idToken: 'i2',
        expiresAt: 3,
        refreshExpiresAt: 4,
      })
    ).toEqual({
      issuer: 'https://kc.example.com/realms/shop-1',
      accessToken: 'a2',
      refreshToken: 'r2',
      idToken: 'i2',
      expiresAt: 3,
      refreshExpiresAt: 4,
    });
  });

  it('keeps the refresh and id tokens Keycloak did not send again', () => {
    expect(
      mergeRefreshed(previous, {
        accessToken: 'a2',
        refreshToken: '',
        idToken: '',
        expiresAt: 3,
        refreshExpiresAt: undefined,
      })
    ).toEqual({
      issuer: 'https://kc.example.com/realms/shop-1',
      accessToken: 'a2',
      refreshToken: 'r1',
      idToken: 'i1',
      expiresAt: 3,
      refreshExpiresAt: 2,
    });
  });
});

describe('callbackCode', () => {
  const pending = { state: 's'.repeat(43), codeVerifier: 'v', returnTo: '/x', redirectUri: 'u' };

  it('returns the code when the state matches the pending login', () => {
    expect(callbackCode(pending, { state: pending.state, code: 'c' })).toBe('c');
  });

  it('refuses a missing login, a wrong state, an error or a missing code', () => {
    expect(callbackCode(null, { state: pending.state, code: 'c' })).toBeNull();
    expect(callbackCode(pending, { state: 'other', code: 'c' })).toBeNull();
    expect(callbackCode(pending, { state: pending.state })).toBeNull();
    expect(callbackCode(pending, { state: pending.state, code: ['c', 'd'] })).toBeNull();
    expect(
      callbackCode(pending, { state: pending.state, code: 'c', error: 'access_denied' })
    ).toBeNull();
  });
});

describe('refreshFailure', () => {
  it('ends the session on invalid_grant', () => {
    expect(refreshFailure({ error: 'invalid_grant' })).toEqual({
      statusCode: 401,
      endSession: true,
    });
  });

  it('keeps the session when Keycloak is unreachable or failing', () => {
    expect(refreshFailure({ error: 'server_error' })).toEqual({
      statusCode: 502,
      endSession: false,
    });
    expect(refreshFailure(new TypeError('fetch failed'))).toEqual({
      statusCode: 502,
      endSession: false,
    });
  });
});

describe('meFailure', () => {
  it('signs out on 401 and keeps the session on 403', () => {
    expect(meFailure({ status: 401 })).toEqual({ statusCode: 401, endSession: true });
    expect(meFailure({ status: 403 })).toEqual({ statusCode: 403, endSession: false });
  });

  it('reports anything else as a bad gateway', () => {
    expect(meFailure({ status: 500 })).toEqual({ statusCode: 502, endSession: false });
    expect(meFailure(new Error('network'))).toEqual({ statusCode: 502, endSession: false });
  });
});

describe('resolveRefreshConflict', () => {
  const now = 1_000_000;
  const stored = (refreshToken: string, expiresAt: number) => ({
    issuer: 'i',
    accessToken: `a-${refreshToken}`,
    refreshToken,
    idToken: 'id',
    expiresAt,
    refreshExpiresAt: undefined,
  });

  it('ends the session when the store is empty or still holds the token that failed', () => {
    expect(resolveRefreshConflict('r1', null, now)).toEqual({ action: 'end' });
    expect(resolveRefreshConflict('r1', stored('r1', now + 300_000), now)).toEqual({
      action: 'end',
    });
  });

  it('continues with what another request just stored', () => {
    const fresh = stored('r2', now + 300_000);
    expect(resolveRefreshConflict('r1', fresh, now)).toEqual({ action: 'use', session: fresh });
  });

  it('retries once with a newer token that itself needs refreshing', () => {
    const later = stored('r2', now + 10_000);
    expect(resolveRefreshConflict('r1', later, now)).toEqual({ action: 'retry', session: later });
  });
});

describe('isSameOriginRequest', () => {
  const requestOrigin = 'https://shop.example.com';

  it('accepts a same-origin fetch or a matching Origin header', () => {
    expect(isSameOriginRequest({ secFetchSite: 'same-origin', requestOrigin })).toBe(true);
    expect(isSameOriginRequest({ origin: 'https://shop.example.com', requestOrigin })).toBe(true);
  });

  it('refuses other sites, a typed URL and requests that say nothing', () => {
    expect(isSameOriginRequest({ secFetchSite: 'cross-site', requestOrigin })).toBe(false);
    expect(isSameOriginRequest({ secFetchSite: 'same-site', requestOrigin })).toBe(false);
    expect(isSameOriginRequest({ secFetchSite: 'none', requestOrigin })).toBe(false);
    expect(isSameOriginRequest({ origin: 'https://evil.example.com', requestOrigin })).toBe(false);
    expect(isSameOriginRequest({ origin: 'null', requestOrigin })).toBe(false);
    expect(isSameOriginRequest({ requestOrigin })).toBe(false);
    expect(isSameOriginRequest({ origin: '', requestOrigin: '' })).toBe(false);
  });

  it('refuses a cross-site fetch even with a forged-looking Origin', () => {
    expect(
      isSameOriginRequest({
        secFetchSite: 'cross-site',
        origin: 'https://shop.example.com',
        requestOrigin,
      })
    ).toBe(false);
  });
});

describe('cookie names', () => {
  it('uses host-locked names outside development', () => {
    expect(sessionCookieName(false)).toBe('__Host-eldra_session');
    expect(loginCookieName(false)).toBe('__Secure-eldra_login');
  });

  it('uses plain names in development, where cookies are not Secure', () => {
    expect(sessionCookieName(true)).toBe('eldra_session');
    expect(loginCookieName(true)).toBe('eldra_login');
  });
});

describe('chooseSessionStore', () => {
  const base = { url: '', production: true, businessLoginConfigured: true };

  it('uses Redis when asked and refuses Redis without a URL', () => {
    expect(chooseSessionStore({ ...base, driver: 'redis', url: 'redis://cache:6379' })).toEqual({
      kind: 'redis',
    });
    expect(chooseSessionStore({ ...base, driver: ' REDIS ', url: 'redis://cache' })).toEqual({
      kind: 'redis',
    });
    expect(chooseSessionStore({ ...base, driver: 'redis' }).kind).toBe('error');
  });

  it('refuses unasked-for memory in production when business login is configured', () => {
    expect(chooseSessionStore({ ...base, driver: '' }).kind).toBe('error');
    expect(chooseSessionStore({ ...base, driver: 'memory' })).toEqual({ kind: 'memory' });
  });

  it('uses memory in development and when business login is not configured', () => {
    expect(chooseSessionStore({ ...base, driver: '', production: false })).toEqual({
      kind: 'memory',
    });
    expect(chooseSessionStore({ ...base, driver: '', businessLoginConfigured: false })).toEqual({
      kind: 'memory',
    });
  });

  it('refuses a driver it does not know', () => {
    expect(chooseSessionStore({ ...base, driver: 'mongo' }).kind).toBe('error');
  });
});

describe('toAccountResponse', () => {
  it('passes on the person and their memberships, nothing else', () => {
    const me = {
      shopUser: { id: 'u', email: 'e@x.is', firstName: 'A', lastName: 'B' },
      memberships: [
        {
          customerId: 'c',
          customerName: 'Acme',
          number: '1',
          role: 'ADMIN' as const,
          status: 'ACTIVE' as const,
        },
      ],
      accessToken: 'leak',
    };
    expect(toAccountResponse(me)).toEqual({
      shopUser: me.shopUser,
      memberships: me.memberships,
    });
  });
});
