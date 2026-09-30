<script setup lang="ts">
import type { HomeHeroData } from '~~/.eldra/web-studio';

defineProps<{ hero: HomeHeroData }>();
</script>

<template>
  <section
    class="text-paper relative grid min-h-[calc(100vh-var(--header-h))] items-end justify-items-start bg-[#111]"
    data-testid="home-hero"
  >
    <ContentMedia
      v-if="hero.image?.[0]?.url"
      :asset="hero.image[0]"
      :alt="hero.image[0].altText || hero.title"
      sizes="100vw"
      priority
      class="absolute inset-0 h-full w-full object-cover opacity-90"
    />
    <div class="relative max-w-[640px] px-[clamp(16px,4vw,48px)] pb-16">
      <h1
        class="text-[clamp(22px,3.2vw,34px)] leading-[1.15] font-light tracking-[0.08em] uppercase"
      >
        {{ hero.title }}
      </h1>
      <p v-if="hero.subtitle" class="mt-3 text-[13px] tracking-[0.08em]">
        {{ hero.subtitle }}
      </p>
      <NuxtLink
        v-if="hero.ctaLink && hero.ctaText"
        :to="hero.ctaLink"
        class="border-paper bg-paper text-ink hover:text-paper mt-7 inline-flex min-h-11 items-center justify-center border px-6 text-[11px] tracking-[0.14em] uppercase transition-colors duration-150 hover:bg-transparent"
      >
        {{ hero.ctaText }}
      </NuxtLink>
    </div>
  </section>
</template>
