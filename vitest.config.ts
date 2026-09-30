import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

// Unit tests cover pure helpers only; nothing here needs a Nuxt runtime or the generated types.
export default defineConfig({
  resolve: { alias: { '~~': root, '~': `${root}app` } },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
