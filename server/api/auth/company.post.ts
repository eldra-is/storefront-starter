import { isSameOriginRequest } from '~~/shared/utils/auth';
import { chosenCompany } from '~~/shared/utils/customer-prices';

/**
 * Chooses the company a signed-in person buys for, from the account page's form. Same-origin only.
 * The company must be one of the person's (read from /me, not from the form), and is kept in the
 * server session. A form post is sent back to /account; a JSON call gets 204.
 */
export default defineEventHandler(async (event) => {
  authResponseHeaders(event);
  const auth = await useShopAuth(event);
  if (!auth.enabled) throw createError({ statusCode: 404, statusMessage: 'Not found' });
  const sameOrigin = isSameOriginRequest({
    secFetchSite: getRequestHeader(event, 'sec-fetch-site'),
    origin: getRequestHeader(event, 'origin'),
    requestOrigin: auth.origin,
  });
  if (!sameOrigin) throw createError({ statusCode: 403, statusMessage: 'Forbidden' });

  const current = await freshShopSession(event, auth);
  if (!current) throw createError({ statusCode: 401, statusMessage: 'Signed out' });
  const me = await loadShopMe(event, auth, current);
  const customerId = chosenCompany(await readBody(event).catch(() => null), me.memberships);
  if (!customerId)
    throw createError({ statusCode: 400, statusMessage: 'Not one of your companies' });
  await saveActiveCompany(current.sessionId, current.session, customerId);

  const form = (getRequestHeader(event, 'content-type') ?? '').includes('form-urlencoded');
  if (form) return sendRedirect(event, '/account?company=changed', 303);
  setResponseStatus(event, 204);
  return null;
});
