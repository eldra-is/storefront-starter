import { buildAuthorizeUrl, createPkcePair } from '@eldrajs/sdk';
import { LOCALE_COOKIE, loginUiLocale } from '~~/app/utils/organization';
import { randomId, safeReturnTo } from '~~/shared/utils/auth';

/** Starts business login: PKCE, a single-use state and the return path stay on the server. */
export default defineEventHandler(async (event) => {
  authResponseHeaders(event);
  const auth = await useShopAuth(event);
  if (!auth.enabled) throw createError({ statusCode: 404, statusMessage: 'Not found' });

  const { codeVerifier, codeChallenge } = await createPkcePair();
  const state = randomId();
  const redirectUri = `${auth.origin}/auth/callback`;
  await beginLogin(event, {
    state,
    codeVerifier,
    redirectUri,
    returnTo: safeReturnTo(getQuery(event).returnTo),
  });
  return sendRedirect(
    event,
    buildAuthorizeUrl({
      issuer: auth.issuer,
      clientId: auth.clientId,
      redirectUri,
      state,
      codeChallenge,
      // Keycloak's pages follow the storefront's language, not the browser's.
      uiLocales: loginUiLocale(getCookie(event, LOCALE_COOKIE), auth.locales),
    }),
    302
  );
});
