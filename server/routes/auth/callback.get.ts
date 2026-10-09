import { exchangeAuthorizationCode } from '@eldrajs/sdk';
import { callbackCode, toShopSession } from '~~/shared/utils/auth';

const FAILED = '/account?signin=failed';

/**
 * Keycloak's redirect back. The pending login is taken (and deleted) first, so a state works once;
 * a successful exchange starts a session under a fresh id.
 */
export default defineEventHandler(async (event) => {
  authResponseHeaders(event);
  const auth = await useShopAuth(event);
  if (!auth.enabled) throw createError({ statusCode: 404, statusMessage: 'Not found' });

  const pending = await takeLogin(event);
  const code = callbackCode(pending, getQuery(event));
  if (!pending || !code) return sendRedirect(event, FAILED, 302);

  try {
    const tokens = await exchangeAuthorizationCode({
      issuer: auth.issuer,
      clientId: auth.clientId,
      clientSecret: auth.clientSecret,
      code,
      redirectUri: pending.redirectUri,
      codeVerifier: pending.codeVerifier,
      fetch: timedFetch,
    });
    await startShopSession(event, toShopSession(tokens, auth.issuer));
  } catch (error) {
    // The error carries the OAuth code only; never the request or the tokens.
    console.warn('[auth] code exchange failed:', (error as { error?: string }).error ?? 'unknown');
    return sendRedirect(event, FAILED, 302);
  }
  return sendRedirect(event, pending.returnTo, 302);
});
