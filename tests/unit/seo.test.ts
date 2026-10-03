import { describe, expect, it } from 'vitest';
import { buildSeoMeta } from '../../app/utils/seo';

describe('buildSeoMeta', () => {
  it('prefers the seo field and falls back to the title', () => {
    expect(
      buildSeoMeta({ title: 'About', seo: { title: 'About us', description: 'Who we are' } })
    ).toMatchObject({
      title: 'About us',
      description: 'Who we are',
      ogTitle: 'About us',
      ogDescription: 'Who we are',
      robots: undefined,
    });
    expect(buildSeoMeta({ title: 'About' }, { description: 'Fallback' })).toMatchObject({
      title: 'About',
      description: 'Fallback',
    });
  });

  it('keeps private pages out of search engines', () => {
    expect(buildSeoMeta({ title: 'Draft', private: true }).robots).toBe('noindex, nofollow');
  });

  it('adds a social image only when there is one', () => {
    expect(buildSeoMeta({ title: 'A' }, { image: 'https://a.example/img' })).toMatchObject({
      ogImage: 'https://a.example/img',
      twitterCard: 'summary_large_image',
    });
    expect(buildSeoMeta(null)).toEqual({
      title: undefined,
      description: undefined,
      ogTitle: undefined,
      ogDescription: undefined,
      robots: undefined,
    });
  });
});
