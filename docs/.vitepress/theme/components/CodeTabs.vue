<script setup lang="ts">
import { computed, ref } from 'vue';
import { highlightCode } from './highlight';
import type { Snippet } from './snippets';

const props = defineProps<{
  title: string;
  intro?: string;
  snippets: Snippet[];
}>();

const active = ref(0);

const current = computed(() => props.snippets[active.value]);
const highlighted = computed(() => highlightCode(current.value.code));
</script>

<template>
  <section class="demo-section">
    <h2 class="demo-section-title">{{ title }}</h2>
    <p v-if="intro" class="demo-section-prose">{{ intro }}</p>

    <div class="demo-snippet-tabs">
      <button
        v-for="(snip, i) in snippets"
        :key="snip.title"
        class="demo-snippet-tab"
        :class="{ 'is-active': active === i }"
        @click="active = i"
      >
        {{ snip.title }}
      </button>
    </div>

    <div class="demo-snippet-card">
      <p class="demo-snippet-desc">{{ current.description }}</p>
      <pre class="demo-snippet-pre"><code class="demo-snippet-code" v-html="highlighted" /></pre>
    </div>
  </section>
</template>
