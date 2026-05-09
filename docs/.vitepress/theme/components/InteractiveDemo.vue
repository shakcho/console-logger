<script setup lang="ts">
import { computed, onMounted, ref, watch, nextTick } from 'vue';
import { Konsole } from 'konsole-logger';
import {
  NAMESPACES,
  LEVELS,
  loggers,
  logTick,
  bumpTick,
  exposeOnce,
  LEVEL_MESSAGES,
  formatTime,
  formatFields,
  type Level,
  type Namespace,
} from './loggers';

interface DisplayLog {
  id: number;
  level: Level;
  namespace: string;
  msg: string;
  fields: Record<string, unknown>;
  timestamp: Date;
}

const activeNs = ref<Namespace>('App');
const useChild = ref(false);
const globalPrint = ref(false);
const displayLogs = ref<DisplayLog[]>([]);

const consoleRef = ref<HTMLDivElement | null>(null);
let logId = 0;

const childCache: Record<string, Konsole> = {};
const childBindings: Record<string, Record<string, unknown>> = {};

function getChildLogger(ns: Namespace) {
  if (!childCache[ns]) {
    const bindings = {
      requestId: `req_${Math.random().toString(36).slice(2, 8)}`,
      userId: Math.floor(Math.random() * 9000 + 1000),
    };
    childCache[ns] = loggers[ns].child(bindings, { namespace: `${ns}:child` });
    childBindings[ns] = bindings;
  }
  return { logger: childCache[ns], bindings: childBindings[ns] };
}

function pushDisplay(level: Level, namespace: string, msg: string, fields: Record<string, unknown>) {
  logId++;
  displayLogs.value = [
    ...displayLogs.value.slice(-99),
    { id: logId, level, namespace, msg, fields, timestamp: new Date() },
  ];
}

function handleLog(level: Level) {
  const msgs = LEVEL_MESSAGES[level];
  const msg = msgs[Math.floor(Math.random() * msgs.length)];
  const fields: Record<string, unknown> = { ms: Math.floor(Math.random() * 400 + 1) };

  const ns = activeNs.value;
  if (useChild.value) {
    const { logger, bindings } = getChildLogger(ns);
    logger[level](msg, fields);
    pushDisplay(level, `${ns}:child`, msg, { ...bindings, ...fields });
  } else {
    loggers[ns][level](msg, fields);
    pushDisplay(level, ns, msg, fields);
  }
  bumpTick();
}

function toggleGlobalPrint() {
  globalPrint.value = !globalPrint.value;
  Konsole.enableGlobalPrint(globalPrint.value);
  pushDisplay('info', 'sys', `Global print ${globalPrint.value ? 'enabled' : 'disabled'}`, {});
}

function clearAll() {
  for (const ns of NAMESPACES) loggers[ns].clearLogs();
  displayLogs.value = [];
  logId = 0;
  bumpTick();
}

const totalBuffered = computed(() => {
  // Read logTick to subscribe to log events.
  void logTick.value;
  return NAMESPACES.reduce((n, ns) => n + loggers[ns].getStats().logCount, 0);
});

watch(
  displayLogs,
  () => {
    nextTick(() => {
      if (consoleRef.value) consoleRef.value.scrollTop = consoleRef.value.scrollHeight;
    });
  },
  { deep: true },
);

onMounted(() => {
  exposeOnce();
});
</script>

<template>
  <section class="demo-section">
    <h2 class="demo-section-title">Interactive Demo</h2>

    <div class="demo-row">
      <span class="demo-row-label">Namespace</span>
      <div class="demo-tabs">
        <button
          v-for="ns in NAMESPACES"
          :key="ns"
          class="demo-tab"
          :class="{ 'is-active': activeNs === ns }"
          @click="activeNs = ns"
        >
          {{ ns }}
        </button>
      </div>
    </div>

    <div class="demo-row">
      <span class="demo-row-label">Child Logger</span>
      <label class="demo-toggle">
        <input
          type="checkbox"
          v-model="useChild"
          style="display: none"
        />
        <span class="demo-toggle-track" :class="{ 'is-on': useChild }">
          <span class="demo-toggle-thumb" />
        </span>
        <span class="demo-toggle-label">
          <template v-if="useChild">
            <span class="demo-pill">requestId</span>
            <span class="demo-pill">userId</span> bound
          </template>
          <template v-else>off</template>
        </span>
      </label>
    </div>

    <div class="demo-row">
      <span class="demo-row-label">Log Level</span>
      <div class="demo-actions">
        <button
          v-for="level in LEVELS"
          :key="level"
          class="demo-btn"
          :data-level="level"
          @click="handleLog(level)"
        >
          {{ level }}
        </button>
      </div>
    </div>

    <div class="demo-row">
      <span class="demo-row-label">Controls</span>
      <div class="demo-actions">
        <button class="demo-btn" @click="toggleGlobalPrint">
          Print {{ globalPrint ? 'on' : 'off' }}
        </button>
        <button class="demo-btn" @click="clearAll">Clear All</button>
      </div>
    </div>
  </section>

  <section class="demo-section">
    <h2 class="demo-section-title">Output</h2>
    <div class="demo-console">
      <div class="demo-console-header">
        <div class="demo-console-dots">
          <span class="demo-console-dot" style="background: #fca5a5" />
          <span class="demo-console-dot" style="background: #fcd34d" />
          <span class="demo-console-dot" style="background: #86efac" />
        </div>
        <span class="demo-console-label">live output</span>
        <span class="demo-console-stats">{{ displayLogs.length }} lines</span>
      </div>
      <div ref="consoleRef" class="demo-console-body">
        <div v-if="displayLogs.length === 0" class="demo-console-empty">
          Click a log level above to start →
        </div>
        <div v-else>
          <div v-for="log in displayLogs" :key="log.id" class="demo-log-line">
            <span class="demo-log-time">{{ formatTime(log.timestamp) }}</span>
            <span class="demo-log-badge" :data-level="log.level">
              {{ log.level.slice(0, 3).toUpperCase() }}
            </span>
            <span class="demo-log-ns">[{{ log.namespace }}]</span>
            <span class="demo-log-msg">{{ log.msg }}</span>
            <span v-if="Object.keys(log.fields).length > 0" class="demo-log-fields">
              {{ formatFields(log.fields) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <div class="demo-statusbar">
      <div class="demo-status-item">
        <span class="demo-status-dot" :class="{ 'is-on': globalPrint }" />
        <span class="demo-status-label">Print</span>
        <span class="demo-status-value">{{ globalPrint ? 'on' : 'off' }}</span>
      </div>
      <div class="demo-status-item">
        <span class="demo-status-label">Active</span>
        <span class="demo-status-value">{{ activeNs }}</span>
      </div>
      <div class="demo-status-item">
        <span class="demo-status-dot" :class="{ 'is-on': useChild }" />
        <span class="demo-status-label">Child</span>
        <span class="demo-status-value">{{ useChild ? 'on' : 'off' }}</span>
      </div>
      <div class="demo-status-item">
        <span class="demo-status-label">Buffered</span>
        <span class="demo-status-value">{{ totalBuffered }} entries</span>
      </div>
    </div>
  </section>
</template>
