import type { ProductOption, ProductVariant } from '~/types/catalog';

export type OptionSelection = Record<string, string>;

const activeOf = (variants: ProductVariant[]) => variants.filter((v) => v.status !== 'INACTIVE');

const valueMap = (v: ProductVariant): OptionSelection =>
  Object.fromEntries((v.optionValues ?? []).map((ov) => [ov.optionId, ov.optionValueId]));

/** The default selection, computed from data alone so the server and the client agree. */
export function initialSelection(
  options: ProductOption[],
  variants: ProductVariant[]
): OptionSelection {
  const active = activeOf(variants);
  const first = active[0];
  if (options.length === 0 || !first) return {};
  if (active.length === 1) return valueMap(first);
  const map: OptionSelection = {};
  for (const option of options) {
    const firstValue = option.values[0];
    if (firstValue) map[option.id] = firstValue.id;
  }
  return map;
}

/** The active variant matching every selected value, or null while the selection is incomplete. */
export function resolveVariant(
  options: ProductOption[],
  variants: ProductVariant[],
  selected: OptionSelection
): ProductVariant | null {
  const active = activeOf(variants);
  if (options.length === 0) return active[0] ?? null;
  const entries = Object.entries(selected);
  if (entries.length !== options.length) return null;
  return (
    active.find((v) => {
      const map = valueMap(v);
      return entries.every(([optionId, valueId]) => map[optionId] === valueId);
    }) ?? null
  );
}

/** Whether some active variant carries this value together with every other selected value. */
export function isValueAvailable(
  variants: ProductVariant[],
  selected: OptionSelection,
  optionId: string,
  valueId: string
): boolean {
  return activeOf(variants).some((v) => {
    const map = valueMap(v);
    if (map[optionId] !== valueId) return false;
    return Object.entries(selected).every(([oid, vid]) => oid === optionId || map[oid] === vid);
  });
}
