import { createConfiguredEldraClient } from '~~/shared/utils/eldra-client';

/** The only place the storefront talks to Eldra. */
export const useEldraClient = () => {
  const config = useRuntimeConfig();

  return createConfiguredEldraClient({
    apiBaseUrl: config.public.eldraApiBaseUrl,
    orgId: config.public.eldraOrgId,
    checkoutUrl: config.public.checkoutUrl,
    // Only server-side reads see drafts; the token never reaches the browser.
    previewToken: import.meta.server ? config.previewToken : undefined,
  });
};
