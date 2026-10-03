import { describe, expect, it } from 'vitest';
import {
  blockSchemaApiId,
  isBlockCard,
  isBlockText,
  needsBlockResolution,
} from '../../app/utils/blocks';

describe('block helpers', () => {
  it('derives the schema api id from _type or schemaApiId', () => {
    expect(blockSchemaApiId({ id: '1', _type: 'entry_block_text' })).toBe('block_text');
    expect(
      blockSchemaApiId({ id: '1', schemaApiId: 'block_card', _type: 'entry_block_card' })
    ).toBe('block_card');
    expect(blockSchemaApiId({ id: '1' })).toBeUndefined();
  });

  it('resolves stubs and blocks holding unresolved entry stubs, nothing else', () => {
    expect(needsBlockResolution({ id: '1', _type: 'entry_block_text' })).toBe(true);
    expect(
      needsBlockResolution({
        id: '1',
        _type: 'entry_block_card',
        data: { blocks: [{ id: '2', _type: 'entry_block_text' }] },
      })
    ).toBe(true);
    expect(
      needsBlockResolution({
        id: '1',
        _type: 'entry_block_card',
        data: { blocks: [{ id: '2', _type: 'entry_block_text', data: {} }] },
      })
    ).toBe(false);
    expect(
      needsBlockResolution({
        id: '1',
        _type: 'entry_block_text',
        data: { content: { type: 'doc' } },
      })
    ).toBe(false);
  });

  it('tells block types apart', () => {
    expect(isBlockText({ id: '1', _type: 'entry_block_text', data: {} })).toBe(true);
    expect(isBlockCard({ id: '1', _type: 'entry_block_text', data: {} })).toBe(false);
  });

  it('recognises a block identified only by its schema api id', () => {
    expect(isBlockText({ id: '1', schemaApiId: 'block_text', data: {} })).toBe(true);
    expect(isBlockCard({ id: '1', schemaApiId: 'block_text', data: {} })).toBe(false);
  });
});
