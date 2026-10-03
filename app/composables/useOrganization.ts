import {
  FALLBACK_ORGANIZATION,
  ORGANIZATION_STATE_KEY,
  type OrganizationSettings,
} from '~/utils/organization';

/** Currency, locales and features, read once on the server by plugins/organization.ts. */
export const useOrganization = () =>
  useState<OrganizationSettings>(ORGANIZATION_STATE_KEY, () => FALLBACK_ORGANIZATION);
