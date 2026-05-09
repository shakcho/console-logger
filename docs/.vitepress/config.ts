import { defineConfig } from 'vitepress';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Read the package version once at config load. The release pipeline bumps
// package.json + commits + publishes, and the next docs build picks up the
// new version automatically — no manual edit of this file needed.
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
) as { version: string };

const SITE_URL = 'https://console-logger.saktichourasia.dev';
const SITE_TITLE = 'Console Logger';
const SITE_TAGLINE = 'JavaScript Logger for Browser & Node.js';
const DEFAULT_DESC =
  'Console Logger is a structured, namespaced JavaScript and TypeScript logger for browser and Node.js. Six log levels, child loggers, beautiful console output, configurable timestamps, redaction, and flexible transports.';

export default defineConfig({
  title: SITE_TITLE,
  titleTemplate: `:title — ${SITE_TITLE}`,
  description: DEFAULT_DESC,
  appearance: 'dark',
  base: '/',

  sitemap: {
    hostname: SITE_URL,
  },

  vite: {
    resolve: {
      alias: {
        'konsole-logger': fileURLToPath(new URL('../../src/index.ts', import.meta.url)),
      },
    },
  },

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['meta', { name: 'author', content: 'Sakti Kumar Chourasia' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: SITE_TITLE }],
    ['meta', { property: 'og:image', content: `${SITE_URL}/logo.svg` }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:image', content: `${SITE_URL}/logo.svg` }],
    ['meta', { name: 'twitter:creator', content: '@shakcho' }],
    [
      'script',
      {
        defer: '',
        src: 'https://cdn.salesflyer.app/t.js?v=15a3f536',
        'data-website-id': 'sf_P24rzGxl2sbp1C0T',
        'data-host-url': 'http://api.salesflyer.app',
        'data-performance': 'true',
      },
    ],
    [
      'script',
      { type: 'application/ld+json' },
      JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'WebSite',
            '@id': `${SITE_URL}/#website`,
            url: SITE_URL,
            name: SITE_TITLE,
            description: DEFAULT_DESC,
            inLanguage: 'en',
          },
          {
            '@type': 'SoftwareApplication',
            '@id': `${SITE_URL}/#software`,
            name: 'konsole-logger',
            alternateName: ['Console Logger', 'Konsole'],
            description: DEFAULT_DESC,
            applicationCategory: 'DeveloperApplication',
            operatingSystem: 'Cross-platform (Browser, Node.js)',
            programmingLanguage: ['JavaScript', 'TypeScript'],
            url: SITE_URL,
            downloadUrl: 'https://www.npmjs.com/package/konsole-logger',
            license: 'https://opensource.org/licenses/MIT',
            offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
            author: {
              '@type': 'Person',
              name: 'Sakti Kumar Chourasia',
              url: 'https://saktichourasia.dev',
            },
          },
        ],
      }),
    ],
  ],

  transformHead({ pageData, siteData }) {
    const path = pageData.relativePath.replace(/(?:index)?\.md$/, '');
    const canonical = `${SITE_URL}/${path}`.replace(/\/+$/, '/');
    const desc =
      (pageData.frontmatter.description as string | undefined) ?? siteData.description;

    // Match VitePress's <title> rule: titleTemplate: false → use bare title.
    const titleText = pageData.title || siteData.title;
    const tt = pageData.frontmatter.titleTemplate;
    const fullTitle =
      tt === false || titleText === siteData.title
        ? titleText
        : `${titleText} — ${SITE_TITLE}`;

    return [
      ['link', { rel: 'canonical', href: canonical }],
      ['meta', { property: 'og:url', content: canonical }],
      ['meta', { property: 'og:title', content: fullTitle }],
      ['meta', { property: 'og:description', content: desc }],
      ['meta', { name: 'twitter:title', content: fullTitle }],
      ['meta', { name: 'twitter:description', content: desc }],
    ];
  },

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API', link: '/api/' },
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
