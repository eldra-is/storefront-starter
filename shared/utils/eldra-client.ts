import { createWebStudioClient, type WebStudioClient } from '~~/.eldra/web-studio';
import { normalizeApiBaseUrl } from './env';

type EldraClientConfig = {
  apiBaseUrl?: unknown;
  orgId?: unknown;
  checkoutUrl?: unknown;
  previewToken?: unknown;
};

/** The SDK client with the CMS half typed from this organization's schemas (generated into .eldra). */
export const createConfiguredEldraClient = ({
  apiBaseUrl,
  orgId,
  checkoutUrl,
  previewToken,
}: EldraClientConfig): WebStudioClient => {
  const normalizedOrgId = String(orgId || '').trim();
  const normalizedCheckoutUrl = String(checkoutUrl || '').trim();
  const normalizedPreviewToken = String(previewToken || '').trim();

  if (!normalizedOrgId) {
    throw new Error('ELDRA_ORG_ID is required: set it in .env to your organization id or alias.');
  }

  return createWebStudioClient({
    apiBaseUrl: normalizeApiBaseUrl(String(apiBaseUrl || '')),
    ...(normalizedCheckoutUrl ? { checkoutUrl: normalizedCheckoutUrl } : {}),
    ...(normalizedPreviewToken ? { previewToken: normalizedPreviewToken } : {}),
    orgId: normalizedOrgId,
  });
};
