import { loadOrganizationSettings, pickLocale } from '~/utils/organization';

export default defineNuxtPlugin({
  name: 'eldra-organization',
  dependsOn: ['i18n:plugin'],
  async setup(nuxtApp) {
    const organization = useOrganization();
    if (import.meta.server) {
      const orgId = String(useRuntimeConfig().public.eldraOrgId ?? '');
      organization.value = await loadOrganizationSettings(useEldraClient(), orgId);
    }
    // A cookie or browser language the organization does not offer falls back to its default.
    const current = nuxtApp.$i18n.locale.value;
    const wanted = pickLocale(current, organization.value);
    if (wanted !== current) await nuxtApp.$i18n.setLocale(wanted);
  },
});
