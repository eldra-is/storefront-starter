import { bearer, type EldraCustomerMe } from '@eldrajs/sdk';
import { freshMe, meFailure, needsRefresh, toAccountResponse } from '~~/shared/utils/auth';

/**
 * The signed-in business customer and their companies. 401: signed out (or the session just ended);
 * 403: signed in without a company in this organization; 404: business login is off (the gateway's
 * FEATURE_DISABLED); 503: the gateway cannot check right now. A successful answer is kept on the
 * session for 30 s, so repeated page views do not each spend the gateway's rate limit.
 */
export default defineEventHandler(async (event): Promise<EldraCustomerMe> => {
  authResponseHeaders(event);
  const auth = await useShopAuth(event);
  if (!auth.enabled) throw createError({ statusCode: 404, statusMessage: 'Not found' });

  const current = await readShopSession(event);
  if (!current) throw createError({ statusCode: 401, statusMessage: 'Signed out' });
  let { session } = current;

  const cached = freshMe(session, Date.now());
  if (cached) return toAccountResponse(cached);

  if (needsRefresh(session, Date.now())) {
    try {
      session = await refreshShopSession(current.sessionId, session, auth);
      touchSessionCookie(event, current.sessionId, session);
    } catch (error) {
      const failure =
        error instanceof SessionRefreshError
          ? error.failure
          : { statusCode: 502 as const, endSession: false };
      if (failure.endSession) await endShopSession(event);
      else await clearShopMe(current.sessionId);
      throw createError({ statusCode: failure.statusCode });
    }
  }

  try {
    const me = toAccountResponse(
      await auth.eldra.customer.me({ headers: bearer(session.accessToken) })
    );
    await cacheShopMe(current.sessionId, session, me);
    return me;
  } catch (error) {
    const failure = meFailure(error);
    if (failure.endSession) await endShopSession(event);
    else await clearShopMe(current.sessionId);
    throw createError({ statusCode: failure.statusCode });
  }
});
