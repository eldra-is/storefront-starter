<script setup lang="ts">
import type { InjectionKey } from 'vue';
import type { EldraCMSSchemaMap } from '~~/.eldra/web-studio';
import type { RenderableBlock } from '~/utils/blocks';

type ResolutionContext = {
  depthLevelIndex: number;
  resolvedRequests: Map<string, Promise<RenderableBlock | null>>;
  ancestorIds: Set<string>;
};

const resolutionContextKey = Symbol.for(
  'storefront.block-resolution'
) as InjectionKey<ResolutionContext>;

const { block, priority = false } = defineProps<{ block: RenderableBlock; priority?: boolean }>();

const { locale } = useLocale();
const parent = inject(resolutionContextKey, null);
const depthLevelIndex = parent?.depthLevelIndex ?? 0;
// One map per top-level block and its subtree (each block the page renders directly starts its own):
// two blocks under the same top-level block that reference the same entry share one request.
const resolvedRequests =
  parent?.resolvedRequests ?? new Map<string, Promise<RenderableBlock | null>>();
const ancestorIds = parent?.ancestorIds ?? new Set<string>();
const schemaApiId = blockSchemaApiId(block);
const entryKey = `${schemaApiId}:${block.id}`;
const isCircular = ancestorIds.has(entryKey);

provide(resolutionContextKey, {
  depthLevelIndex: depthLevelIndex + 1,
  resolvedRequests,
  ancestorIds: new Set([...ancestorIds, entryKey]),
});

const needsResolution = needsBlockResolution(block);
const renderedBlock = shallowRef<RenderableBlock | undefined>(needsResolution ? undefined : block);

if (needsResolution && schemaApiId && depthLevelIndex < MAX_BLOCK_DEPTH && !isCircular) {
  const eldra = useEldraClient();

  const resolveBlock = async () => {
    if (renderedBlock.value) return;
    let request = resolvedRequests.get(entryKey);
    if (!request) {
      request = eldra.cms
        .get(schemaApiId as keyof EldraCMSSchemaMap, block.id, { locale: locale.value, depth: 2 })
        .then((entry) => entry as unknown as RenderableBlock)
        .catch(() => null);
      resolvedRequests.set(entryKey, request);
    }
    const resolved = await request;
    // CMS content is optional decoration: a block that cannot be read renders nothing.
    if (!resolved) return;
    // Mutating the stub puts the resolved block in the page payload, so the client hydrates the
    // same tree the server rendered.
    Object.assign(block, resolved);
    renderedBlock.value = block;
  };

  if (import.meta.server) onServerPrefetch(resolveBlock);
  else void resolveBlock();
}
</script>

<template>
  <template v-if="renderedBlock">
    <BlocksText v-if="isBlockText(renderedBlock)" :item="renderedBlock" />
    <BlocksHeading v-else-if="isBlockHeading(renderedBlock)" :item="renderedBlock" />
    <BlocksImage
      v-else-if="isBlockImage(renderedBlock)"
      :item="renderedBlock"
      :priority="priority"
    />
    <BlocksCard v-else-if="isBlockCard(renderedBlock)" :item="renderedBlock" />
    <BlocksButton v-else-if="isBlockButton(renderedBlock)" :item="renderedBlock" />
    <BlocksEmbed v-else-if="isBlockEmbed(renderedBlock)" :item="renderedBlock" />
    <BlocksEntryList v-else-if="isBlockEntryList(renderedBlock)" :item="renderedBlock" />
  </template>
</template>
