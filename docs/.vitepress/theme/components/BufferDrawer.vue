<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { LogEntry } from 'konsole-logger';
import {
  NAMESPACES,
  LEVELS,
  loggers,
  logTick,
  formatTime,
  formatFields,
  type Level,
} from './loggers';

const drawerOpen = ref(false);
const typeFilter = ref<'all' | Level>('all');
const nsFilter = ref<'all' | string>('all');

// Launcher position (corner snap, draggable)
type Corner = 'br' | 'bl' | 'tr' | 'tl';
const corner = ref<Corner>('br');
const dragging = ref(false);
const pos = ref({ x: 0, y: 0 });
let dragOffset = { x: 0, y: 0 };
let didDrag = false;

const launcherStyle = computed(() => {
  if (dragging.value) {
    return { left: `${pos.value.x}px`, top: `${pos.value.y}px`, right: 'auto', bottom: 'auto' };
  }
  switch (corner.value) {
    case 'br': return { right: '24px', bottom: '24px' };
    case 'bl': return { left: '24px', bottom: '24px' };
    case 'tr': return { right: '24px', top: '76px' };
    case 'tl': return { left: '24px', top: '76px' };
  }
});

const totalBuffered = computed(() => {
  void logTick.value;
  return NAMESPACES.reduce((n, ns) => n + loggers[ns].getStats().logCount, 0);
});

function getAllLogs(): LogEntry[] {
  void logTick.value;
  const all: LogEntry[] = [];
  for (const ns of NAMESPACES) all.push(...(loggers[ns].getLogs() as LogEntry[]));
  return all.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

const filteredLogs = computed(() => {
  let logs = getAllLogs();
  if (nsFilter.value !== 'all') logs = logs.filter((l) => l.namespace === nsFilter.value);
  if (typeFilter.value !== 'all') logs = logs.filter((l) => l.level === typeFilter.value);
  return logs;
});

function startDrag(e: PointerEvent) {
  const target = e.currentTarget as HTMLDivElement;
  const rect = target.getBoundingClientRect();
  dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  pos.value = { x: rect.left, y: rect.top };
  dragging.value = true;
  didDrag = false;
  target.setPointerCapture(e.pointerId);
}

function onDrag(e: PointerEvent) {
  if (!dragging.value) return;
  pos.value = { x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y };
  didDrag = true;
}

function endDrag(e: PointerEvent) {
  if (!dragging.value) return;
  dragging.value = false;
  (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
  const cx = pos.value.x + 60;
  const cy = pos.value.y + 20;
  const isRight = cx > window.innerWidth / 2;
  const isBottom = cy > window.innerHeight / 2;
  corner.value = (isBottom ? (isRight ? 'br' : 'bl') : (isRight ? 'tr' : 'tl')) as Corner;
}

function onLauncherClick() {
  if (didDrag) {
    didDrag = false;
    return;
  }
  drawerOpen.value = true;
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') drawerOpen.value = false;
}

onMounted(() => {
  document.addEventListener('keydown', onKey);
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey);
});

function badgeLevel(l: string) {
  return (LEVELS as readonly string[]).includes(l) ? (l as Level) : ('info' as Level);
}
</script>

<template>
  <Teleport to="body">
    <div
      class="demo-launcher"
      :style="launcherStyle"
      :class="{ 'is-hidden': drawerOpen }"
      @pointerdown="startDrag"
      @pointermove="onDrag"
      @pointerup="endDrag"
      @click="onLauncherClick"
      v-show="!drawerOpen"
    >
      <div class="demo-launcher-pill">
        <span class="demo-launcher-icon">&gt;_</span>
        <span class="demo-launcher-label">Buffer</span>
        <span v-if="totalBuffered > 0" class="demo-launcher-count">{{ totalBuffered }}</span>
      </div>
    </div>

    <div
      class="demo-drawer-overlay"
      :class="{ 'is-open': drawerOpen }"
      @click="drawerOpen = false"
    />

    <div class="demo-drawer" :class="{ 'is-open': drawerOpen }">
      <div class="demo-drawer-handle" @click="drawerOpen = false" />
      <div class="demo-drawer-header">
        <div class="demo-drawer-title">
          <span class="demo-drawer-title-arrow">&gt;</span> Buffer
        </div>
        <div class="demo-drawer-filters">
          <div class="demo-drawer-filter-group">
            <span class="demo-drawer-filter-label">Level</span>
            <div class="demo-drawer-tabs">
              <button
                v-for="f in (['all', ...LEVELS] as const)"
                :key="f"
                class="demo-drawer-tab"
                :class="{ 'is-active': typeFilter === f }"
                @click="typeFilter = f as 'all' | Level"
              >
                {{ f === 'all' ? 'All' : f }}
              </button>
            </div>
          </div>
          <div class="demo-drawer-filter-group">
            <span class="demo-drawer-filter-label">Namespace</span>
            <div class="demo-drawer-tabs">
              <button
                v-for="ns in (['all', ...NAMESPACES] as const)"
                :key="ns"
                class="demo-drawer-tab"
                :class="{ 'is-active-ns': nsFilter === ns }"
                @click="nsFilter = ns"
              >
                {{ ns === 'all' ? 'All' : ns }}
              </button>
            </div>
          </div>
        </div>
        <button class="demo-drawer-close" @click="drawerOpen = false">×</button>
      </div>
      <div class="demo-drawer-content">
        <div v-if="filteredLogs.length === 0" class="demo-drawer-empty">
          No entries match the current filter
        </div>
        <div v-else>
          <div v-for="(log, i) in filteredLogs" :key="i" class="demo-log-line">
            <span class="demo-log-badge" :data-level="badgeLevel(log.level)">
              {{ log.level.slice(0, 3).toUpperCase() }}
            </span>
            <span class="demo-log-time">{{ formatTime(log.timestamp) }}</span>
            <span class="demo-log-ns">[{{ log.namespace }}]</span>
            <span class="demo-log-msg">{{ log.msg }}</span>
            <span
              v-if="log.fields && Object.keys(log.fields).length > 0"
              class="demo-log-fields"
            >
              {{ formatFields(log.fields) }}
            </span>
          </div>
        </div>
      </div>
      <div class="demo-drawer-footer">
        <div>
          <span class="demo-drawer-stat">
            Showing: <b style="color: var(--vp-c-text-1)">{{ filteredLogs.length }}</b>
          </span>
          <span class="demo-drawer-stat">
            Total: <b style="color: var(--vp-c-text-1)">{{ getAllLogs().length }}</b>
          </span>
        </div>
        <span>Press Esc to close</span>
      </div>
    </div>
  </Teleport>
</template>
