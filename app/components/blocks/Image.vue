<script setup lang="ts">
import type { BlockImageEntry } from '~~/.eldra/web-studio';

const { item, priority = false } = defineProps<{ item: BlockImageEntry; priority?: boolean }>();

const asset = computed(() => item.data.image?.[0]);
const link = computed(() => item.data.link?.trim() ?? '');
const isExternal = computed(() => isExternalHref(link.value));
const alt = computed(() => (item.data.decorative ? '' : undefined));
</script>

<template>
  <figure v-if="asset" class="m-0" data-testid="block-image">
    <NuxtLink
      v-if="link"
      :to="link"
      :external="isExternal"
      :target="isExternal ? '_blank' : undefined"
      :rel="isExternal ? 'noopener noreferrer' : undefined"
    >
      <ContentMedia
        :asset="asset"
        :alt="alt"
        :width="item.data.width"
        :priority="priority"
        class="h-auto max-w-full"
      />
    </NuxtLink>
    <ContentMedia
      v-else
      :asset="asset"
      :alt="alt"
      :width="item.data.width"
      :priority="priority"
      class="h-auto max-w-full"
    />
  </figure>
</template>
