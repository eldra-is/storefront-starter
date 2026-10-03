<script setup lang="ts">
import { RichText } from '@eldrajs/vue';
import type { RichTextDocument } from '@eldrajs/rich-text';

// The CMS delivers rich text as a TipTap document; the SDK's UI library renders it.
defineProps<{ node: unknown }>();
</script>

<template>
  <RichText :content="node as RichTextDocument" class="prose" />
</template>
