<script setup lang="ts">
import type { RenderableBlock } from '~/utils/blocks';

const route = useRoute();
const { locale } = useLocale();
const slug = computed(() => String(route.params.slug));

const { data: page } = await useAsyncData(
  () => `page:${locale.value}:${slug.value}`,
  () => useCms().page(slug.value)
);
if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Page not found' });
}

const blocks = computed(() => (page.value?.data.blocks ?? []) as RenderableBlock[]);
const seo = computed(() => buildSeoMeta(page.value?.data));
useSeoMeta({
  title: () => seo.value.title,
  description: () => seo.value.description,
  ogTitle: () => seo.value.ogTitle,
  ogDescription: () => seo.value.ogDescription,
  robots: () => seo.value.robots,
});
</script>

<template>
  <article v-if="page" class="px-[clamp(16px,4vw,48px)] py-16" data-testid="content-page">
    <h1 class="text-[clamp(22px,3.2vw,34px)] leading-[1.15] font-light tracking-[0.08em] uppercase">
      {{ page.data.title }}
    </h1>
    <div class="mt-8 grid max-w-[62rem] gap-8">
      <BlocksRenderer
        v-for="(block, index) in blocks"
        :key="block.id"
        :block="block"
        :priority="index === 0"
      />
    </div>
  </article>
</template>
