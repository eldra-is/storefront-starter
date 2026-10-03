import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BLOCK_SCHEMA_API_IDS } from '../../app/utils/blocks';

interface Field {
  fieldId: string;
  type: string;
  localized?: boolean;
  validators?: { required?: boolean; unique?: boolean };
  relation?: { allowedSchemaRefs?: string[]; allowProducts?: boolean; multiple?: boolean };
}
interface Schema {
  ref: string;
  apiId: string;
  fields: Field[];
}
interface Entry {
  ref: string;
  schemaRef: string;
  data: Record<string, unknown>;
  localizations?: Record<string, Record<string, unknown>>;
  status: string;
}
interface Manifest {
  format: string;
  version: number;
  source: { organizationId: string };
  schemas: Schema[];
  entries: Entry[];
  media: unknown[];
}

const root = join(import.meta.dirname, '..', '..');
const manifest = JSON.parse(
  readFileSync(join(root, 'cms/content-model.eldra.json'), 'utf8')
) as Manifest;
const schemaByApiId = new Map(manifest.schemas.map((schema) => [schema.apiId, schema]));
const schemaByRef = new Map(manifest.schemas.map((schema) => [schema.ref, schema]));

/** Every schema the code reads and the fields it touches, with the type it expects. Update with the code. */
const READS: Record<string, Record<string, string>> = {
  navigation_item: {
    label: 'string',
    href: 'string',
    kind: 'select',
    active: 'bool',
    openInNewTab: 'bool',
  },
  site_header: { name: 'string', logo: 'media', items: 'reference' },
  site_footer: { tagline: 'string', note: 'string' },
  footer_link: { label: 'string', href: 'string', column: 'select', order: 'int' },
  home_hero: {
    title: 'string',
    subtitle: 'text',
    image: 'media',
    ctaText: 'string',
    ctaLink: 'string',
  },
  home_section: {
    title: 'string',
    kicker: 'string',
    body: 'rich-text',
    image: 'media',
    ctaText: 'string',
    ctaLink: 'string',
    order: 'int',
    active: 'bool',
  },
  page: { title: 'string', slug: 'slug', seo: 'seo', private: 'bool', blocks: 'reference' },
  block_text: { content: 'rich-text' },
  block_heading: { heading: 'string', size: 'select' },
  block_image: { image: 'media', width: 'int', link: 'string', decorative: 'bool' },
  block_card: { blocks: 'reference', center: 'bool', shadow: 'bool' },
  block_button: { label: 'string', href: 'string', variant: 'select' },
  block_embed: {
    title: 'string',
    tag: 'select',
    url: 'string',
    aspectRatio: 'float',
    minHeight: 'int',
  },
  block_entry_list: { title: 'string', list: 'list' },
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|vue)$/.test(name) ? [path] : [];
  });
}

/** Schema api ids named in code: cms.list('x'), getEntryByUniqueField('x', …) and 'entry_x' type guards. */
function schemaApiIdsInCode(): Set<string> {
  const found = new Set<string>();
  const patterns = [
    /(?:\blist|getEntryByUniqueField)\(\s*'([a-z][a-z0-9_]*)'/g,
    /'entry_([a-z][a-z0-9_]*)'/g,
  ];
  for (const file of ['app', 'server', 'shared'].flatMap((dir) => sourceFiles(join(root, dir)))) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of patterns)
      for (const match of source.matchAll(pattern)) found.add(match[1] ?? '');
  }
  return found;
}

describe('cms/content-model.eldra.json', () => {
  it('is a version 1 Eldra archive without media or product relations', () => {
    expect(manifest.format).toBe('eldra.cms');
    expect(manifest.version).toBe(1);
    expect(manifest.source.organizationId).not.toBe('');
    expect(manifest.media).toEqual([]);
    for (const schema of manifest.schemas) {
      for (const field of schema.fields) expect(field.relation?.allowProducts ?? false).toBe(false);
    }
  });

  it('lists in READS every schema the code names', () => {
    const inCode = [...schemaApiIdsInCode()].sort();
    expect(inCode.length).toBeGreaterThan(0);
    expect(inCode.filter((apiId) => !(apiId in READS))).toEqual([]);
  });

  it('lists in READS every block schema the renderer knows', () => {
    expect(BLOCK_SCHEMA_API_IDS.filter((apiId) => !(apiId in READS))).toEqual([]);
  });

  it('declares every schema and field the code reads, with the expected type', () => {
    const problems: string[] = [];
    for (const [apiId, fields] of Object.entries(READS)) {
      const schema = schemaByApiId.get(apiId);
      if (!schema) {
        problems.push(`missing schema ${apiId}`);
        continue;
      }
      for (const [fieldId, type] of Object.entries(fields)) {
        const field = schema.fields.find((f) => f.fieldId === fieldId);
        if (!field) problems.push(`missing field ${apiId}.${fieldId}`);
        else if (field.type !== type)
          problems.push(`${apiId}.${fieldId} is ${field.type}, code expects ${type}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('gives page a unique slug for getEntryByUniqueField', () => {
    const slug = schemaByApiId.get('page')?.fields.find((f) => f.fieldId === 'slug');
    expect(slug?.type).toBe('slug');
    expect(slug?.validators?.unique).toBe(true);
  });

  it('lets pages hold every block schema the renderer knows, and cards every other one', () => {
    const blockRefs = BLOCK_SCHEMA_API_IDS.map((apiId) => `schema:${apiId}`);
    const allowed = (apiId: string) =>
      schemaByApiId.get(apiId)?.fields.find((f) => f.fieldId === 'blocks')?.relation
        ?.allowedSchemaRefs ?? [];
    expect([...allowed('page')].sort()).toEqual([...blockRefs].sort());
    expect([...allowed('block_card')].sort()).toEqual(
      blockRefs.filter((ref) => ref !== 'schema:block_card').sort()
    );
  });

  it('resolves every schema and entry reference', () => {
    const entryRefs = new Set(manifest.entries.map((entry) => entry.ref));
    for (const entry of manifest.entries) {
      expect(schemaByRef.has(entry.schemaRef), entry.ref).toBe(true);
      for (const value of Object.values(entry.data)) {
        for (const item of Array.isArray(value) ? value : []) {
          if (item && typeof item === 'object' && (item as { kind?: string }).kind === 'entry') {
            expect(
              entryRefs.has((item as { ref: string }).ref),
              `${entry.ref} → ${(item as { ref: string }).ref}`
            ).toBe(true);
          }
        }
      }
    }
  });

  it('localizes every localized field in en-US and is-IS, and nothing else', () => {
    for (const entry of manifest.entries) {
      const schema = schemaByRef.get(entry.schemaRef);
      for (const field of schema?.fields ?? []) {
        const where = `${entry.ref}.${field.fieldId}`;
        if (field.localized) {
          expect(field.fieldId in entry.data, `${where} belongs in localizations`).toBe(false);
          const en = entry.localizations?.['en-US']?.[field.fieldId];
          const is = entry.localizations?.['is-IS']?.[field.fieldId];
          expect(en === undefined, where).toBe(is === undefined);
          if (field.validators?.required) expect(en, where).toBeTruthy();
        } else {
          expect(
            entry.localizations?.['en-US']?.[field.fieldId],
            `${where} is not localized`
          ).toBeUndefined();
          if (field.validators?.required) expect(entry.data[field.fieldId], where).toBeTruthy();
        }
      }
    }
  });

  it('ships the demo entries the spec names, all published', () => {
    const count = (apiId: string) =>
      manifest.entries.filter((e) => e.schemaRef === `schema:${apiId}`).length;
    expect(count('site_header')).toBe(1);
    const primaryHeader = manifest.entries.find((e) => e.ref === 'entry:site_header:primary');
    expect(primaryHeader).toBeDefined();
    expect((primaryHeader!.data.items as unknown[]).length).toBe(3);
    expect(count('site_footer')).toBe(1);
    expect(count('home_hero')).toBe(1);
    expect(count('home_section')).toBe(2);
    expect(
      manifest.entries.filter((e) => e.schemaRef === 'schema:page').map((e) => e.data.slug)
    ).toEqual(['about', 'shipping-and-returns']);
    expect(manifest.entries.every((e) => e.status === 'PUBLISHED')).toBe(true);
  });
});
