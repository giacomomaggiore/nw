# Agent Instructions

## Product

Build a private personal-wealth dashboard. Google Sheets is the single source of truth and manual data-entry layer. The Next.js application is read-only for financial data: it loads Sheets data, enriches it with cached market data and FX rates, performs analytics in the backend, and renders dashboards.

Do not add alternative databases or modify workbook data unless explicitly requested.

## Code standards

- Keep code minimal, linear, and readable. Prefer direct solutions over abstractions, fallbacks, or indirection.
- Keep modules small and scoped to one responsibility. Use explicit names and typed public boundaries.
- Add short English comments for non-obvious logic only. Comments must explain intent, inputs/outputs, source, scope, or important constraints when code alone does not make them clear.
- Do not add comments that merely restate the code.
- Preserve existing behavior unless the requested change explicitly alters it.

## Workbook contract

Tab names are lowercase and fixed:

- `cashflow`
- `assets`
- `categories`
- `metadata`
- `saa`
- `constants`

### `cashflow`

Header row, in this order:

`DATE`, `TYPE`, `NAME`, `AMOUNT`, `CURRENCY`, `CATEGORY`, `SUBCATEGORY`, `NOTES`.

The seventh header may be `CITY` as a legacy alias for `SUBCATEGORY`.

- `TYPE`: `income`, `expense`, or `contribution`.
- Amounts are non-negative. Type determines direction.
- `contribution` is an external inflow into the invested portfolio. Exclude it from income, spending, savings-rate, and category reporting; include it in performance cash-flow calculations.
- An investment withdrawal is `income` with category `withdrawal`. It is income for cashflow reports but an external portfolio outflow for performance calculations.
- `tax` is an `expense` category.
- Non-empty `CATEGORY` values must exactly match `categories.CATEGORY`; uncertain values stay blank and are counted as unclassified expenses.
- Purchases, sales, dividends, fees, and taxes managed inside the investment platform are not cashflow rows.

### `assets`

The first four headers are `ASSET`, `DATATYPE`, `CURRENCY`, `ACCOUNT`; remaining columns are ascending reporting-period dates.

- `DATATYPE` is `quantity`, `cash`, or `value`.
- `quantity`: units held. Value using the historical market price on the reporting period.
- `cash`: reported cash balance.
- `value`: reported value for non-ticker or manually valued assets.
- Convert every reporting-period value with the historical FX rate for that date.

### `categories`

Headers: `CATEGORY`, `PARENT_CATEGORY`, `IS_ESSENTIAL`, `IS_RECURRING`. `IS_ESSENTIAL` and `IS_RECURRING` are `TRUE` or blank. `CATEGORY` values are unique and are the only valid non-empty expense categories in `cashflow`.

### `metadata`

Headers: `TICKER`, `DISPLAY_NAME`, `FULL_NAME`, `CURRENCY`, `TER`, `ISSUER`, and an optional seventh `PROXY`.

`TICKER` identifies the corresponding `assets.ASSET` ticker. Every field except `DISPLAY_NAME` and `PROXY` is required. `CURRENCY` is the fund's own currency; prices are converted from the currency of the `assets` row. `TER` is a yearly fraction (0.06% is `0.0006`, usually a percentage-formatted cell) and `npm run test:sheets` rejects values above 0.05. `PROXY` backfills the history of a young fund for the Monte Carlo page: a Yahoo symbol or a weighted sum, `SYMBOL` or `SYMBOL*weight` joined by `+`, with a dot as the decimal separator (for example `URTH*2` or `URTH*0.9+IEF*0.6`); blank means none (see `docs/montecarlo.md`). Net-worth displays `DISPLAY_NAME` when supplied, otherwise `FULL_NAME`; it uses Yahoo Finance metadata only as a final fallback. Ticker symbols remain in a dedicated table column.

### `saa`

First headers: `ASSET_CLASS`, `INSTRUMENT`; remaining columns are ascending reporting-period dates. Values are non-negative target percentages. Targets do not need to total 100%; calculate drift independently for each target.

### `constants`

No header row. Column A is the key and column B is the value. Keys are unique, upper-case, and read case-insensitively.

| Key | Value |
| --- | --- |
| `CURRENCY_1` | Required reporting currency. `CURRENCY_2` and `CURRENCY_3` are optional. |
| `ALLOWED_EMAILS` | Comma-separated Google accounts allowed to see real data (see Authentication). One row, one cell. Never one row per email: duplicate keys overwrite each other. Read server-side only. |
| `LUCKY_SEED` | A demo seed that unlocks real values for anyone who enters it. Optional; use a long phrase. Read server-side only, never sent to the client. |
| `APP_NAME` | Site name: default page title and the prefix of every page title (`Giacomo's Cashflow`). Read by the app (default `Net Worth`). |
| `APP_DESCRIPTION` | `<meta name="description">`. Read by the app (default `Private personal-wealth dashboard`). |
| `LOCALE` | `<html lang>`, for example `en`. Not read by the app yet. |

`parseConstants` normalizes only `CURRENCY_*` values as currency codes; text values (`APP_NAME`, `APP_DESCRIPTION`, `ALLOWED_EMAILS`) keep their case, except that emails are lower-cased when compared. `APP_NAME` and `APP_DESCRIPTION` are loaded by `loadCachedAppSettings` (`src/app/load-app-settings.ts`, `"use cache"` with `cacheLife("minutes")`); a failed read falls back to the defaults in `lib/sheets/app-settings.ts` so a Sheets outage never breaks page titles. `ALLOWED_EMAILS` and `LUCKY_SEED` are loaded by `loadCachedAccessSettings` (`src/lib/auth/access.ts`, same cache profile) and a failed read grants nobody access. Keep `constants` free of personal data other than the allowlist: `APP_NAME` and `APP_DESCRIPTION` end up in public HTML, so keep them generic. Robots/`noindex` and per-page titles are hard-coded, never read from the sheet.

## Architecture and Methodology

### Data flow

```text
Google Sheets + data/market-data → lib/sheets + lib/market-data → lib/analytics → app route → components
```

- `lib/sheets` is the only location for Google Sheets I/O, schemas, date parsing, and workbook normalization.
- `lib/market-data` reads local price and FX files from `data/market-data`; it must not make runtime market-data requests. A price file that ends before today is used as it is; the "current" value is its last close.
- `lib/analytics` contains pure, deterministic report builders. Do not put I/O, React code, or environment access there.
- `src/app` pages are server components that compose loaders, market-data conversion, and analytics, then provide serializable reports to UI components.
- `src/components` renders the reports. Client components may own Recharts interaction state but never fetch financial data.

### Implemented routes

- `/networth`: parses `assets`, `metadata`, and `constants`; prices quantity rows with local historical/current prices; converts values using local historical/current FX; renders the net-worth trend, the asset summary table (fixed January–December columns, see Summary table layout), the growth table, monthly rankings and the benchmark comparison. Implementation details of every report are in `docs/how-it-works.md`.
- `/saa`, `/montecarlo`, `/docs`, `/privacy`, `/ts`: empty "Coming soon" placeholders. `/privacy` (privacy policy) and `/ts` (terms of service) are linked from Google's consent screen; they are not in the navbar and need real text before the OAuth app is published.
- `/api/auth/*`: Auth.js endpoints (`src/app/api/auth/[...nextauth]/route.ts`). There are no financial-data API routes yet.
- `/` (`/cashflow` redirects to it): parses `cashflow`, `categories`, and `constants`; converts each transaction to `CURRENCY_1` at its local historical FX rate; excludes contributions; reports the latest transaction year from January through December. Missing/future months are `null`, displayed as `—`, and charted as gaps.

### Calculation rules

- `quantity` assets are valued as quantity × downloaded local price; `cash` and `value` assets use reported values.
- Net-worth tables calculate totals independently in `CURRENCY_1`, `CURRENCY_2`, and `CURRENCY_3`; missing local prices are `—` and surface a warning.
- Cashflow expense aggregation is `CATEGORY → PARENT_CATEGORY`. Blank categories are never inferred.
- Cashflow savings are $income - expenses$ and saving rate is $savings / income$ when income is non-zero.
- Cashflow monthly averages include every month in the latest report year, including missing/future months as zero for the average, while the table continues to show those months as `—`.

### Summary table layout

The cashflow summary table (`/`) and the net-worth asset summary table (`/networth`) are fixed-layout year views. Every change to them must keep this behavior:

- Always render all twelve months, January to December, of the selected year as columns, even when a month has no data. Empty months show `—`.
- The year dropdown is the only control that changes the columns, and it only picks the year. Date-range filters, currency buttons, and the amount of available data never add, remove, or reorder month columns.
- The net-worth table appends a single extra `Current` column after December, only when the current date falls in the selected year. It never fills or replaces a month column.
- Build the columns in pure analytics (`periodsInRange` for cashflow, `netWorthYearColumns` for net worth), never by filtering existing report periods inside a component. Keep the tests that assert twelve month columns for sparse and empty data.

### Libraries

- Next.js 16 App Router and React 19 for server/client UI boundaries.
- TypeScript for typed module boundaries.
- Tailwind CSS 4 for styling.
- Recharts for all interactive charts.
- `googleapis` for the service-account Google Sheets client.
- `next-auth` v5 (Auth.js, beta channel) for Google OAuth sign-in with JWT sessions.
- Yahoo Finance chart endpoint through the explicit downloader script; the application consumes only the downloaded JSON price store.
- `tsx` for the test runner and workbook validation, and ESLint for static checks.

### Required workflow

1. Update the workbook manually; never persist app-derived data back to Sheets.
2. Run `npm run download:market-data` after workbook changes and before running or deploying the application. It stores raw and dividend-adjusted daily prices, including required FX pairs, in `data/market-data`.
3. Run `npm run test:sheets` after any workbook/schema/parser change.
4. Keep downloader-only external I/O, calculations, and rendering in their respective layers.
5. Run `npm run lint`, `npx tsc --noEmit`, and `npm test` after code changes.
6. Do not print, commit, or expose environment values, spreadsheet identifiers, or service-account credentials.

## Authentication

Use Google OAuth through Auth.js. Do not implement a custom password flow.

### Implemented

- `src/lib/auth/auth.ts` configures `NextAuth({ providers: [Google] })` and exports `handlers`, `auth`, `signIn`, `signOut`. Sessions are JWT cookies; there is no database. Auth.js reads `AUTH_SECRET`, `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` from the environment.
- The navbar profile (`src/components/ui/user-profile.tsx`, server component, in the root layout inside `Suspense`): a thin red-bordered `?` button that starts the Google sign-in when signed out; the Google picture with a thin green border plus a *Sign out* button when signed in. Green means signed in with Google, not allowed.
- Signing in is optional. Only verified Google emails may sign in (`signIn` callback requires `email_verified`).
- `resolveAccess()` (`src/lib/auth/access.ts`) decides per request, on the server, whether the visitor sees real values: an allowlisted email, or a seed cookie equal to `LUCKY_SEED` (constant-time comparison). Everyone else, signed in or not, gets demo values. `resolveMultiplier()` returns 1 for real values, otherwise the seeded factor.
- While the visitor sees randomized values (`!real`), the navbar shows a warning icon (`components/ui/demo-notice.tsx`, client component, `fixed` tooltip because the navbar clips overflow) explaining "Randomized data. Log-in if you are an authorized user or try to guess the right seed to see real data". Keep the text and the `!real` condition in sync with `resolveAccess`.
- The navbar also shows a *Seed* input (server action `setDemoSeed` in `src/lib/auth/demo-seed.ts`, HTTP-only cookie `demo-seed`, default seed `1`) to every visitor who is not an allowlisted user.
- Any component that reads the session must call `await connection()` and be rendered inside `Suspense` (`cacheComponents` is on); otherwise the prerender fails with a `crypto.getRandomValues()` error. Never read the session in `lib/analytics` or `lib/market-data`.

### Google Cloud Console configuration

The Sheets service account (server reads the workbook) and the OAuth client (users sign in) are separate credentials and may share a Cloud project.

1. Project: pick or create a project in the Cloud Console.
2. *APIs & Services → OAuth consent screen* (*Google Auth Platform*): *Get started*, then Branding: app name, user support email, developer contact email. Home page, privacy policy (`https://<domain>/privacy`), terms (`https://<domain>/ts`) and authorized domain are optional in Testing and expected before publishing.
3. Audience: user type **External**. Publishing status **Testing** lists the only accounts that can sign in (*Test users*, max 100); other accounts get `access_denied`. **Publish app** moves it to *In production* so any Google account can sign in, with no verification needed for basic scopes. Publishing is safe for real data only because the allowlist is enforced in the backend.
4. Data access: keep the default scopes `openid`, `userinfo.email`, `userinfo.profile`. Never add Sheets or Drive scopes: the workbook is read only by the service account.
5. Clients → Create client → **Web application**. Leave JavaScript origins empty. Redirect URIs, matched exactly (protocol, host, port, no trailing slash): `http://localhost:3000/api/auth/callback/google` and `https://<domain>/api/auth/callback/google`.
6. Copy the client ID and secret into `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`; Google may not show the secret again. `AUTH_SECRET` is a random string (`openssl rand -base64 32`), different in production. Set `AUTH_TRUST_HOST=true` on a proxied host. `README.md` (step 8) and `docs/appendix.md` (section E) have the full walkthrough; `docs/troubleshooting.md` has the troubleshooting table.
7. Never print, commit, or paste the client secret, `AUTH_SECRET`, or any other environment value.

### Allowlist

Google OAuth only proves identity. Authorization is the allowlist, a comma-separated `ALLOWED_EMAILS` value in the `constants` tab (not in `.env.local`):

- The server reads the allowlist with the service account when checking a session, never in the browser and never exposed to clients.
- Trim and lower-case every allowlist entry and the session email; require a verified Google email. Grant real data only on an exact match.
- Fail closed: if the Sheets read fails, the key is missing, or the value is empty, everyone is treated as unauthenticated (demo mode). Never fall back to real data.
- Cache the allowlist briefly (1–5 minutes) to avoid a Sheets call per request. Removing an email takes effect within that window.
- Check authorization in every page loader and API route that returns data, not only in the UI.
- Anyone with edit access to the workbook can grant access; share it read-only with everyone except the owner.
- The allowlist is not secret but is personal data: do not log, print, or send it to the client.

### Demo mode

Visitors who are not allowlisted and have not entered `LUCKY_SEED` see every money amount multiplied by one factor in [0, `DEMO_MULTIPLIER_MAX`) (currently 10, defined once in `lib/demo/multiplier.ts`), derived from their seed as `HMAC-SHA256(DEMO_SALT, seed)`:

- Apply the factor in the backend, on the parsed workbook before valuation and analytics (`lib/demo/scale.ts`, called from the page loaders with the factor from `resolveMultiplier`), so every total, chart and table stays consistent. Never scale in a component, and never send the factor, `DEMO_SALT`, the allowlist or `LUCKY_SEED` to the client.
- Scaled: asset quantities, cash and manual values, transaction amounts. Not scaled: percentages and returns, counts, dates, names, categories, tickers, account names.
- Loaders take the factor as a function: `loadCashflowPage(loadWorkbook, getMultiplier = () => 1)` and `loadNetWorthPage(sources = defaultNetWorthSources, getMultiplier = () => 1)`. They call it first, inside their `try`, and scale the workbook right after reading it. Pages pass `resolveMultiplier` itself, so a failure (for example a missing `DEMO_SALT`) shows in the page's error box instead of a 500, and loaders stay testable without cookies or a session. Never call `resolveMultiplier()` in a page body outside a loader's `try`.
- Every new loader or API route that returns financial data must take the multiplier from `resolveMultiplier()` and pass it through the scaling functions. `lib/demo` and `lib/analytics` stay pure: no cookies, session or environment access there.
- `DEMO_SALT` is required; a missing salt must fail loudly, never fall back to real values.
- Gotchas: read the seed cookie with `||`, not `??` (a cookie deleted in the same request reads back as `""`); `"use server"` files may export only async functions, so shared constants live in `lib/auth/access.ts`; session or cookie readers need `connection()` plus `Suspense`; the cached access settings return empty on a failed read so access fails closed.
- Tests: `tests/demo-access.test.ts` covers the multiplier, scaling, the loader with a factor and the access-key parser; update it with any change to them.
- Known limits (also in `docs/appendix.md`, section B): ratios stay real, and trying many seeds lets someone estimate the real amounts (the maximum factor approaches `DEMO_MULTIPLIER_MAX`, so the largest observation divided by it gives the real amount). Do not describe the demo as protecting the data; if stronger privacy is needed, hide ratios, names and accounts or use a fixed $100{,}000$ synthetic portfolio.

## Backend and market data

- Keep Sheets parsing, market-data providers, analytics, and API routes separate.
- Download market-data and FX files with `npm run download:market-data`; do not fetch external data per frontend render.
- Use local historical prices and FX rates for reporting-period analytics.
- Keep the Yahoo download logic isolated in the script so its provider can be replaced without changing workbook schemas.

## Suggested project structure

```text
src/
  app/                    # Next.js routes, layouts, and API route handlers
    (dashboard)/          # Authenticated dashboard pages
    admin/                # Settings and data-quality views
    api/                  # Read-only JSON endpoints
  components/
    charts/               # Reusable chart components
    dashboard/            # Page-specific dashboard components
    ui/                   # Small generic UI primitives
  features/
    cashflow/             # Domain UI and view models
    net-worth/
    portfolio/
    simulations/
  lib/
    sheets/               # Google Sheets client, schema parsing, validation
    market-data/          # Local price and FX retrieval
    analytics/            # Pure financial calculations
    auth/                 # Auth.js Google OAuth config, access resolution (allowlist, lucky seed), seed action
    demo/                 # Seeded multiplier and workbook scaling for demo mode
  types/                  # Shared domain and API types
scripts/                  # Workbook checks and market-data downloader
data/market-data/         # Downloaded ticker and FX price files
docs/                     # Appendix, workbook reference, how it works, troubleshooting
public/                   # Static assets
STYLE.MD                  # Frontend visual-system decisions
CLAUDE.md                 # Agent instructions and technical constraints
README.md                 # Product overview and setup walkthrough
```

Keep Google Sheets I/O in `lib/sheets`, local price reads in `lib/market-data`, and Yahoo download I/O in `scripts/download-market-data.ts`. Keep calculations in pure `lib/analytics` functions. Do not put Google Sheets or market-data calls in React components.

## Frontend style

Follow [STYLE.MD](STYLE.MD) when it exists. It will define visual direction, typography, color, spacing, chart conventions, responsive behavior, and component patterns. Until then, keep UI choices simple, consistent, and accessible.

Use Recharts for every interactive data visualization.

## Dashboard scope

Primary pages:

1. Home overview: net worth, monthly cash flow, savings rate, portfolio value, allocation drift, FIRE progress.
2. Cashflow dashboard (`/`; `/cashflow` redirects to it): keep contributions separate from income and expenses. The summary table always shows all January–December months of the year chosen in its dropdown (the latest transaction year by default); missing/future values are `—`. Include income, parent-category expense, savings, and savings-rate tables with total and monthly-average columns. Monthly averages end at the previous month. Show monthly income/expense, parent-category area, savings-rate, and current-year cumulative income-versus-expense charts.
3. Net worth dashboard (`/networth`): show financial instruments, cash assets, and other assets in separate table sections. The first columns are asset name, ticker, and currency; subsequent columns are the twelve fixed January–December month columns of the year chosen in a dropdown (see Summary table layout): a month shows its reporting-period values, or `—` when it has none. A final `Current` column follows December when the current date is in the selected year; the current period is compared with the latest valued period. The current period uses the latest downloaded prices; cash and manually valued assets use their latest reported values. Quantity rows use `metadata.DISPLAY_NAME`, then `metadata.FULL_NAME`. Use local historical prices and FX rates for historical periods. Show missing values as `—`; show a data-quality warning if local market data is unavailable. Add totals in `CURRENCY_1`, `CURRENCY_2`, and `CURRENCY_3`; if either secondary currency is absent or invalid, fill in order from `EUR`, `CHF`, and `USD`, excluding `CURRENCY_1`. Display plain numeric values without currency symbols; identify currency only in total-row labels and the current-net-worth heading. Under totals, display absolute and percentage period-over-period changes in `CURRENCY_1`. Include a benchmark comparison using financial instruments only (quantity assets): cash and manually valued assets are excluded. This assumes income distributions are reinvested in the tracked instruments; distributing ETF dividends held as broker cash understate portfolio returns. Missing local prices can understate financial totals, so refresh market data and review data-quality warnings before relying on results. Provide selectable 60/40 or 100% stocks, reporting currency and rebalancing interval, contributions invested at the start of the following month, withdrawals from `cashflow`, contribution markers, and annualized money-weighted IRR. Cashflows dated after the latest reported holdings are not replayed into the benchmark, because the current portfolio value still uses those holdings.
4. Portfolio performance and allocation: benchmark comparison, contributions, returns, target versus actual allocation, drift, and eventual look-through exposure.
5. Monte Carlo: FIRE success probability, terminal-value distribution, sequence-of-returns scenarios, Value at Risk, and configurable assumptions.
6. Admin/settings outside the main navbar: data refresh, constants, benchmark, cache, and data-quality checks.

## Validation and commands

- Required environment variables in `.env.local`: `GOOGLE_SHEET_ID`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, plus `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` and `AUTH_SECRET` for Google sign-in, and `DEMO_SALT` for the demo multiplier (and `AUTH_TRUST_HOST=true` on a proxied host). The allowlist is not an environment variable. `.env.local` is git-ignored and is not deployed: set the same variables in the host's settings.
- Run `npm run download:market-data` after workbook changes and before running or deploying the app.
- Run `npm run test:sheets` after changes to Sheets parsing or workbook validation.
- Run `npm run lint` and `npm test` for code changes. Tests live in `tests/*.test.ts(x)` (`node:test` through `tsx`), use synthetic data only, and need no environment variables. Add or update a test with every parser, analytics, or market-data change.
- Do not print or commit environment values, service-account keys, OAuth client secrets, or spreadsheet identifiers.
- Deployment: `data/market-data` is tracked in git, so a host that deploys from the repository already has the price files; the file names are the held tickers, which is accepted, so the repository may be public. Before deploying, set `DEMO_SALT`, fill `ALLOWED_EMAILS` (and optionally a long `LUCKY_SEED`) in `constants`, and write the real `/privacy` and `/ts` pages before publishing the OAuth app.
- The root layout builds `<title>` and description from `APP_NAME` / `APP_DESCRIPTION`; each page exports its own `metadata.title`. Robots/`noindex` is hard-coded in `generateMetadata` (`robots: { index: false, follow: false }`). Environment changes need a restart of the dev server; `next start` additionally needs `AUTH_TRUST_HOST=true`.
