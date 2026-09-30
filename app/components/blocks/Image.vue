<script setup lang="ts">
import type { BlockImageEntry } from '~~/.eldra/web-studio';

const { item, priority = false } = defineProps<{ item: BlockImageEntry; priority?: boolean }>();

const asset = computed(() => item.data.image?.[0]);
// CMS content: a link with an unsafe scheme (javascript:, data:) leaves the image unlinked.
const link = computed(() => safeHref(item.data.link) ?? '');
const isExternal = computed(() => isExternalHref(link.value));
const newTab = computed(() => opensInNewTab(link.value));
const alt = computed(() => (item.data.decorative ? '' : undefined));
</script>

<template>
  <figure v-if="asset" class="m-0" data-testid="block-image">
    <NuxtLink
      v-if="link"
      :to="link"
      :external="isExternal"
      :target="newTab ? '_blank' : undefined"
      :rel="newTab ? 'noopener noreferrer' : undefined"
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
