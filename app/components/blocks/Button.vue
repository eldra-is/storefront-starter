<script setup lang="ts">
import type { BlockButtonEntry } from '~~/.eldra/web-studio';

const { item } = defineProps<{ item: BlockButtonEntry }>();

const href = computed(() => item.data.href?.trim() ?? '');
// Absolute URLs and mailto:/tel: links leave the router: NuxtLink must not resolve them as routes.
const isExternal = computed(() => isExternalHref(href.value));
const variantClass = computed(() =>
  item.data.variant?.value === 'SECONDARY'
    ? 'border-ink bg-paper text-ink hover:bg-ink hover:text-paper'
    : 'border-ink bg-ink text-paper hover:bg-paper hover:text-ink'
);
</script>

<template>
  <NuxtLink
    v-if="href"
    :to="href"
    :external="isExternal"
    :target="isExternal ? '_blank' : undefined"
    :rel="isExternal ? 'noopener noreferrer' : undefined"
    class="inline-flex min-h-11 items-center justify-center justify-self-start border px-6 text-[11px] tracking-[0.14em] uppercase transition-colors duration-150"
    :class="variantClass"
    data-testid="block-button"
  >
    {{ item.data.label }}
  </NuxtLink>
</template>
