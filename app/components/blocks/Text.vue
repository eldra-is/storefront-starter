<script setup lang="ts">
import type { BlockTextEntry } from '~~/.eldra/web-studio';

defineProps<{ item: BlockTextEntry }>();
</script>

<template>
  <div v-if="item.data.content" data-testid="block-text">
    <ContentRichText :node="item.data.content" />
  </div>
</template>
