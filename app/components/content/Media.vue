<script setup lang="ts">
import type { EldraCMSMediaAsset } from '~~/.eldra/web-studio';

const {
  asset,
  alt = undefined,
  width = undefined,
  sizes = undefined,
  priority = false,
} = defineProps<{
  asset: EldraCMSMediaAsset;
  alt?: string;
  width?: number | string;
  sizes?: string;
  priority?: boolean;
}>();

const displayWidth = computed(() => {
  const value = Number(width);
  return Number.isFinite(value) && value > 0 ? value : undefined;
});
</script>

<template>
  <img
    :src="mediaSrc(asset.url, displayWidth)"
    :srcset="mediaSrcset(asset.url)"
    :sizes="sizes ?? (displayWidth ? `${displayWidth}px` : '100vw')"
    :alt="alt ?? asset.altText ?? ''"
    :width="displayWidth"
    :loading="priority ? 'eager' : 'lazy'"
    :fetchpriority="priority ? 'high' : undefined"
    decoding="async"
  />
</template>
