import type { H3Event } from 'h3';
import { loadOrganizationSettings } from '~~/app/utils/organization';
import { businessLoginEnabled, requestOrigin, resolveShopIssuer } from '~~/shared/utils/auth';
import { createConfiguredEldraClient } from '~~/shared/utils/eldra-client';

/**
 * Business login settings for this request. Enabled only when the organization has the B2B feature
 * (the organization is re-read every 5 minutes; the header (Vue) and the /auth routes (Nitro) keep
 * separate caches) and the storefront client is configured.
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
    /** The organization's UUID, even when ELDRA_ORG_ID is an alias; the gateway refuses aliases on shop tokens. */
    orgId: organization.id,
    /** The key the organization is cached under, for `dropOrganizationCache`. */
    orgKey: String(config.public.eldraOrgId),
    issuer,
    clientId: String(config.shopClientId || ''),
    clientSecret,
    enabled: businessLoginEnabled({ b2b: organization.b2b, clientSecret, issuer }),
    /** The origin this request came to; Keycloak checks it against the client's redirect URIs. */
    origin: requestOrigin({
      protocol: getRequestProtocol(event, { xForwardedProto: false }),
      host: getRequestHost(event, { xForwardedHost: false }),
      forwardedProto: getRequestHeader(event, 'x-forwarded-proto'),
      forwardedHost: getRequestHeader(event, 'x-forwarded-host'),
      trustProxy: config.trustProxy === true || String(config.trustProxy) === 'true',
    }),
  };
}
