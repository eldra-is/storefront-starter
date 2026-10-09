import { sessionCookieName } from '~~/shared/utils/auth';
import { prepareCustomerPricing, type CustomerPricingState } from '~~/shared/utils/customer-prices';

/**
 * On the server, before any page data loads: is this a signed-in business customer, and for which
 * company? A page rendered for someone with a session cookie carries their prices in its HTML and
 * payload, so it is sent `private, no-store` (prepareCustomerPricing); a guest's page is unchanged.
 */
export default defineNuxtPlugin({
  name: 'eldra-customer-pricing',
  dependsOn: ['eldra-organization'],
  async setup() {
    if (!import.meta.server) return;
    const serverFetch = useServerFetch();
    useCustomerPricing().value = await prepareCustomerPricing({
      businessLogin: useBusinessLogin().value,
      hasSessionCookie: Boolean(useCookie(sessionCookieName(import.meta.dev)).value),
      setCacheControl: (value) => (useResponseHeader('Cache-Control').value = value),
      fetchState: () => serverFetch<CustomerPricingState>('/api/auth/pricing'),
    });
  },
});
