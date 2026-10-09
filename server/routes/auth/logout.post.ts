import { buildLogoutUrl } from '@eldrajs/sdk';
import { isSameOriginRequest } from '~~/shared/utils/auth';

/**
 * Sign-out, from the account page's form. Only this site's own pages may ask (fetch metadata or
 * Origin), so another site cannot sign a customer out. Ends the stored session, ends the Keycloak
 * session from the server (best effort), then sends the browser through Keycloak's logout so its
 * own cookies go too, and back to the storefront.
 */
export default defineEventHandler(async (event) => {
  authResponseHeaders(event);
  const auth = await useShopAuth(event);
  const sameOrigin = isSameOriginRequest({
    secFetchSite: getRequestHeader(event, 'sec-fetch-site'),
    origin: getRequestHeader(event, 'origin'),
    requestOrigin: auth.origin,
  });
  if (!sameOrigin) throw createError({ statusCode: 403, statusMessage: 'Forbidden' });

  const current = await readShopSession(event);
  await endShopSession(event);
  if (!current) return sendRedirect(event, '/', 303);

  const { session } = current;
  await backchannelLogout(session, auth);
  const issuer = session.issuer || auth.issuer;
  if (!session.idToken || !issuer) return sendRedirect(event, '/', 303);
  // The URL carries id_token_hint: no-referrer (set above) and never logged.
  return sendRedirect(
    event,
    buildLogoutUrl({
      issuer,
      clientId: auth.clientId,
      postLogoutRedirectUri: `${auth.origin}/`,
      idTokenHint: session.idToken,
    }),
    303
  );
});
