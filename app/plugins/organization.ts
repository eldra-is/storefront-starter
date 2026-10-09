import { loadOrganizationSettings, pickLocale } from '~/utils/organization';
import { businessLoginEnabled, resolveShopIssuer } from '~~/shared/utils/auth';

export default defineNuxtPlugin({
  name: 'eldra-organization',
  dependsOn: ['i18n:plugin'],
  async setup(nuxtApp) {
    const organization = useOrganization();
    if (import.meta.server) {
      const config = useRuntimeConfig();
      const orgId = String(config.public.eldraOrgId ?? '');
      organization.value = await loadOrganizationSettings(useEldraClient(), orgId);
      // The client secret is read here, on the server, and only the resulting boolean is shared.
      useBusinessLogin().value = businessLoginEnabled({
        b2b: organization.value.b2b,
        clientSecret: String(config.shopClientSecret ?? ''),
        issuer: resolveShopIssuer({
          issuer: String(config.public.shopIssuer ?? ''),
          keycloakBaseUrl: String(config.public.keycloakBaseUrl ?? ''),
          orgId: organization.value.id,
        }),
      });
    }
    // A cookie or browser language the organization does not offer falls back to its default.
    const current = nuxtApp.$i18n.locale.value;
    const wanted = pickLocale(current, organization.value);
    if (wanted !== current) await nuxtApp.$i18n.setLocale(wanted);
  },
});
