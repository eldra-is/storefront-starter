import type { EldraCustomerMe } from '@eldrajs/sdk';

/**
 * The signed-in business customer and their companies. 401: signed out (or the session just ended);
 * 403: signed in without a company in this organization; 404: business login is off (the gateway's
 * FEATURE_DISABLED); 503: the gateway cannot check right now. A successful answer is kept on the
 * session under its own key for 30 s, so repeated page views do not each spend the gateway's rate limit.
 */
export default defineEventHandler(async (event): Promise<EldraCustomerMe> => {
  authResponseHeaders(event);
  const auth = await useShopAuth(event);
  if (!auth.enabled) throw createError({ statusCode: 404, statusMessage: 'Not found' });

  const current = await freshShopSession(event, auth);
  if (!current) throw createError({ statusCode: 401, statusMessage: 'Signed out' });
  return loadShopMe(event, auth, current);
});
