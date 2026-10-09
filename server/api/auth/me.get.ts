import { bearer, refreshTokens, type EldraCustomerMe } from '@eldrajs/sdk';
import { meFailure, mergeRefreshed, needsRefresh, refreshFailure } from '~~/shared/utils/auth';

/**
 * The signed-in business customer and their companies. 401: signed out (or the session just ended);
 * 403: signed in without a company in this organization; 404: business login is off.
 */
export default defineEventHandler(async (event): Promise<EldraCustomerMe> => {
  authResponseHeaders(event);
  const auth = await useShopAuth(event);
  if (!auth.enabled) throw createError({ statusCode: 404, statusMessage: 'Not found' });

  const current = await readShopSession(event);
  if (!current) throw createError({ statusCode: 401, statusMessage: 'Signed out' });
  let { session } = current;

  if (needsRefresh(session, Date.now())) {
    try {
      const tokens = await refreshTokens({
        issuer: auth.issuer,
        clientId: auth.clientId,
        clientSecret: auth.clientSecret,
        refreshToken: session.refreshToken,
      });
      session = mergeRefreshed(session, tokens);
      await saveShopSession(event, current.sessionId, session);
    } catch (error) {
      const failure = refreshFailure(error);
      if (failure.endSession) await endShopSession(event);
      throw createError({ statusCode: failure.statusCode });
    }
  }

  try {
    return await auth.eldra.customer.me({ headers: bearer(session.accessToken) });
  } catch (error) {
    const failure = meFailure(error);
    if (failure.endSession) await endShopSession(event);
    throw createError({ statusCode: failure.statusCode });
  }
});
