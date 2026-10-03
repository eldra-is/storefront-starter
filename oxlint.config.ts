import { oxlintConfig } from '@nokkvireyr/vue-config/oxc';

export default oxlintConfig({
  ignorePatterns: ['.nuxt', '.output', '.eldra', 'test-results', 'playwright-report'],
});
