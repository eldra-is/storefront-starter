import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const messages = (locale: string) =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, '../../i18n/locales', `${locale}.json`), 'utf8')
  ) as Record<string, string>;

describe('message files', () => {
  it('have the same keys in both locales, none empty', () => {
    const en = messages('en-US');
    const is = messages('is-IS');
    expect(Object.keys(is).sort()).toEqual(Object.keys(en).sort());
    for (const value of [...Object.values(en), ...Object.values(is)])
      expect(value.trim()).not.toBe('');
  });
});
