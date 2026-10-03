import { describe, expect, it } from 'vitest';
import { mediaSrc, mediaSrcset } from '../../app/utils/images';

const url = 'https://assets.example.com/a/b';

describe('image variants', () => {
  it('picks the smallest variant at least as wide as the display width', () => {
    expect(mediaSrc(url, 300)).toBe(`${url}/sm`);
    expect(mediaSrc(url, 800)).toBe(`${url}/md`);
    expect(mediaSrc(url, 801)).toBe(`${url}/lg`);
    expect(mediaSrc(url, 5000)).toBe(`${url}/xl`);
    expect(mediaSrc(`${url}/`)).toBe(`${url}/md`);
  });

  it('lists every variant with its width', () => {
    expect(mediaSrcset(url)).toBe(
      `${url}/sm 400w, ${url}/md 800w, ${url}/lg 1200w, ${url}/xl 1920w`
    );
  });
});
