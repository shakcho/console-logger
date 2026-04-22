import { defineConfig } from 'vitepress';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Read the package version once at config load. The release pipeline bumps
// package.json + commits + publishes, and the next docs build picks up the
// new version automatically — no manual edit of this file needed.
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
) as { version: string };

export default defineConfig({
  title: 'Console',
  description: 'Structured, namespaced logging for browser and Node.js',
  appearance: 'dark',
  base: '/docs/',

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['meta', { name: 'description', content: 'Console is a structured, namespaced logging library for JavaScript and TypeScript. Works in browser and Node.js. Numeric log levels, child loggers, beautiful terminal output, and flexible transports.' }],
    ['meta', { name: 'keywords', content: 'javascript logger, typescript logger, structured logging, namespaced logging, browser logger, node logger, child logger, pino, pino alternative, winston, bunyan, ndjson, log levels, zero dependency, isomorphic, file rotation, log rotation, devtools, lightweight, fast logger, esm' }],
    ['meta', { property: 'og:description', content: 'Structured, namespaced logging for browser and Node.js. Numeric log levels, child loggers, beautiful terminal output, and flexible transports.' }],
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API', link: '/api/' },
      { text: 'Live Demo', link: 'https://console-logger.saktichourasia.dev' },
      {
        text: `v${pkg.version}`,
        items: [
          { text: 'Changelog', link: '/changelog' },
          { text: 'Contributing', link: '/contributing' },
        ],
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'What is Console?', link: '/guide/' },
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Configuration', link: '/guide/configuration' },
          ],
        },
        {
          text: 'Core Concepts',
          items: [
            { text: 'Namespaces & Child Loggers', link: '/guide/namespaces' },
            { text: 'Async Context Propagation', link: '/guide/async-context' },
            { text: 'Log Levels & Output', link: '/guide/conditional-logging' },
            { text: 'Timestamps', link: '/guide/timestamps' },
            { text: 'Redaction', link: '/guide/redaction' },
            { text: 'Transports', link: '/guide/transports' },
          ],
        },
        {
          text: 'Advanced',
          items: [
            { text: 'Viewing Logs', link: '/guide/viewing-logs' },
            { text: 'Browser Debugging', link: '/guide/browser-debugging' },
            { text: 'Performance', link: '/guide/performance' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Overview', link: '/api/' },
            { text: 'Konsole Class', link: '/api/konsole' },
            { text: 'Types', link: '/api/types' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/shakcho/console-logger' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: `Copyright © 2024–${new Date().getFullYear()} <a href="https://saktichourasia.dev" target="_blank" rel="noreferrer">Sakti Kumar Chourasia</a>`,
    },

    search: {
      provider: 'local',
    },
  },
});
