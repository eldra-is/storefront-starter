<script setup lang="ts">
import type { HomeSectionData } from '~~/.eldra/web-studio';

const { section } = defineProps<{
  section: HomeSectionData<1>;
  flip?: boolean;
}>();

// CMS content: a link with an unsafe scheme (javascript:, data:) renders no call to action.
const ctaLink = computed(() => safeHref(section.ctaLink));
</script>

<template>
  <section class="px-[clamp(16px,4vw,48px)] py-16" data-testid="home-section">
    <div class="grid items-center gap-8 min-[900px]:grid-cols-2 min-[900px]:gap-16">
      <div class="bg-soft aspect-square" :class="{ 'min-[900px]:order-2': flip }">
        <ContentMedia
          v-if="section.image?.[0]?.url"
          :asset="section.image[0]"
          :alt="section.image[0].altText || section.title"
          sizes="(min-width: 900px) 50vw, 100vw"
          class="h-full w-full object-cover"
        />
      </div>
      <div>
        <p v-if="section.kicker" class="text-muted text-[11px] tracking-[0.14em] uppercase">
          {{ section.kicker }}
        </p>
        <h2
          class="mt-2.5 mb-5 text-[clamp(22px,3.2vw,34px)] leading-[1.15] font-light tracking-[0.08em] uppercase"
        >
          {{ section.title }}
        </h2>
        <ContentRichText v-if="section.body" :node="section.body" />
        <NuxtLink
          v-if="ctaLink && section.ctaText"
          :to="ctaLink"
          class="border-ink bg-paper text-ink hover:bg-ink hover:text-paper inline-flex min-h-11 items-center justify-center border px-6 text-[11px] tracking-[0.14em] uppercase transition-colors duration-150"
        >
          {{ section.ctaText }}
        </NuxtLink>
      </div>
    </div>
  </section>
</template>
