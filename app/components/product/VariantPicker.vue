<script setup lang="ts">
import type { ProductOption, ProductVariant } from '~/types/catalog';
import type { OptionSelection } from '~/composables/useVariants';

const props = defineProps<{ options: ProductOption[]; variants: ProductVariant[] }>();
const selected = defineModel<OptionSelection>({ default: () => ({}) });

const available = (optionId: string, valueId: string) =>
  isValueAvailable(props.variants, selected.value, optionId, valueId);
</script>

<template>
  <div>
    <div
      v-for="(option, optionIndex) in options"
      :key="option.id"
      :class="{ 'mt-5': optionIndex > 0 }"
    >
      <p class="mb-2.5 text-[11px] tracking-[0.14em] uppercase">{{ option.name }}</p>
      <div class="flex flex-wrap gap-2" role="radiogroup" :aria-label="option.name">
        <button
          v-for="value in option.values"
          :key="value.id"
          type="button"
          role="radio"
          class="hover:border-ink h-10 min-w-11 border px-3.5 text-xs tracking-[0.06em] uppercase"
          :class="{
            'border-ink bg-ink text-paper': selected[option.id] === value.id,
            'border-rule': selected[option.id] !== value.id,
            'text-muted line-through': !available(option.id, value.id),
          }"
          :aria-checked="selected[option.id] === value.id"
          :data-testid="`option-${option.key}-${value.key}`"
          @click="selected = { ...selected, [option.id]: value.id }"
        >
          {{ value.name }}
        </button>
      </div>
    </div>
  </div>
</template>
