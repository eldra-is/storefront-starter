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

Requires `@eldrajs/sdk` 0.2.8 or later (0.2.7 has no business login), and, for customer prices, a platform whose web gateway serves public contract 2.17.0 or later: the generated types (`listPrice`) and CI's typecheck come from the gateway's contract. Release gate for this starter: merge and cut a release only after `@eldrajs/sdk` 0.2.8 is published and the production web gateway serves contract 2.17.0; until then CI's typecheck fails.

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

The flow is the authorization code flow with PKCE, run by the server routes `/auth/login` and `/auth/callback`, sign-out by a same-origin `POST /auth/logout` from the account page, and the JSON route `/api/auth/me`. Tokens never reach the browser: they are kept in the server's `eldra-session` storage, and the session cookie (`__Host-eldra_session`; `eldra_session` in development) holds only a random id (httpOnly, `Secure` outside development, `SameSite=Lax`), with a fresh id on every sign-in. The access token is refreshed on the server when less than a minute is left, once per session at a time. `/api/auth/me` asks the gateway and reads its refusals by error id, not status: `FEATURE_DISABLED` means business login is off for the organization (the page shows its "not available" state and the session is kept), `SHOP_NO_MEMBERSHIP` means signed in without a company, `SHOP_TOKEN_INVALID` (401) ends the session, `SHOP_LOGIN_UNAVAILABLE` (503) and any refusal it cannot read show a try-again message and keep the session. A successful answer is cached server-side for 30 seconds under its own key (`me:<session id>`, never on the session record), so page views do not each spend the storefront's rate limit. The gateway caches membership for 30 seconds too, so a page can be up to about 60 seconds behind a membership change (and the account page up to about 60 seconds behind a removal: gateway 30 s plus starter 30 s); the gateway still checks membership on every business call. The cache is dropped on sign-out, on any failed refresh or failed `/me`, and when tokens are refreshed, and a cache failure never changes what `/me` answers. Sign-out ends the stored session, ends the Keycloak session from the server, then sends the browser through Keycloak's logout. Studio registers `<storefront origin>/auth/callback` as a redirect URI for the storefront URL and every storefront origin, so sign in on one of those origins.

Deployment notes:

- Run more than one server instance, or want sign-ins to survive a restart: use `redis`. The in-memory store keeps at most 10,000 sessions and logins in flight per server.
- Keep **Revoke refresh token** off in the shop realm (it is off in the realm Eldra provisions). With it on, two requests refreshing one session on different servers spend the same refresh token and the loser is signed out.
- Behind a proxy that terminates TLS (the server sees `http://storefront:3000`), set `NUXT_TRUST_PROXY=true`, or sign-in sends Keycloak the wrong return address and sign-out is refused. Only do it when the proxy overwrites (never appends to) any `X-Forwarded-Host` and `X-Forwarded-Proto` the client sent, because the first value is the one trusted.
- A production build served over plain `http://localhost` (for example `pnpm preview` for e2e) still names its cookies `__Host-eldra_session` and `__Secure-eldra_login`, which must be `Secure`. Chromium and Firefox accept that on localhost; Safari and WebKit refuse the cookies, so sign-in silently fails there. Run local e2e against `pnpm dev` or over https.
- Rotating the client secret in Studio ends it at once in Keycloak: set the new `NUXT_SHOP_CLIENT_SECRET` and restart straight away. Until then sign-ins fail, and anyone signed in is signed out at their next refresh.

### Customer prices

A signed-in business customer sees their company's prices: what the company pays, labelled "Your company's price", with the list price struck through next to it when it is higher. A guest sees list prices exactly as before. Search results always carry list prices; a site that adds search must show them without the company label.

- **Where calls go.** A guest's catalog reads and cart calls go from the browser straight to the gateway, unchanged. When signed in, product reads (`/shop`, a product, a collection's products, the home page row) go through the server routes in `server/api/catalog/`, on the server render and on client-side navigation alike, and cart writes go through `server/api/cart/`. Those routes add the session's access token and the active company (`customerHeaders(token, customerId)`: `Authorization` and `X-Customer-Id`, with the organization's UUID in `X-Org-Id`). Without a session they call as a guest, with no `Authorization` header at all. Cart reads stay direct: a cart is read by its id. Categories and collections carry no prices and stay direct.
- **Active company.** Kept in the server session (`company:<session id>`, beside the session record, never in the browser). A person with one company buys for it without choosing. A person with several picks one on `/account` (a same-origin form post to `/api/auth/company`; the company must be one of theirs, read from `/me`); until they do, pages show list prices without the label and a notice asking them to choose, and cart writes are refused with that same request.
- **Cart.** The first signed-in write binds the cart to the company and reprices it. The browser keeps the company the cart was last written for beside the cart id (`storefront-starter.cartBoundTo`; the web cart does not say), and before a cart's prices are shown or checkout is offered it is checked against who is buying: another company's cart (after switching company), or a guest cart with items once signed in, is **moved**: its lines are replayed through add-to-cart into a new cart for this company, so each is repriced, and the cart says it was moved to that company and how many items could not be carried over. A line is left behind (and counted) only when the shop refuses it for good: the variant is gone, unavailable or out of stock. Any other failure during a move (no answer, an outage such as `CART_PRICES_UNAVAILABLE`, a 429 rate limit) abandons the move: the old cart is kept, checkout is withheld, and the move is tried again on the next load; nothing is lost. The same move happens when a write is refused with `CART_CUSTOMER_MISMATCH`. Signing out forgets a company cart on purpose, so a shared device does not keep showing company prices. A company cart found for someone who is now a guest any other way (the session ended, B2B was switched off, the person has no company left) is moved to a guest cart at list prices, with a notice, never dropped. While the company cannot be known (none chosen yet, or the account could not be read) the cart is not shown and cannot be checked out. The company a cart is bound to comes from the cart route's answer (`X-Eldra-Priced-For`: the company the server priced for, resolved from `/me` when the gateway chose the person's only company; `customer` when it cannot be named, which still counts as bound; or `guest` when the call fell back to a guest), never from what the browser assumed. A write never unbinds a company cart: a guest may remove a line from one (the cart stays the company's), so a removal answered `guest` means the session ended, and the cart is moved to a guest cart with a notice, like any other company cart found for a guest. Cart write routes accept same-origin requests only (403 otherwise). Two tabs follow each other's cart through the browser's `storage` event; two tabs that move the same cart at the same instant can still each build a new cart (one of them is then simply abandoned, with its lines also in the other). A session that ends on the server while the person is shopping (a token that expired mid-write, `CART_SIGN_IN_REQUIRED`) moves them to a guest cart at list prices, with a notice. Discount codes do not combine with company prices, so a cart bound to a company shows no code entry (`CART_DISCOUNT_NOT_FOR_CUSTOMER_PRICES`). `CART_PRICES_UNAVAILABLE` shows a try-again message.
- **Failures.** B2B switched off (`FEATURE_DISABLED`, or `CART_CUSTOMER_PRICES_OFF` on a write to a company cart) or a token the gateway refuses (401): the session is ended and the call made once more as a guest. A company cart refused with `CART_CUSTOMER_PRICES_OFF` or `CART_CUSTOMER_UNAVAILABLE` (409, the company is archived or unknown) is moved to a guest cart with a notice, as for `CART_SIGN_IN_REQUIRED`. A company that is no longer the person's is forgotten and the call made once more without it. An outage (`CUSTOMER_PRICES_UNAVAILABLE`, `SHOP_LOGIN_UNAVAILABLE`) is an error, never a quiet fall back to list prices. If the pricing state cannot be read during a server render, the person counts as signed in with the company unknown: a company cart waits (not shown, no checkout), it is never moved to a guest cart on a hiccup.
- **B2B switched off with a company cart.** The hosted checkout refuses to preview or create an order from a company cart once B2B is off (409 `ORDER_CUSTOMER_PRICES_OFF`), rather than charge list prices above what the cart showed. For a short while after the switch (the starter caches the organization for 5 minutes and `/me` for 30 seconds) the storefront can still offer checkout for that cart; the hosted checkout then refuses, and the next load (or any cart write, `CART_CUSTOMER_PRICES_OFF`) moves the cart to a guest cart at list prices. The starter itself never calls order preview or create; a storefront that does should treat `ORDER_CUSTOMER_PRICES_OFF` like `CART_CUSTOMER_PRICES_OFF`.
- **A company that is no longer available.** A business customer that is archived or unknown answers 409 `CART_CUSTOMER_UNAVAILABLE` on cart writes and 409 `ORDER_CUSTOMER_UNAVAILABLE` on order create and preview (it used to be 503 `*_PRICES_UNAVAILABLE`). The starter handles the cart id exactly like `CART_CUSTOMER_PRICES_OFF`: the session is ended (without treating B2B as off, so the organization cache is kept), the call is made once more as a guest, and the cart moves to a guest cart with the same notice. A storefront that calls order preview or create should treat `ORDER_CUSTOMER_UNAVAILABLE` the same way.
- **The order total can differ from the cart page.** A company cart shows the prices stored when each line was added; the order re-prices from the company's current terms, which DK sync changes routinely. The hosted checkout shows the order preview total before payment; a storefront that takes payment itself should do the same rather than charge the cart page's total.
- **Caching.** No customer price may be cached anywhere:
  - every answer of the catalog and cart server routes, guest answers and errors included, is `Cache-Control: private, no-store` with `Vary: Cookie`;
  - every gateway cart answer, reads by id included, is `private, no-store` too (a company cart's read carries its prices);
  - while business login is on, every page, a guest's too, carries `Vary: Cookie`, so a cache that keeps a guest's page never serves it to a signed-in browser (which would then think it is a guest); a guest's page is otherwise unchanged and still cacheable;
  - a page rendered for a browser with a session cookie is `private, no-store`, because its HTML and payload carry that person's prices (`/account` always is);
  - priced `useAsyncData` keys name the company (`useCatalog().key(…)`), so data made for one company, or for a guest, is never reused for another;
  - never wrap these routes in `defineCachedEventHandler`, route rules with `swr`/`isr`/`cache`, a CDN rule that ignores `Cache-Control`, or `pnpm generate`: a statically generated site has no server routes and shows list prices only.
- **Rate limits.** The gateway limits each client address to a fixed 600 requests a minute. Signed-in catalog reads and cart writes, like every server render, reach it from the storefront server's address, so all signed-in shoppers and all server renders share that one budget. A per-storefront limit is a recorded platform follow-up; until then a busy business storefront should run several server addresses or ask Eldra to raise its limit.

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
