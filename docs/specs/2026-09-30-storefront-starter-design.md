# Storefront starter: design

Date: 2026-09-30. Status: approved in conversation; this document is the written spec. Companion to the `eldra-storefront` plugin spec in `eldra-is/eldra-plugins`.

## Purpose

A public, MIT-licensed Nuxt storefront that anyone can clone to build a site on the Eldra public API. It is the template the `eldra-storefront` plugin scaffolds from, and it is usable on its own with GitHub's "Use this template". It carries Eldra's conventions for connecting to Studio, reading content, selling, and modelling content, so a site built from it is built the way Eldra builds sites.

It is derived from an internal customer site that already has commerce, CMS pages, a content-model archive and end-to-end tests, with the customer removed. A second internal site contributes its generic block renderer for content pages. Neither source repository is changed by this work; both are read only.

## Audience

Customers' developers and Eldra staff alike. Consequences:

- No internal hostnames, credentials, deploy hooks or Cloudflare configuration. Deployment is the site owner's business; the README says what a host needs (Node 22, a static or SSR target, the environment variables) and nothing more.
- The default API is production (`https://web.eldra.app/api`). Any other environment is an environment variable.
- Everything a customer would change is either content in Studio or a clearly marked file.

## Stack

Nuxt 4, Vue 3, TypeScript, Pinia, Tailwind v4 through the official Vite plugin, `@eldrajs/sdk`, `@eldrajs/vue`, `@eldrajs/rich-text`, `@nuxtjs/i18n`, Playwright, oxlint and oxfmt with the shared config. pnpm only, Node 22 or later. The `.npmrc` pins the public scopes to npmjs. No dependency on Eldra's internal UI library.

## Layout

```
storefront-starter/
├── app/
│   ├── components/
│   │   ├── blocks/          # generic block renderer for `page` content (from the CMS-only site)
│   │   ├── home/            # flat home sections (hero, section)
│   │   ├── product/         # product card, gallery, variant picker, price
│   │   ├── cart/            # cart lines, discount, checkout hand-off
│   │   ├── content/         # RichText wrapper, media, link overrides
│   │   └── layout/          # header, footer, navigation, locale switch
│   ├── composables/         # useEldraClient, useCms, useCatalog, useAvailability, useLocale, useVariants
│   ├── pages/               # index, shop, products/[slug], collections/[slug], pages/[slug], cart
│   ├── stores/cart.ts
│   ├── types/               # storefront types derived from SDK types, never retyped
│   └── utils/               # seo, images, price formatting
├── shared/utils/            # eldra-client.ts, embed policy
├── server/                  # Nitro routes that need server-only config (sitemap, preview)
├── cms/
│   └── content-model.eldra.json   # the schemas and demo entries this starter expects
├── i18n/                    # en-US and is-IS message files
├── tests/e2e/               # Playwright, fixtures tied to the content model
├── .env.example
├── CLAUDE.md                # conventions for the site built from this starter
├── README.md
└── LICENSE
```

## Connecting to Studio

Environment variables, documented in `.env.example` and README:

| Variable | Meaning |
| --- | --- |
| `ELDRA_ORG_ID` | organization id or alias, required |
| `BASE_API_URL` | gateway origin, default production, normalized to end in `/api` |
| `NUXT_PUBLIC_CHECKOUT_URL` | checkout app origin, default production |
| `NUXT_PUBLIC_DEFAULT_LOCATION_ID` | inventory location for stock badges; unset means no badges |
| `PREVIEW_TOKEN` | server-only; when set, server-side reads see drafts |
| `NUXT_SITE_URL`, `NUXT_SITE_INDEXABLE` | canonical URL and robots |

Rules carried over: every read goes through the SDK client from `useEldraClient()`, never a raw fetch; org id and preview token are server-only in production builds; the generated `.eldra/web-studio/` types are produced by the SDK's Vite plugin against the org and committed by the site, not by the starter, which ships them ignored and regenerates on first build.

## Content model

`cms/content-model.eldra.json` in the Eldra archive format (`format: eldra.cms`, `version: 1`) declares every schema the starter reads and a small set of demo entries:

- `site_header` and `navigation_item` for the menu, `site_footer` and `footer_link` for the footer.
- `home_hero` and `home_section` for the home page, flat and repeatable.
- `page` with `slug`, `title`, `seo`, `private` and a `blocks` tree for the generic block renderer, with the block sub-schemas the renderer knows: text, heading, image, card, button, embed, entry list.
- Demo entries: one header with three items, one footer, one hero, two home sections, an "About" page and a "Shipping and returns" page. Localized fields carry `en-US` and `is-IS`.

Catalog data (categories, products, a discount) is not part of the manifest; the demo shop reads whatever the organization has, and the README shows how to add products in Studio. A future MCP product tool changes that.

How the manifest reaches an organization: the `eldra-storefront` plugin's `content-model` command creates what is missing through the MCP. Without the plugin, importing the archive through Studio's content import is safe only into an organization with no CMS content yet, because that importer replaces matched schemas and drops media links on matched entries; the README says so plainly.

## Conventions the starter fixes

- **Ownership.** Editable content and catalog data live in Studio. Routes, layout, presentation, application state and the checkout hand-off live in code.
- **Reads.** CMS entries by unique slug with explicit depth; lists paged; every call passes the locale. CMS content is optional decoration: a missing entry renders nothing, never an error page.
- **Blocks and sections.** Two composition models, both shipped: flat section schemas for the home page, a recursive block tree for content pages. The block renderer resolves unexpanded references lazily with a depth limit and in-flight de-duplication.
- **Cart.** Session id persisted with the SDK's cart session helper under a starter-prefixed key; cart state skips hydration; cart markup renders client-only; 404 forgets the cart and retries once; 409 surfaces as out of stock. Checkout is a hand-off URL, and the storefront ends there.
- **Order recovery.** A dedicated `/cart?recovery=<token>` handling with restored, partial and expired states.
- **Prices.** One `formatPrice(amount, currency, locale)` helper using `Intl.NumberFormat` with the locale passed explicitly so server and browser agree; currency comes from the organization, never hard-coded.
- **Images.** Responsive `srcset` from asset URL variants, in one component.
- **SEO.** One `buildSeoMeta(entry)` helper reading the `seo` field with per-type fallbacks; `noindex` when `private` is true; sitemap from published entries.
- **i18n.** Two locales shipped, cookie-selected with a reload; the locale list is the organization's, read once at startup.
- **Errors.** Branch on the SDK error's `errorId`, never on message text.

## What is deliberately left out

Deployment configuration of any kind, analytics, customer-facing copy outside the CMS, the internal UI library, an admin or preview UI, multi-framework variants.

## Testing

- `pnpm lint`, `pnpm format:check`, `pnpm typecheck` in CI.
- Playwright end-to-end against a running dev server pointed at an organization seeded from the manifest: home, a content page, the shop, a product, the cart and hand-off link. Fixtures are slugs from the manifest, not ids.
- A manifest test asserts every schema the code reads exists in `cms/content-model.eldra.json` with the fields the code touches.

## Releases

release-please, conventional commits, tags `vX.Y.Z`. The plugin's template registry pins a tag. Main is protected; every change is a pull request.

## Build order

1. Repository skeleton, tooling, license, README, CLAUDE.md.
2. Copy the commerce site's app, strip customer content and brand, generalize prices, ports and keys.
3. Bring in the block renderer and the `page` schema from the CMS-only site.
4. Write the content-model manifest and the demo entries.
5. Tests and CI.
6. First tagged release, then the plugin points at it.
