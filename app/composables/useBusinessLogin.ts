export const BUSINESS_LOGIN_STATE_KEY = 'eldra-business-login';

/**
 * Whether business customers can sign in here: set on the server by plugins/organization.ts from
 * the organization's B2B feature and the storefront client settings. Only the boolean reaches the browser.
 */
export const useBusinessLogin = () => useState<boolean>(BUSINESS_LOGIN_STATE_KEY, () => false);
