import type { H3Event } from 'h3';
import { loadOrganizationSettings } from '~~/app/utils/organization';
import { businessLoginEnabled, resolveShopIssuer } from '~~/shared/utils/auth';
import { createConfiguredEldraClient } from '~~/shared/utils/eldra-client';

/**
 * Business login settings for this request. Enabled only when the organization has the B2B feature
 * (read once per process, like the rest of its settings) and the storefront client is configured.
 */
export async function useShopAuth(event: H3Event) {
  const config = useRuntimeConfig(event);
  // Published content only: this client never carries the preview token.
  const eldra = createConfiguredEldraClient({
    apiBaseUrl: config.public.eldraApiBaseUrl,
    orgId: config.public.eldraOrgId,
    checkoutUrl: config.public.checkoutUrl,
  });
  const organization = await loadOrganizationSettings(eldra, String(config.public.eldraOrgId));
  const clientSecret = String(config.shopClientSecret ?? '');
  const issuer = resolveShopIssuer({
    issuer: String(config.public.shopIssuer ?? ''),
    keycloakBaseUrl: String(config.public.keycloakBaseUrl ?? ''),
    orgId: organization.id,
  });
  return {
    eldra,
    issuer,
    clientId: String(config.shopClientId || ''),
    clientSecret,
    enabled: businessLoginEnabled({ b2b: organization.b2b, clientSecret, issuer }),
    /** The origin this request came to; Keycloak checks it against the client's redirect URIs. */
    origin: getRequestURL(event).origin,
  };
}
