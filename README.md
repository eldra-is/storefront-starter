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
| `PREVIEW_TOKEN`                        | server-only; when set, server-side reads include drafts — see [Previewing drafts](#previewing-drafts) |
| `NUXT_SITE_URL`, `NUXT_SITE_INDEXABLE` | canonical URL; whether search engines may index the site                                              |

These variables are read at build time (including by `pnpm dev`); to change one on a server that is already built, set the runtime override instead — `NUXT_PUBLIC_ELDRA_ORG_ID`, `NUXT_PUBLIC_ELDRA_API_BASE_URL`, `NUXT_PUBLIC_CHECKOUT_URL`, `NUXT_PUBLIC_DEFAULT_LOCATION_ID`, `NUXT_PREVIEW_TOKEN`, `NUXT_PUBLIC_SITE_URL`, `NUXT_PUBLIC_SITE_INDEXABLE` — the standard Nuxt runtime-config env names.

## Previewing drafts

Set `PREVIEW_TOKEN` only on a separate, private preview deployment, never on the public site: the token is not tied to a visitor, so everyone who can reach that server sees unpublished content. Drafts appear on full server-rendered page loads only; after the first page, client-side navigation and blocks resolved in the browser read published content, so reload the page to see a draft.

## Business login

Organizations with the **B2B** feature can let business customers sign in on the storefront through the organization's shop realm in Keycloak. It is off unless all of these hold: the organization has B2B enabled, `NUXT_SHOP_CLIENT_SECRET` is set, and an issuer is known (`NUXT_PUBLIC_SHOP_ISSUER`, or `NUXT_PUBLIC_KEYCLOAK_BASE_URL` from which `<base>/realms/shop-<organization UUID>` is derived). Then the header shows an account link and `/account` lists the person's companies with customer number and role.

| Variable                        | Meaning                                                                                                                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NUXT_PUBLIC_KEYCLOAK_BASE_URL` | Keycloak's public origin; the shop realm issuer is derived from it                                                                                                                              |
| `NUXT_PUBLIC_SHOP_ISSUER`       | the issuer in full; wins over the derived one                                                                                                                                                   |
| `NUXT_SHOP_CLIENT_ID`           | the realm's storefront client; default `storefront`                                                                                                                                             |
| `NUXT_SHOP_CLIENT_SECRET`       | server-only; Studio > Settings > Business sales shows it once on rotate. Never commit it                                                                                                        |
| `NUXT_SESSION_STORAGE_DRIVER`   | `redis`, or `memory` (one server, sign-ins lost on restart). Required in production once business login is configured: the server refuses to start without it                                   |
| `NUXT_SESSION_STORAGE_URL`      | Redis URL for `redis`, read at runtime (it may carry a password; it is never in the build)                                                                                                      |
| `NUXT_TRUST_PROXY`              | `true` behind a TLS-terminating proxy that sets `X-Forwarded-Host`/`-Proto`: the sign-out check and the sign-in return address use them. Default `false`, because anyone can send those headers |

The flow is the authorization code flow with PKCE, run by the server routes `/auth/login` and `/auth/callback`, sign-out by a same-origin `POST /auth/logout` from the account page, and the JSON route `/api/auth/me`. Tokens never reach the browser: they are kept in the server's `eldra-session` storage, and the session cookie (`__Host-eldra_session`; `eldra_session` in development) holds only a random id (httpOnly, `Secure` outside development, `SameSite=Lax`), with a fresh id on every sign-in. The access token is refreshed on the server when less than a minute is left, once per session at a time. Sign-out ends the stored session, ends the Keycloak session from the server, then sends the browser through Keycloak's logout. Studio registers `<storefront origin>/auth/callback` as a redirect URI for the storefront URL and every storefront origin, so sign in on one of those origins.

Deployment notes:

- Run more than one server instance, or want sign-ins to survive a restart: use `redis`. The in-memory store keeps at most 10,000 sessions and logins in flight per server.
- Keep **Revoke refresh token** off in the shop realm (it is off in the realm Eldra provisions). With it on, two requests refreshing one session on different servers spend the same refresh token and the loser is signed out.
- Behind a proxy that terminates TLS (the server sees `http://storefront:3000`), set `NUXT_TRUST_PROXY=true`, or sign-in sends Keycloak the wrong return address and sign-out is refused. Only do it when the proxy sets those headers itself.
- A production build served over plain `http://localhost` (for example `pnpm preview` for e2e) still names its cookies `__Host-eldra_session` and `__Secure-eldra_login`, which must be `Secure`. Chromium and Firefox accept that on localhost; Safari and WebKit refuse the cookies, so sign-in silently fails there. Run local e2e against `pnpm dev` or over https.
- Rotating the client secret in Studio ends it at once in Keycloak: set the new `NUXT_SHOP_CLIENT_SECRET` and restart straight away. Until then sign-ins fail, and anyone signed in is signed out at their next refresh.

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

## Known limits

- Catalog lists (the shop, a category, a collection) and CMS lists show the first 100 products or entries in v0.1.0; pagination is not implemented yet.

## Deploying

Anywhere that runs Node 22.19 or later for server-side rendering (`pnpm build`, then `node .output/server/index.mjs`), with the variables above set. The starter ships no hosting configuration.

Static hosts can instead run `pnpm generate` and serve `.output/public`, but content is then fixed at the moment of that build — rebuild and redeploy after publishing changes in Studio — and `/sitemap.xml` and `/robots.txt` are server routes that need the Node server, not the static output.

## Make it yours

- Brand name: `app/app.config.ts`. Colours and type: the tokens at the top of `app/assets/css/main.css`.
- Copy: content in Studio. The few interface strings are in `i18n/locales/`.
- Script embeds: allow a provider's origin in `shared/utils/embed-policy.ts`.

See `CLAUDE.md` for the conventions this code follows.
