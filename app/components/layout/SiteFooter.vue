<script setup lang="ts">
import type { FooterLinkData } from '~~/.eldra/web-studio';

const { locale } = useLocale();
const organization = useOrganization();
const brand = useAppConfig().brand.name;
const { data } = await useAsyncData(
  () => `footer:${locale.value}`,
  () => useCms().footer(),
  { default: () => ({ links: [] as FooterLinkData[], footer: null }) }
);

const columns = computed(() => {
  const groups = new Map<string, { label: string; links: FooterLinkData[] }>();
  for (const link of data.value.links) {
    // An organization without commerce has no shop pages to link to.
    if (!organization.value.commerce && isCommercePath(link.href ?? '')) continue;
    const column = link.column ?? { value: 'shop', label: 'Shop' };
    const group = groups.get(column.value) ?? { label: column.label, links: [] };
    group.links.push(link);
    groups.set(column.value, group);
  }
  return [...groups.values()];
});

const isExternal = (href?: string) => /^(https?:|mailto:)/.test(href ?? '');
</script>

<template>
  <footer class="px-[clamp(16px,4vw,48px)] pb-10" data-testid="site-footer">
    <hr class="border-rule m-0 border-0 border-t" />
    <div class="grid grid-cols-2 gap-8 py-10 pt-12 md:grid-cols-[2fr_repeat(3,1fr)]">
      <div>
        <p class="text-[15px] tracking-[0.2em] uppercase">
          {{ data.footer?.tagline ?? brand }}
        </p>
      </div>
      <div v-for="column in columns" :key="column.label">
        <p class="text-muted mb-3.5 text-[11px] tracking-[0.14em] uppercase">
          {{ column.label }}
        </p>
        <ul class="m-0 grid list-none gap-2.5 p-0">
          <li v-for="link in column.links" :key="link.href ?? link.label">
            <a
              v-if="isExternal(link.href)"
              :href="link.href"
              target="_blank"
              rel="noopener noreferrer"
              class="hover:text-accent inline-flex"
              >{{ link.label }}</a
            >
            <NuxtLink v-else :to="link.href" class="hover:text-accent inline-flex">
              {{ link.label }}
            </NuxtLink>
          </li>
        </ul>
      </div>
    </div>
    <p class="text-muted text-[11px] tracking-[0.08em]">{{ data.footer?.note ?? '' }}</p>
  </footer>
</template>
