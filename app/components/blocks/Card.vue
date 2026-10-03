<script setup lang="ts">
import type { BlockCardEntry } from '~~/.eldra/web-studio';
import type { RenderableBlock } from '~/utils/blocks';

const { item } = defineProps<{ item: BlockCardEntry }>();
const children = computed(() => (item.data.blocks ?? []) as RenderableBlock[]);
</script>

<template>
  <article
    class="bg-soft grid gap-4 p-6 md:p-10"
    :class="{ 'justify-items-center text-center': item.data.center, 'shadow-sm': item.data.shadow }"
    data-testid="block-card"
  >
    <BlocksRenderer v-for="child in children" :key="child.id" :block="child" />
  </article>
</template>
