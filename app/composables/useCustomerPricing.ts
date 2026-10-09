import { SIGNED_OUT_PRICING, type CustomerPricingState } from '~~/shared/utils/customer-prices';

export const CUSTOMER_PRICING_STATE_KEY = 'eldra-customer-pricing';

/**
 * Whether this visitor is a signed-in business customer and which company they buy for, set on the
 * server by plugins/customer-pricing.ts. It only steers where calls go (server routes when signed
 * in); it never holds a token, and the server decides prices per call whatever it says.
 */
export const useCustomerPricing = () =>
  useState<CustomerPricingState>(CUSTOMER_PRICING_STATE_KEY, () => ({ ...SIGNED_OUT_PRICING }));
