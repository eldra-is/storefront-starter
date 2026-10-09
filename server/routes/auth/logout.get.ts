import { buildLogoutUrl } from '@eldrajs/sdk';

/** Ends the storefront session, then the Keycloak session, and comes back to the storefront. */
export default defineEventHandler(async (event) => {
  authResponseHeaders(event);
  const current = await readShopSession(event);
  await endShopSession(event);
  const auth = await useShopAuth(event);
  if (!current?.session.idToken || !auth.issuer) return sendRedirect(event, '/', 302);
  // The URL carries id_token_hint: no-referrer (set above) and never logged.
  return sendRedirect(
    event,
    buildLogoutUrl({
      issuer: auth.issuer,
      clientId: auth.clientId,
      postLogoutRedirectUri: `${auth.origin}/`,
      idTokenHint: current.session.idToken,
    }),
    302
  );
});
