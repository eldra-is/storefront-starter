# Storefront Starter

A Nuxt storefront on the [Eldra](https://eldra.is) public API: CMS pages, a catalog, a cart and the hand-off to Eldra's hosted checkout. Clone it with GitHub's **Use this template**, or let the `eldra-storefront` Claude Code plugin scaffold it. MIT licensed.

Editable content and catalog data live in Eldra Studio. Routes, layout, presentation, application state and the checkout hand-off live in this code.

## Requirements

- Node.js 22.19 or later, pnpm
- An Eldra organization with the CMS feature (and ECOMMERCE to sell), and its id or alias from Studio, General settings

## Start

```bash
pnpm install
cp .env.example .env   # set ELDRA_ORG_ID
pnpm dev               # http://localhost:3000
```

In Studio, General settings, add `http://localhost:3000` under **Storefront origins**; the API answers a browser only from registered origins.

## Environment

| Variable                               | Meaning                                                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `ELDRA_ORG_ID`                         | organization id or alias, required                                                                    |
| `BASE_API_URL`                         | gateway origin; empty means production (`https://web.eldra.app/api`); `/api` is appended when missing |
| `NUXT_PUBLIC_CHECKOUT_URL`             | hosted checkout origin; empty means production; set it whenever `BASE_API_URL` is set                 |
| `NUXT_PUBLIC_DEFAULT_LOCATION_ID`      | inventory location for stock badges; empty means no badges                                            |
| `PREVIEW_TOKEN`                        | server-only; when set, server-side reads include drafts                                               |
| `NUXT_SITE_URL`, `NUXT_SITE_INDEXABLE` | canonical URL; whether search engines may index the site                                              |

These variables are read at build time (including by `pnpm dev`); to change one on a server that is already built, set the runtime override instead — `NUXT_PUBLIC_ELDRA_ORG_ID`, `NUXT_PUBLIC_ELDRA_API_BASE_URL`, `NUXT_PUBLIC_CHECKOUT_URL`, `NUXT_PUBLIC_DEFAULT_LOCATION_ID`, `NUXT_PREVIEW_TOKEN`, `NUXT_PUBLIC_SITE_URL`, `NUXT_PUBLIC_SITE_INDEXABLE` — the standard Nuxt runtime-config env names.

## Content model

`cms/content-model.eldra.json` declares every CMS schema the code reads, with demo entries in English and Icelandic: the header and its navigation items, the footer and its links, the home hero and sections, and `page` with its blocks (text, heading, image, card, button, embed, entry list).

- **With the plugin:** its `content-model` command creates whatever the organization is missing.
- **Without it:** in Studio, open the content import dialog, choose **Eldra archive** and select the file. Do this only in an organization with no CMS content yet: the importer replaces schemas with the same API id and drops media links on matched entries.

The header shows the brand name from `app/app.config.ts` until you pick a logo on the imported **Primary header** entry.

To feature products in a home section, add a reference field that allows products to **Home section** in Studio; the archive format cannot carry product references.

## Products

The shop shows whatever the organization sells: add categories and products in Studio under Catalog, publish them, and reload. Prices use the organization's currency and the visitor's language.

## Generated types

`pnpm dev` and `pnpm build` write `.eldra/web-studio/`, typed from your organization's schemas and the gateway's contract. The starter ignores that folder; your site should commit it: delete the `.eldra/` line from `.gitignore` after the first build, and commit the folder again whenever a schema changes, so CI type-checks without a live gateway.

## Commands

```bash
pnpm dev            # port 3000
pnpm build          # also regenerates .eldra/web-studio
pnpm typecheck
pnpm lint:check
pnpm format:check
pnpm test           # unit tests, including the content-model coverage test
pnpm test:e2e       # Playwright, against an organization seeded from the manifest
```

`pnpm test:e2e` needs a few published products with stock; set `E2E_DISCOUNT_CODE` to also test a discount.

## Deploying

Anywhere that runs Node 22.19 or later for server-side rendering (`pnpm build`, then `node .output/server/index.mjs`), with the variables above set. The starter ships no hosting configuration.

Static hosts can instead run `pnpm generate` and serve `.output/public`, but content is then fixed at the moment of that build — rebuild and redeploy after publishing changes in Studio — and `/sitemap.xml` and `/robots.txt` are server routes that need the Node server, not the static output.

## Make it yours

- Brand name: `app/app.config.ts`. Colours and type: the tokens at the top of `app/assets/css/main.css`.
- Copy: content in Studio. The few interface strings are in `i18n/locales/`.
- Script embeds: allow a provider's origin in `shared/utils/embed-policy.ts`.

See `CLAUDE.md` for the conventions this code follows.
