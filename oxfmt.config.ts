import { oxfmtConfig, type OxfmtConfig } from '@nokkvireyr/vue-config/oxc';

export default oxfmtConfig({
  ignorePatterns: [
    '.nuxt',
    '.output',
    '.eldra',
    'test-results',
    'playwright-report',
    'docs/**',
    '.superpowers/**',
  ],
}) as OxfmtConfig;
