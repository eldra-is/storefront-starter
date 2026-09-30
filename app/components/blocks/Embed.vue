<script setup lang="ts">
import type { BlockEmbedEntry } from '~~/.eldra/web-studio';
import { safeEmbedUrl } from '~~/shared/utils/embed-policy';

const { item } = defineProps<{ item: BlockEmbedEntry }>();

const tag = computed(() => item.data.tag?.value);
const embedUrl = computed(() => safeEmbedUrl(tag.value, item.data.url));
const layoutStyle = computed(() => {
  const { aspectRatio, minHeight } = item.data;
  return {
    aspectRatio:
      aspectRatio && Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 16 / 9,
    minHeight:
      minHeight && Number.isFinite(minHeight) && minHeight > 0 ? `${minHeight}px` : undefined,
  };
});

const scriptHost = ref<HTMLDivElement>();

function mountScript() {
  const host = scriptHost.value;
  if (!host) return;
  host.replaceChildren();
  if (tag.value !== 'script' || !embedUrl.value) return;
  // Provider DOM stays outside Vue's children; a script rendered as HTML would not run on client navigation.
  const script = document.createElement('script');
  script.src = embedUrl.value;
  script.async = true;
  host.appendChild(script);
}

onMounted(() => {
  watch([scriptHost, embedUrl], mountScript, { immediate: true, flush: 'post' });
});
onBeforeUnmount(() => scriptHost.value?.replaceChildren());
</script>

<template>
  <div
    v-if="embedUrl"
    class="relative w-full min-w-0 overflow-hidden"
    :style="layoutStyle"
    data-testid="block-embed"
  >
    <iframe
      v-if="tag === 'iframe'"
      :src="embedUrl"
      :title="item.data.title"
      class="absolute inset-0 size-full border-0"
      loading="lazy"
      allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
      referrerpolicy="strict-origin-when-cross-origin"
      allowfullscreen
    />
    <embed
      v-else-if="tag === 'embed'"
      :src="embedUrl"
      :title="item.data.title"
      class="absolute inset-0 size-full border-0"
    />
    <div
      v-else-if="tag === 'script'"
      ref="scriptHost"
      role="group"
      :aria-label="item.data.title"
      class="absolute inset-0"
    />
  </div>
</template>
