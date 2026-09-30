import { describe, expect, it } from 'vitest';
import { safeEmbedUrl } from '../../shared/utils/embed-policy';

describe('safeEmbedUrl', () => {
  it('accepts HTTPS iframes and embeds', () => {
    expect(safeEmbedUrl('iframe', 'https://player.example.com/v/1')).toBe(
      'https://player.example.com/v/1'
    );
    expect(safeEmbedUrl('embed', 'https://docs.example.com/a.pdf')).toBe(
      'https://docs.example.com/a.pdf'
    );
  });

  it('refuses plain HTTP, credentials, garbage and unknown tags', () => {
    expect(safeEmbedUrl('iframe', 'http://player.example.com')).toBeUndefined();
    expect(safeEmbedUrl('iframe', 'https://user:pass@player.example.com')).toBeUndefined();
    expect(safeEmbedUrl('iframe', 'not a url')).toBeUndefined();
    expect(safeEmbedUrl('object', 'https://player.example.com')).toBeUndefined();
  });

  it('loads scripts only from listed origins, and none by default', () => {
    expect(safeEmbedUrl('script', 'https://widgets.example.com/w.js')).toBeUndefined();
    expect(
      safeEmbedUrl('script', 'https://widgets.example.com/w.js', ['https://widgets.example.com'])
    ).toBe('https://widgets.example.com/w.js');
  });
});
