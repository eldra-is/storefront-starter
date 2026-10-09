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
  it('keeps the tokens and expiries, nothing else', () => {
    const session = toShopSession({
      accessToken: 'a',
      refreshToken: 'r',
      idToken: 'i',
      expiresAt: 10,
      refreshExpiresAt: undefined,
      extra: 'x',
    } as never);
    expect(session).toEqual({
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
