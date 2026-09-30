# Storefront development context

A Nuxt storefront on the Eldra public API, built from `eldra-is/storefront-starter`. Components are plain and meant to be restyled; the data model and the SDK usage are what carry over.

## Stack and commands

- Nuxt 4, Vue 3, TypeScript, Pinia; Tailwind CSS v4 through its Vite plugin, tokens in `app/assets/css/main.css`; `@nuxtjs/i18n`.
- pnpm only, Node 22.19 or later; `pnpm-lock.yaml` is authoritative.
- `pnpm dev` (port 3000), `pnpm build`, `pnpm typecheck`, `pnpm lint:check`, `pnpm format:check`, `pnpm test`, `pnpm test:e2e`. Run lint, format, typecheck and unit tests before handing off a change.

## Ownership

Editable content and catalog data live in Studio. Routes, layout, presentation, accessibility, application state and the checkout hand-off live in code. Do not add customer-facing copy to code; add a CMS field.

## Talking to Eldra

- Every read goes through the SDK client from `useEldraClient()` (Nitro routes: `createConfiguredEldraClient()`); never `$fetch` an Eldra path.
- `.eldra/web-studio/` is generated from the organization's schemas and the gateway contract by the SDK's Vite plugin on every dev start and build. Import CMS types from `~~/.eldra/web-studio`; derive storefront types from SDK types (`app/types/catalog.ts`), never retype them.
- CMS entries are read by unique slug (`cms.getEntryByUniqueField('page', 'slug', …)`) with an explicit `depth`; lists pass `pageSize`; every call passes `locale`.
- CMS content is optional decoration: a missing entry renders nothing, never an error page. A missing page slug is a 404.
- Errors: branch on `errorId` or `code` through `app/utils/errors.ts`, never on message text.
- The preview token is server-only (`runtimeConfig.previewToken`); never expose it. There is no preview route — setting `PREVIEW_TOKEN` is what makes server-side reads include drafts.
- Currency, locales and the commerce feature come from the organization, read once per server process by `app/plugins/organization.ts` (`useOrganization()`); restart the server after changing them in Studio.

## Content model

`cms/content-model.eldra.json` declares every schema the code reads. When code starts reading a schema or field, add it to the manifest and to `READS` in `tests/unit/content-model.test.ts` in the same change; the test fails otherwise.

| API id                                                                                                        | Used by                  | Fields read                                                                                           |
| ------------------------------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `site_header`, `navigation_item`                                                                              | `layout/SiteHeader.vue`  | `name`, `logo`, `items`; `label`, `href`, `kind` (`link` or `catalog-menu`), `active`, `openInNewTab` |
| `site_footer`, `footer_link`                                                                                  | `layout/SiteFooter.vue`  | `tagline`, `note`; `label`, `href`, `column`, `order`                                                 |
| `home_hero`, `home_section`                                                                                   | `pages/index.vue`        | `title`, `subtitle`, `image`, `ctaText`, `ctaLink`; plus `kicker`, `body`, `order`, `active`          |
| `page`                                                                                                        | `pages/pages/[slug].vue` | `title`, `slug` (unique), `seo`, `private`, `blocks`                                                  |
| `block_text`, `block_heading`, `block_image`, `block_card`, `block_button`, `block_embed`, `block_entry_list` | `components/blocks/*`    | see the manifest                                                                                      |

Two composition models: flat, repeatable section schemas for the home page, and a recursive block tree for content pages. `BlocksRenderer` resolves unexpanded references lazily, with a depth limit, in-flight de-duplication and a cycle guard. To add a block: a schema in the manifest, a guard in `app/utils/blocks.ts`, a component in `app/components/blocks/`, a branch in `Renderer.vue`, and the schema in `page.blocks` (and `block_card.blocks`).

## Commerce

- The cart id lives in `localStorage` under `storefront-starter.cartId` through the SDK's `createCartSession`; cart state skips hydration and cart markup renders inside `<ClientOnly>`.
- A forgotten cart (`CART_NOT_FOUND`) is dropped and the add retried once; `CART_INSUFFICIENT_STOCK` shows as out of stock.
- Checkout is a hand-off: `client.checkout.handoffUrl`; the storefront ends there. `/cart?recovery=<token>` restores an abandoned basket (restored, partial or expired).
- Totals come from the server; never sum lines.
- Prices: `usePrice()` → `formatPrice(amount, currency, locale)` with `Intl.NumberFormat` and the locale passed explicitly.
- Links that differ only by query (`/shop?category=…`) bind `aria-current` explicitly.

## Languages

`en-US` and `is-IS` ship in `i18n/locales/`; the organization's locale list limits them. The choice is the `storefront_locale` cookie; switching reloads the page so server-rendered content follows.

## SEO and images

`buildSeoMeta(entry)` reads `seo` with fallbacks and sets `noindex` when `private` is true; `/sitemap.xml` lists published pages and products; `/robots.txt` follows `NUXT_SITE_INDEXABLE`. CMS images render through `ContentMedia` with a `srcset` of the asset's `sm`/`md`/`lg`/`xl` variants.

## Left out on purpose

Deployment configuration, analytics, an admin or preview UI. Add them deliberately, in this repository's own terms.
