import { describe, expect, it } from 'vitest';
import { PACK_INFO, WORD_PACKS } from './words';

describe('chalk word packs', () => {
  it('includes Liên Quân and HUST topics with playable word lists', () => {
    expect(PACK_INFO.map((pack) => pack.id)).toEqual(expect.arrayContaining(['lienquan', 'hust']));
    expect(WORD_PACKS.lienquan).toContainEqual({ word: 'Nakroth', difficulty: 2 });
    expect(WORD_PACKS.lienquan.length).toBeGreaterThan(70);
    expect(WORD_PACKS.hust).toContainEqual({ word: 'Tagashira', difficulty: 3 });
    expect(WORD_PACKS.hust).toContainEqual({ word: 'Job Fair', difficulty: 2 });
  });

  it('provides a word list for every selectable topic', () => {
    for (const pack of PACK_INFO) {
      expect(WORD_PACKS[pack.id]?.length, `word list for ${pack.id}`).toBeGreaterThan(0);
    }
  });
});
