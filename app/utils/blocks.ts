import type {
  BlockButtonEntry,
  BlockCardEntry,
  BlockEmbedEntry,
  BlockEntryListEntry,
  BlockHeadingEntry,
  BlockImageEntry,
  BlockTextEntry,
} from '~~/.eldra/web-studio';

/** A block inside a page or card: resolved (with data), or a stub still to be fetched. */
export interface RenderableBlock {
  id: string;
  _type?: string;
  schemaApiId?: string;
  data?: unknown;
}

/** How many nested levels the renderer fetches on its own before it stops. */
export const MAX_BLOCK_DEPTH = 10;

export const BLOCK_SCHEMA_API_IDS = [
  'block_text',
  'block_heading',
  'block_image',
  'block_card',
  'block_button',
  'block_embed',
  'block_entry_list',
] as const;

export function blockSchemaApiId(block: RenderableBlock): string | undefined {
  return block.schemaApiId || block._type?.replace(/^entry_/, '') || undefined;
}

const hasUnresolvedEntry = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasUnresolvedEntry);
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.id === 'string' &&
    typeof entry._type === 'string' &&
    entry._type.startsWith('entry_')
  ) {
    // A resolved referenced entry is responsible for its own nested data.
    return entry.data == null;
  }
  return Object.values(entry).some(hasUnresolvedEntry);
};

export function needsBlockResolution(block: RenderableBlock): boolean {
  return block.data == null || hasUnresolvedEntry(block.data);
}

// Compared by schema api id, so a block that carries only `schemaApiId` (no `_type`) still renders.
export const isBlockText = (block: RenderableBlock): block is BlockTextEntry =>
  blockSchemaApiId(block) === 'block_text';
export const isBlockHeading = (block: RenderableBlock): block is BlockHeadingEntry =>
  blockSchemaApiId(block) === 'block_heading';
export const isBlockImage = (block: RenderableBlock): block is BlockImageEntry =>
  blockSchemaApiId(block) === 'block_image';
export const isBlockCard = (block: RenderableBlock): block is BlockCardEntry =>
  blockSchemaApiId(block) === 'block_card';
export const isBlockButton = (block: RenderableBlock): block is BlockButtonEntry =>
  blockSchemaApiId(block) === 'block_button';
export const isBlockEmbed = (block: RenderableBlock): block is BlockEmbedEntry =>
  blockSchemaApiId(block) === 'block_embed';
export const isBlockEntryList = (block: RenderableBlock): block is BlockEntryListEntry =>
  blockSchemaApiId(block) === 'block_entry_list';
