<script setup lang="ts">
import type { BlockHeadingEntry } from '~~/.eldra/web-studio';

const { item } = defineProps<{ item: BlockHeadingEntry }>();

const sizeClass = computed(() => {
  switch (item.data.size?.value) {
    case 'SMALL':
      return 'text-lg';
    case 'LARGE':
      return 'text-[clamp(28px,4vw,44px)]';
    default:
      return 'text-[clamp(22px,3.2vw,34px)]';
  }
});
</script>

<template>
  <h2
    class="leading-[1.15] font-light tracking-[0.08em] uppercase"
    :class="sizeClass"
    data-testid="block-heading"
  >
    {{ item.data.heading }}
  </h2>
</template>
