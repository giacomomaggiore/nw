# How it works

Technical notes for people who read or change the code. For setup and daily use, see the [README](../README.md). The product contract for agents is [CLAUDE.md](../CLAUDE.md).

## Architecture

```text
Google Sheets (read-only)                         data/market-data/*.json
  │                                                  ▲ npm run download:market-data (Yahoo Finance)
  │ lib/sheets: client, parsers, validation          │
  ▼                                                  │
typed workbook (cashflow / net worth)  ──►  lib/market-data: prices, FX, valuation, conversion
                                                     │
                                                     ▼
                                          lib/analytics: pure, deterministic reports
                                                     │
                                                     ▼
                    src/app: server pages and loaders ──►  src/components: tables and Recharts
```

Rules that keep the layers apart:

- `src/lib/sheets` is the only place that talks to Google Sheets. It parses and validates; it does not calculate.
- `src/lib/market-data` reads the local price files and converts workbook data into valued, single-currency inputs. Yahoo Finance is called only by the downloader script.
- `src/lib/analytics` contains pure functions: no I/O, no React, no environment access.
- Route pages are server components. A loader (`load-*-page.ts`) composes workbook loading, market-data conversion and analytics, and hands serializable reports to client components.
- Client components own only interaction state (filters, legends, toggles). They never fetch financial data.

### Request lifecycle

1. The page calls `await connection()`, so it is rendered per request. There is no cache for financial data: every page load re-reads the workbook and the price files. Two things sit outside this: the root layout reads `APP_NAME` / `APP_DESCRIPTION` through a cached loader (`"use cache"`, refreshed after a few minutes), and the navbar reads the Google session cookie in its own `Suspense` boundary.
2. The page hands `resolveMultiplier` to the loader, which calls it first, inside its `try` (allowlisted user or lucky seed: factor 1; anyone else: the seeded demo factor, see [Demo mode](#demo-mode)). A failure, for example a missing `DEMO_SALT`, therefore shows as the page's normal error box. The loader reads the needed tabs in parallel with one Sheets call per range, parses them into typed workbooks and multiplies the money inputs by that factor.
3. A fresh market-data object is created for the request. It reads each price file at most once and answers every later lookup from memory.
4. Workbook values are priced and converted, then the analytics build the reports.
5. The page renders. If a step fails, the page shows the error message in a bordered box instead of the dashboard. On `/networth` the cashflow-dependent sections fail separately and leave the rest intact (see [Failure handling](#failure-handling)).

### Module boundaries

| Path | Responsibility |
| --- | --- |
| `src/lib/sheets/client.ts` | Service-account Google Sheets client; reads A1 ranges with unformatted values (the only Sheets I/O) |
| `src/lib/sheets/cashflow.ts`, `net-worth.ts`, `parse.ts` | Pure tab parsers and normalization (dates, currencies, headers, constants) |
| `src/lib/sheets/app-settings.ts` | `APP_NAME` / `APP_DESCRIPTION` from `constants`, with defaults for blank or missing keys |
| `src/lib/auth/auth.ts` | Auth.js configuration: Google provider (verified emails only), JWT sessions; exports `handlers`, `auth`, `signIn`, `signOut` |
| `src/lib/auth/access.ts` | `resolveAccess` / `resolveMultiplier`: allowlist and lucky-seed check, cached access settings, seed cookie; server-only |
| `src/lib/auth/demo-seed.ts` | Server action that stores the visitor's seed in an HTTP-only cookie |
| `src/lib/sheets/access-settings.ts` | `ALLOWED_EMAILS` and `LUCKY_SEED` from `constants` |
| `src/lib/demo/multiplier.ts`, `scale.ts` | Seeded multiplier in [0, 10) (HMAC with `DEMO_SALT`) and the workbook scaling |
| `src/lib/sheets/validate.ts` | Contract checks behind `npm run test:sheets`; reports every problem with row numbers |
| `src/lib/market-data/prices.ts` | Local price and FX store: reads files, price and FX lookups |
| `src/lib/market-data/net-worth.ts` | Values every asset per period and currency; price changes for the growth sources |
| `src/lib/market-data/cashflow.ts` | Converts transactions to a reporting currency at their own date |
| `src/lib/market-data/benchmark.ts` | Daily benchmark prices (ACWI, BND) in a report currency |
| `src/lib/market-data/symbols.ts` | Every symbol the dashboards need (tickers, benchmark ETFs, FX pairs) |
| `src/lib/market-data/yahoo.ts` | Yahoo Finance chart-endpoint client |
| `src/lib/analytics/net-worth.ts` | Totals, period changes and growth sources |
| `src/lib/analytics/benchmark.ts` | Benchmark simulation, Modified Dietz returns, XIRR and risk metrics |
| `src/lib/analytics/hall-of-fame.ts` | Monthly rankings |
| `src/lib/analytics/cashflow.ts` | Monthly cashflow report and moving-average series |
| `src/lib/analytics/cashflow-insights.ts` | Calculations behind the expense filters and insight charts |
| `src/lib/dates.ts`, `format.ts`, `sets.ts` | UTC date helpers, display formatting (plain numbers, `—` for missing), small set helper |
| `src/types` | Domain types shared by the layers |
| `src/app` | Routes, page loaders and the read-only server pages; `layout.tsx` builds the site metadata, `load-app-settings.ts` caches the settings read, `api/auth/[...nextauth]/route.ts` serves the Auth.js endpoints |
| `src/components` | Tables and Recharts charts; `charts/chart-style.ts` holds the shared chart styling, `ui/` the shared filters, the navbar and the session-aware `user-profile.tsx` |
| `scripts` | `download-market-data.ts` (price store refresh) and `test-google-sheets.ts` (workbook validation) |
| `tests` | The `node:test` suite and its synthetic fixtures |

## Market data

### The local store

`data/market-data` holds one JSON file per symbol, named with `encodeURIComponent(symbol)`, for example `ACWI.json` and `USDEUR%3DX.json`. A file contains the symbol, a download timestamp and daily rows with the raw `close` and the dividend-adjusted `adjustedClose` (null when the provider has none).

The downloader requests, for every run:

- Every `assets.ASSET` whose datatype is `quantity` (the ticker).
- `ACWI` and `BND` for the benchmark.
- An FX pair `FROMTO=X` from every currency found in the workbooks (report currencies, asset currencies, transaction currencies) to every reporting currency, so every conversion can be answered directly, without inverting or chaining rates.

Replacing Yahoo means changing `scripts/download-market-data.ts` and `lib/market-data/yahoo.ts` while keeping this file format.

### Lookups

- **Price or FX on a date:** the close of the first trading day on or after the date. Weekend and holiday dates therefore use the next trading day. A date after the last row uses the latest close, and a date before the first row uses the first close.
- **Latest price or FX:** the last row of the series.
- **Raw closes** value the net-worth table and convert currencies. **Adjusted closes** (total return) drive the benchmark and the year-to-date column.
- A missing or corrupt file raises `Download market data for <symbol> with npm run download:market-data.`

## Backend logic in detail

### Reading and parsing the workbook

- Ranges read: `cashflow!A:H`, `categories!A:D`, `constants!A:B`, `assets!A:Z` (at most 22 reporting-period columns), `metadata!A:G`. The root layout reads `constants!A:B` on its own for the site metadata.
- Dates arrive as Google Sheets serial numbers and become ISO `YYYY-MM-DD` strings. Every date in the app is a UTC calendar day, never local time.
- Headers are matched case-insensitively. The seventh `cashflow` header may be `CITY`, a legacy alias for `SUBCATEGORY`. `DOL` is accepted as a legacy alias for `USD`.
- `constants` keys are upper-cased. Only `CURRENCY_*` values are normalized as currency codes (upper-case, `DOL` → `USD`); every other value is kept as typed.
- Parsers throw on the first problem (for example an unknown category on a row); `test:sheets` reports all of them.
- **Report currencies.** Cashflow: `CURRENCY_1..3` from `constants`, valid three-letter codes, unique, in order (at least `CURRENCY_1`). Net worth: `CURRENCY_1` first, then `CURRENCY_2` and `CURRENCY_3`, then `EUR`, `CHF`, `USD` (excluding duplicates) to fill up to three; only these three currencies are supported there.

### Net-worth valuation (`valueNetWorth`)

1. The **latest reporting period** is the last `assets` column in which any asset has a value. Later columns are empty and are dropped. The periods used are every column up to it, plus the **current date**, which always comes last.
2. For each asset and period, the reported cell is read. A blank cell means no value (`null`).
   - `quantity`: quantity × the close on or after the period date.
   - `cash` and `value`: the reported number.
   - **Current period:** the latest reported quantity or balance (from the latest reporting period) × the latest close.
3. Each value is converted into every report currency with the FX rate of the same date (latest rate for Current).
4. A lookup that fails (missing file, no price) gives `null` and a data-quality warning; the remaining assets are unaffected. Warnings are de-duplicated and shown above the table.

### Net-worth reports

- **Totals** are computed independently in each report currency: the sum of all non-null converted values of the period, split into financial instruments, cash and other assets. A total is `null` only when no asset has a value. Missing values are skipped, not counted as zero, so a missing price understates a total; the warning says so.
- **Change rows** compare each period with the previous one in the first report currency: absolute change, and percentage change when the previous total is non-zero. Current is compared with the last valued period.
- **Summary table columns** (`netWorthYearColumns`): always January to December of the year chosen in the dropdown, one column per month. A month shows the report period dated in it, or `—` when there is none (a gap in the `assets` columns, a year before the first period, months after the latest reported one). The current period is a separate `Current` column after December, shown only when the current date is in the selected year; it never fills a month column. The change rows keep comparing each period with the previous report period, not with the previous calendar month.
- **YTD %** per instrument: the dividend-adjusted close from the first trading day of the year to the latest close, with the FX rate of the first day and the latest FX rate, in the selected currency. It is `null` for cash and manual assets.
- **Growth sources** (per period, per currency):
  - *Salary*: income transactions categorized `salary` dated in (previous period, period].
  - *Financial assets*: for each quantity asset, (end price − start price) × holdings at the start of the period, summed and converted at the start-of-period FX rate. A missing price or rate makes the period `null`.
  - *Total increase*: the actual change of the total net worth. The two sources are explanatory, not an exact decomposition: contributions, other income, expenses and currency moves are not part of them.
- **Hall of fame**: twelve monthly rankings (best income, salary, net-worth change, savings and savings rate; highest and lowest expenses; worst net-worth change), each top ten plus the current month's value. Months run from the earliest of the first reporting period and the first transaction through the current month. Income and expenses are converted per transaction at its own date; rankings use CHF and EUR whatever the report currencies are. The current month is partial.

### Benchmark engine

The comparison covers the **financial-instruments portfolio only** (`quantity` rows): cash and manually valued assets are excluded. Two benchmarks are simulated at once, **60/40** (60% ACWI, 40% BND) and **100% stocks** (ACWI), with a selectable rebalancing interval (monthly by default, quarterly, yearly). Benchmark prices are dividend-adjusted closes converted daily into the selected report currency.

External flows come from `cashflow`:

- A `contribution` enters the portfolio at the **start of the following month** and is invested in the benchmark on the first close on or after that date.
- An `income` row with the `withdrawal` category leaves the portfolio on its own date. It is also income for cashflow reports.
- Flows after the **latest reported holdings** are not replayed. The Current portfolio value reuses those holdings, so a contribution invested later is not in the portfolio yet; including it would inflate the benchmark.
- Purchases, sales, dividends, fees and taxes inside the platform are internal and never recorded in `cashflow`. The portfolio-return series assumes distributions are reinvested in the tracked instruments, so ETF dividends held as broker cash understate returns.

The benchmark starts with the value of the first non-null portfolio snapshot and replays the same flows. A flow on a snapshot date counts in that snapshot; rebalancing happens once the chosen number of calendar months has passed since the last one.

Metrics (computed by `buildBenchmarkComparison`; not displayed yet) use the interval returns between the portfolio's non-null snapshots. Each interval return is a Modified Dietz return:

$$
r = \frac{V_{end} - V_{start} - \sum CF}{V_{start} + \sum(CF \cdot w)}
$$

where $w$ is the fraction of the interval for which a flow was invested (a flow on the end date has $w = 0$).

- **Growth:** compounded product of the interval returns.
- **IRR:** annualized money-weighted return (XIRR) over the first value, every flow and the last value, solved by bisection.
- **Volatility:** sample standard deviation of interval returns × $\sqrt{12}$ (monthly snapshots).
- **Sharpe ratio:** mean interval return over its standard deviation × $\sqrt{12}$, with a zero risk-free rate.
- **Maximum drawdown:** worst fall from the peak of the flow-free cumulative index.
- **Best / worst month:** highest and lowest interval return.

### Cashflow pipeline

1. Every transaction is converted into each reporting currency at the FX rate of its own date.
2. `contribution` rows are excluded from income, spending, savings-rate and category reports. They matter only to the benchmark.
3. `buildCashflowReport` buckets income and expenses by month from the first to the last transaction. A month with no transaction has all-`null` values: tables show `—` and charts show a gap. Income is also grouped by category; expenses by category and by parent category (`CATEGORY → PARENT_CATEGORY`); salary is income categorized `salary`. Expenses with a blank category are never inferred: they count in totals and in `unclassifiedExpenses`, but not in any category row.
4. Savings are $income - expenses$; the savings rate is $savings / income$ when income is non-zero.
5. `periodsInRange` returns one period per month in a date range, filling months without data with `null` periods.

### Cashflow summary table

- Always shows all twelve months, January to December, of the year chosen in the dropdown (the latest transaction year by default), with a Total column and a Monthly avg column. Months without data show `—`; the date-range and currency filters never change the columns.
- Totals sum the months that have data. The total savings rate is total savings over total income.
- Monthly averages cover the months up to the previous month (the current month is still in progress); months in that window without data count as zero. The savings-rate average is the mean of the monthly rates that exist.
- Rows: income by category, expenses by parent category, two "no rent" variants, expenses, savings and savings rate.

### Expense insights and filters

The insights section works on the categorized expense transactions of the selected report currency.

- **Date range** (shared with the trend chart): quick ranges All time, YTD, Current year, Last year, or explicit From/To dates. Insights never look past today; an empty or reversed range selects nothing.
- **Month** filter: keep only one calendar month in every year of the range.
- **Classification**: all, essential, discretionary (not essential), recurring, non-recurring.
- **Parent categories** and **categories**: checkbox menus. Both apply together (an expense must match both); an empty selection means no filter.
- From the selection the app derives the totals tiles (total, daily average over the selected days, salary, essential, discretionary, recurring), the monthly stacked category chart, the essential/discretionary/recurring charts, the savings-rate chart and the cumulative salary-versus-expenses chart. The savings rate is the month's income against the *selected* expenses.
- The **category chart** draws only groups with expenses in the selection, largest first, with 12 distinct colours; beyond 12 groups the smallest are merged into one grey series. Clicking a legend entry hides a series.
- The **moving average** chart and table are independent of the filters: they use every expense up to the end of the previous month and a window of 1 or more days.
- The **historical expenses** chart follows one category or one parent category month by month, optionally next to salary.

### Failure handling

- Workbook or market-data errors on `/` show the error message instead of the dashboard.
- On `/networth`, a missing price or FX rate becomes a `—` cell plus a warning. If the cashflow side or the benchmark prices cannot be loaded, the growth table, rankings and benchmark comparison degrade on their own and a single warning is added, while the report itself still renders.

## Frontend

- **Net worth.** Header with the current net worth in the selected currency; trend chart with currency buttons, date-range filters and the change since the first period; the asset table (instruments, cash and other assets with subtotals, totals in every report currency, absolute and percentage change, a year selector that picks the year of its fixed January–December columns, and the YTD column); the benchmark comparison with contribution markers and the methodology dialog; the growth sources chart with an optional summary table; the hall of fame; net worth in all currencies on one axis. The range filter applies to the charts, not to the table (its own year selector) or the hall of fame.
- **Cashflow.** Currency buttons and the date range at the top; monthly income, expenses and salary trend; the summary table; the expense insights; the historical expenses chart.
- **Conventions**: plain numbers without currency symbols (the currency appears in headings, total rows and tooltips), `—` for missing values, grey-bordered tables with a light-grey header, no CSS animations, restrained hover tooltips.
- **Responsive behaviour.** Charts use Recharts `ResponsiveContainer`. Wide tables have a minimum width per period column and scroll horizontally inside their frame on narrow screens. The server passes the reporting date to the cashflow dashboard so the first render and hydration agree.

## Authentication

Google OAuth through Auth.js (`next-auth` v5, beta channel), configured in `src/lib/auth/auth.ts`. The handlers live at `/api/auth/*`. The session is a signed JWT cookie, so there is no database; Auth.js reads `AUTH_SECRET`, `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` from the environment on its own.

**Current behavior.** Signing in is optional and only identifies the user. Only verified Google emails can sign in (`email_verified` must be true). `resolveAccess()` in `src/lib/auth/access.ts` then decides, per request on the server, who sees real values: an allowlisted email, or a visitor whose demo seed equals `LUCKY_SEED`. Everyone else, signed in or not, gets [demo mode](#demo-mode).

**Navbar profile** (`src/components/ui/user-profile.tsx`, a server component rendered in the root layout inside `Suspense`):

- Signed out: a small round `?` button with a thin **red** border. Clicking it starts the Google sign-in and returns to the same page.
- Signed in: the Google profile picture (or the initial of the name) with a thin **green** border and a *Sign out* button. Green means "signed in with Google", not "allowed": a signed-in account that is not on the allowlist sees demo values.
- Everyone who is **not** an allowlisted user also gets a **Seed** input with an *Apply* button (see [Demo mode](#demo-mode)). Allowlisted users do not see it.
- While the values are randomized (anyone without real access), an amber **warning icon** sits left of the seed input. Hovering, focusing or clicking it shows: "Randomized data. Log-in if you are an authorized user or try to guess the right seed to see real data". It is hidden for allowlisted users and for a visitor whose seed equals `LUCKY_SEED`, because they see real values.
- A component that reads the session must call `await connection()` and sit inside `Suspense`, otherwise Next 16 (`cacheComponents`) fails the prerender.

## Demo mode

Everyone who is not an allowlisted Google user, and has not entered `LUCKY_SEED`, sees demo values: **every money amount is multiplied by one factor in [0, 10)** derived from a seed. The upper bound is the constant `DEMO_MULTIPLIER_MAX` in `src/lib/demo/multiplier.ts`, the only place to change it (the tests and the code use the constant; update the numbers in these docs too).

- **Seed.** The *Seed* input in the navbar sets it (any text, up to 64 characters; blank restores the default seed `1`). It is stored in an HTTP-only cookie, so it applies to every page and survives reloads. The factor itself is never displayed or sent to the browser.
- **Real values.** An allowlisted Google email, or a seed equal to `LUCKY_SEED`, gets the factor 1.
- **Not scaled:** percentages and returns (savings rate, allocation, YTD, IRR, growth curves), counts, dates, category names, asset names, tickers and account names.

### Who sees what

| Visitor | Seed cookie | Result |
| --- | --- | --- |
| Not signed in | none (default `1`) or any text | Demo values, factor from the seed |
| Not signed in | equals `LUCKY_SEED` | Real values |
| Signed in, email not on `ALLOWED_EMAILS` | any | Demo values (green border, seed input still shown) |
| Signed in, email on `ALLOWED_EMAILS` | any | Real values; the seed input is hidden |
| Anyone, Sheets read of the access keys fails | any | Demo values (fail closed) |
| Anyone, `DEMO_SALT` missing | not `LUCKY_SEED` | The amount pages fail with `Set DEMO_SALT in the environment.` (never real values) |

### How a request is resolved

1. **Session.** `auth()` reads the signed Auth.js cookie. Sign-in is only accepted for verified Google emails (`signIn` callback requires `profile.email_verified === true`), so the session email can be trusted for the allowlist match.
2. **Access keys.** `loadCachedAccessSettings()` reads `constants!A:B` through `lib/sheets/access-settings.ts` and returns the lower-cased, trimmed `ALLOWED_EMAILS` list and `LUCKY_SEED`. It is a `"use cache"` function with `cacheLife("minutes")`, so Sheets is called at most about once a minute; the result stays on the server. If the read throws, it returns an empty list and no lucky seed.
3. **Seed.** The `demo-seed` cookie, or `1` when the cookie is absent or empty.
4. **Decision** (`resolveAccess`): `isAllowedUser` = the session email is in the allowlist; `real` = `isAllowedUser` or the seed equals `LUCKY_SEED`. The comparison hashes both values with SHA-256 and uses `timingSafeEqual`, so the check does not leak how many characters matched.
5. **Factor** (`resolveMultiplier`): `1` when `real`; otherwise `demoMultiplier(seed, DEMO_SALT)`.
6. **Loaders.** `/` calls `loadCashflowPage(loadCashflowWorkbook, multiplier)` and `/networth` calls `loadNetWorthPage(defaultNetWorthSources, multiplier)`. Right after reading each workbook the loader scales it (`scaleCashflowWorkbook`, `scaleNetWorthWorkbook`), and the rest of the pipeline (FX conversion, valuation, totals, benchmark, growth sources, hall of fame) runs unchanged on the scaled inputs. The net-worth page scales its cashflow source too, so the benchmark flows and growth sources match the scaled portfolio. A multiplier of `1` returns the workbook object untouched.

### The factor

`demoMultiplier(seed, salt)` computes `HMAC-SHA256(key = DEMO_SALT, message = seed)`, reads the first 6 bytes as an integer in [0, 2^48), divides by 2^48 and multiplies by `DEMO_MULTIPLIER_MAX` (10). The result is uniform in [0, 10), identical for the same seed and salt, unpredictable without the salt, and unrelated for neighbouring seeds (`9` and `10` give unrelated factors). It uses Node's `crypto`, so it runs on the server only. Changing `DEMO_SALT` changes every seed's factor.

### Why linear scaling keeps the page consistent

Quantities, cash and manual values, and transaction amounts are the only inputs scaled. Prices and FX rates are market data and are not touched. Every displayed amount is a linear function of those inputs, so totals, subtotals, changes in absolute terms, chart series and rankings all scale by the same factor. Ratios are invariant: percentage changes, savings rate, allocation, YTD, IRR, volatility, Sharpe, drawdown and growth curves are the real ones. That invariance is also why they leak (see the limits below).

### Warning icon

`DemoNotice` (`src/components/ui/demo-notice.tsx`, a small client component) renders the icon and a tooltip. The tooltip is `fixed` and positioned under the icon, because the navbar scrolls horizontally and would clip an absolutely positioned one. It opens on hover, keyboard focus or click/tap, and closes on mouse leave, blur, `Escape` or a tap outside (touch screens have no hover or blur). The server decides whether to render it (`!real`), so a visitor with real access never receives it.

### Seed form and cookie

The form posts to the `setDemoSeed` server action (`src/lib/auth/demo-seed.ts`). It trims the text, cuts it to 64 characters and writes the `demo-seed` cookie: `httpOnly`, `sameSite=lax`, `secure` in production, path `/`, one year. An empty seed deletes the cookie. Because the action changes a cookie, Next re-renders the current page with the new seed, so the numbers update without a reload. The input is keyed by the seed so it remounts with the stored value. Allowlisted users do not get the form, and their cookie is ignored.

### Limits to know before exposing the app

- Ratios are real, so the shape of the portfolio and the cashflow stays visible.
- The factor is uniform in [0, 10) and the same seed always gives the same one. A script that tries many seeds sees amounts spread between 0 and 10 times the real value, and the largest observation approaches ten times the real value, so the real amounts can be estimated. A wide range also means demo values can be far larger than the real ones, which looks odd next to unscaled percentages. The salt stops a visitor from computing the factor for a given seed, not from sampling it.
- `LUCKY_SEED` can be guessed by trial if it is short; there is no rate limiting.
- Names, tickers, account names, categories and dates are not hidden.
- Treat it as casual obfuscation, not as protection for data you cannot afford to leak.

### Implementation notes and gotchas

- **`cacheComponents` is on.** A component that reads the session or cookies must call `await connection()` and sit inside `Suspense`; otherwise Next fails the prerender with a `crypto.getRandomValues()` error. `UserProfile` does both, and the root layout wraps it with a neutral placeholder as fallback.
- **A deleted cookie reads back as `""` in the same request.** `resolveAccess` therefore uses `cookie || DEFAULT_SEED`, not `??`. With `??` the page rendered with an empty seed right after clearing it.
- **`"use server"` files may only export async functions**, so the cookie name, default seed and length limit live in `access.ts`, not in `demo-seed.ts`.
- **Loader signatures.** `loadCashflowPage(loadWorkbook = loadCashflowWorkbook, getMultiplier = () => 1)` and `loadNetWorthPage(sources = defaultNetWorthSources, getMultiplier = () => 1)`. `getMultiplier` is a function (sync or async) and runs inside the loader's `try`: when it throws, the page shows the message in its error box instead of crashing with HTTP 500. The pages pass `resolveMultiplier` itself. The defaults keep the existing tests unchanged; `defaultNetWorthSources` is exported so the page can pass a multiplier function without redefining the sources.
- **`parseConstants` now keeps text as typed.** Before, every value was upper-cased as a currency; now only `CURRENCY_*` values are normalized. Text keys (`APP_NAME`, `APP_DESCRIPTION`, `ALLOWED_EMAILS`, `LUCKY_SEED`) keep their case.
- **Site metadata.** The root layout uses `generateMetadata` with `title: { default: APP_NAME, template: "APP_NAME %s" }`; each page exports its own `metadata.title` (`Cashflow`, `Net worth`, `SAA`, `Monte Carlo`, `Docs`, `Privacy policy`, `Terms of service`). Settings come from a cached loader that falls back to defaults on error.
- **Dependency.** `next-auth@beta` (5.0.0-beta.32) was added to `package.json`.

### Tests

`tests/demo-access.test.ts` covers: the multiplier is deterministic, stays within `[0, DEMO_MULTIPLIER_MAX)`, depends on both seed and salt, covers the range, and refuses to run without `DEMO_SALT`; scaling multiplies quantities and amounts, leaves names and categories alone, does not mutate its input and is the identity at 1; a cashflow page loaded with factor 2 shows doubled income and expenses and an unchanged savings rate; the access-key parser lower-cases and trims emails, keeps the lucky seed as typed and grants nothing for missing or blank keys. `tests/sheets-constants.test.ts` covers the `constants` text handling and the app-settings defaults. The cookie action, the allowlist decision and the navbar were checked by hand in a temporary copy of the app with dummy credentials and no real data: the seed form renders with the default, the cookie is HTTP-only and persists across pages, clearing it restores the default, and the signed-out and signed-in navbars render the red and green borders.

## Tests and validation

```bash
npm test            # node:test suite through tsx
npm run test:sheets # live workbook contract check
```

`npm test` runs 19 test files in `tests/`. It needs no environment variables and never touches Google Sheets, the real `data/market-data` files or the network: tab parsers take plain arrays, market-data tests use a temporary directory and a stubbed `fetch`, and the dashboards are rendered from synthetic reports. It covers parsing (including the `constants` text values, the app settings defaults and the access keys), the demo multiplier and scaling, validation, valuation, analytics, the benchmark, the hall of fame, the filters, the page loaders and the dashboard render.

`npm run test:sheets` checks, per tab:

- `cashflow`: required columns; required values; allowed types; non-negative amounts; three-letter currency codes; known categories.
- `assets`: required columns; ascending Google Sheets dates; allowed datatypes; numeric values.
- `metadata`: required columns, optionally followed by `PROXY`; every field except `DISPLAY_NAME` and `PROXY` is required; `TER` is a yearly fraction between 0 and 0.05; `PROXY` has the `SYMBOL*weight+...` syntax and is never the fund itself.
- `categories`: required columns and values; boolean `TRUE`/blank flags; no duplicates.
- `saa`: required columns; ascending dates; non-negative targets.
- `constants`: no header row; a non-empty key and value on every row. It does not yet validate `ALLOWED_EMAILS` or `LUCKY_SEED`.

