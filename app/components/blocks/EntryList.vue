<script setup lang="ts">
import type { BlockEntryListEntry } from '~~/.eldra/web-studio';

type ListedEntry = {
  id: string;
  schemaApiId?: string;
  _type?: string;
  data?: Record<string, unknown>;
};

const { item } = defineProps<{ item: BlockEntryListEntry }>();
const { locale } = useLocale();

// The list field arrives with its first page embedded; resolve it only when it did not.
const { data: entries } = await useAsyncData(
  `entry-list:${locale.value}:${item.id}`,
  async () => {
    const list = item.data.list;
    if (!list) return [];
    if (list.entries?.data) return list.entries.data as unknown as ListedEntry[];
    try {
      const resolved = await useEldraClient().cms.resolveEntryList(list, {
        locale: locale.value,
        depth: 1,
      });
      return (resolved.entries?.data ?? []) as unknown as ListedEntry[];
    } catch {
      return [];
    }
  },
  { default: () => [] as ListedEntry[] }
);

const hrefOf = (entry: ListedEntry) => {
  const schema = entry.schemaApiId ?? entry._type?.replace(/^entry_/, '');
  const slug = entry.data?.slug;
  return schema === 'page' && typeof slug === 'string' ? `/pages/${slug}` : undefined;
};
const titleOf = (entry: ListedEntry) => String(entry.data?.title ?? entry.data?.name ?? '');
</script>

<template>
  <section v-if="entries.length" data-testid="block-entry-list">
    <h2 v-if="item.data.title" class="mb-4 text-[11px] tracking-[0.14em] uppercase">
      {{ item.data.title }}
    </h2>
    <ul class="border-rule m-0 list-none border-t p-0">
      <li v-for="entry in entries" :key="entry.id" class="border-rule border-b py-4">
        <NuxtLink v-if="hrefOf(entry)" :to="hrefOf(entry)" class="hover:text-accent">{{
          titleOf(entry)
        }}</NuxtLink>
        <span v-else>{{ titleOf(entry) }}</span>
      </li>
    </ul>
  </section>
</template>
