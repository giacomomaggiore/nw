# Monte Carlo

Status: **the first configurable Monte Carlo dashboard is implemented**: local Yahoo/FRED downloads, proxy backfill, monthly dataset construction, the server loader, browser worker, editable current-portfolio assumptions, annual cashflows, contribution frequency, rebalancing controls, and a tax-rate input are available at `/montecarlo`. Additional cost and risk metrics remain later phases. This file holds the decisions of the brainstorm; there are no open questions.

Implemented so far, all pure and deterministic:

| Module | Content |
| --- | --- |
| `random.ts`, `distributions.ts` | xoshiro128** with seed expansion and unbiased `nextInt`; Box-Muller normal, Marsaglia-Tsang gamma, chi-square. |
| `statistics.ts`, `quantiles.ts`, `matrix.ts` | mean, covariance, pooled kurtosis and $\nu$ estimate; linear-interpolation quantiles; Jacobi eigendecomposition, Higham repair, Cholesky. |
| `dataset.ts`, `types.ts` | the `MonthlyDataset` contract and its validation (at least 60 months, finite, returns above −100%). |
| `bootstrap-engine.ts`, `student-t-engine.ts`, `scenarios.ts` | the two engines and `generateScenarios` (stored `Float32Array`, caps, `maxPaths` hint, model details). |
| `lib/sheets/proxy.ts`, `net-worth.ts`, `validate.ts` | the optional `metadata.PROXY` column: `parseProxy`, `ter` and `proxy` on every `AssetRow`, header and range (`metadata!A:G`) handling, and the `test:sheets` checks (TER unit, proxy syntax). |
| `accounting.ts`, `summary.ts` | `account` (drifting holdings, cash at the risk-free rate, constant value, live overrides) and `summarize` (bands, horizon table, histograms, sample paths; nominal and real). |
| `market-data/macro.ts`, `market-data/montecarlo.ts`, `app/montecarlo` | Local FRED reader, adjusted-price/proxy monthly history, loader, worker and dashboard. |

Not yet built: cash buffer, transaction costs, average-basis tax accounting, and the risk metrics of phase 3 (ruin, drawdown, VaR/CVaR). The theory and methodology page for readers is written separately by the owner and linked from the page.

## Purpose

Simulate possible outcomes of the **current financial portfolio** (current actual weights, valued at the latest prices) at any horizon from 1 to 40 years, optionally together with hypothetical yearly income, spending and one-off purchases. The page answers "what could my wealth look like in N years, and how bad can it get", not "will I reach a target": there is no FIRE number, no success-probability-versus-target and no time-to-target metric.

## Decisions

| Topic | Decision |
| --- | --- |
| Time step | Monthly. |
| Currency | Everything is simulated in `CURRENCY_1`. Each ticker series is converted daily with local FX (as the benchmark does), then resampled to month-end, so FX is a risk factor inside every return. |
| Granularity | One simulated series **per ticker** (every held `quantity` row, aggregated across accounts). No collapse into asset classes. |
| Return engines | The user chooses between **block bootstrap** and **parametric multivariate Student-t**. Both implement the same `nextScenario()` boundary. |
| Inflation, risk-free rate | Sampled together with returns. Risk-free is the **T-bill rate** (or the closest cash rate) and inflation is **CPI**, both from **FRED** for `CURRENCY_1` (see [Rate and inflation series](#rate-and-inflation-series-fred)). The user can override each with a constant. |
| History | Longer history is downloaded locally (see [Data layer](#data-layer)). The app still makes no runtime market-data requests. |
| Overrides | Per ticker, the user can override **expected return**, **volatility** and **starting weight** (see [Inputs](#inputs)). Applied live, without a new Run. |
| Starting portfolio | Latest valuation: `quantity` assets at their latest prices plus `cash`. `value` (manual) assets are excluded by default; the user may add them as a **constant value**. |
| Cash | Cash is the **buffer that pays spending**; it earns the risk-free rate. |
| Rebalancing | The user chooses: drift (never), tolerance band, or calendar (monthly, quarterly, semi-annual, annual). |
| Costs and tax | Costs are always included. Capital-gains tax is a single rate entered by the user. The cost basis of existing holdings is their current value. |
| Cash-flow modes | **Portfolio only** (no flows) or **with cash flows** (yearly income, yearly spending, one-off purchases). Everything is **nominal**; income is **net** of income tax. |
| Deficits | When spending exceeds income and cash, the portfolio is sold pro rata (costs and tax apply). **Ruin** means total wealth reaches zero. |
| Live recalculation | Scenario paths are generated **once per Run**. Every other input re-runs only the accounting over the stored paths, in real time (see [Architecture](#architecture)). |
| Outputs | Fan chart (percentile bands), terminal-value distribution, horizon table, ruin probability, loss probability, max drawdown, VaR/CVaR. Nominal by default, real by toggle. |
| Determinism | Seeded PRNG; the same seed, data and settings give identical results. The seed is shown. |
| Where it runs | In the **browser**, in a Web Worker; the server only supplies the starting state and the monthly dataset. |
| Tests | TypeScript only, synthetic data, no Python cross-check. |
| Out of scope for now | Stress scenarios, withdrawal policies and retirement phases ("later phases"), borrowing/margin leverage, a benchmark comparison, what-if tickers that are not held, an on-page explainer (a separate methodology page is written by the owner). |

## Data layer

### Longer history

The downloader currently requests prices from the earliest date in the workbook, which is why the local files hold only about 14 months. For Monte Carlo it must download the maximum available history for:

- every held `quantity` ticker and its proxy symbols (below);
- every FX pair already required;
- the FRED rate and CPI series of every reporting currency (see [Rate and inflation series](#rate-and-inflation-series-fred)).

The file format stays: daily rows with `close` and `adjustedClose`. With the maximum history the files are written with **one row per line**, which keeps them about three times smaller in git; readers parse standard JSON, so nothing else changes. Existing lookups are by date, so net worth, cashflow and the benchmark are unaffected. Adding sources other than Yahoo means adding downloader code next to `lib/market-data/yahoo.ts`; the app keeps reading only local files.

### Proxy backfill

Young or exotic funds (leveraged, overlay, managed-futures, tail-hedge) have too little history for a bootstrap or a covariance estimate. Each ticker may declare a **proxy** through one new optional `metadata` column, `PROXY`, placed after `ISSUER` (column G). Its value is a formula of one or more terms joined by `+`; a term is a Yahoo symbol with an optional weight, `SYMBOL` or `SYMBOL*weight` (a positive decimal with a dot, default 1). Blank means no proxy. Examples: `URTH*2` (twice world equity), `URTH*0.9+IEF*0.6` (90% equity plus 60% bonds). The contract is implemented and documented in `CLAUDE.md` and `docs/workbook.md`; parsed values reach the code as `AssetRow.proxy` (`ProxyTerm[]`) and `AssetRow.ter` (a yearly fraction, `0.0006` for 0.06%). Rules:

- The synthetic series is built at **daily** frequency with constant daily weights, so the daily-reset drag of leveraged products is captured, then spliced onto the ticker's own history at the first date the ticker trades. Real history always wins.
- Synthetic daily return: $\sum_i w_i\, r_i + \bigl(1 - \sum_i w_i\bigr)\, rf_{daily} - TER_{daily}$. Weights above 1 in total are financed at the risk-free rate; weights below 1 leave the rest in cash. The ticker's own history is already net of TER (adjusted closes are total return), so the ticker's `TER` is subtracted only on the synthetic segment, never twice.
- **Currency:** all terms are converted into the currency of the **first term**, combined there, and the combined series is converted **once** into the ticker's listing currency (the `CURRENCY` of its `assets` row; `metadata.CURRENCY` is the fund's own currency, which can differ, for example a USD fund listed in EUR). The fund's FX exposure therefore counts once, not once per unit of leverage: choose terms in the currency of the fund's base (for example USD terms for a USD-based fund listed in EUR). The downloader fetches the FX pairs this needs.
- After the splice, the series is converted to `CURRENCY_1` like any other. A EUR-listed fund held in CHF therefore carries EURCHF risk, as the real holding does.
- After backfill every ticker needs at least 60 monthly observations (the page warns below 120). A ticker with fewer, and no proxy, blocks the run with a data-quality message naming it. Overriding its return and volatility does not help: correlations still come from history.
- The common window starts at the youngest series after backfill. The owner accepted that `TAIL` (first trade 2017-04, no usable proxy) sets it, so a proxy only has to reach back before April 2017.

Initial entries for the owner's workbook (the `TER` already in `metadata` is what is deducted on the synthetic segment):

| Ticker | `PROXY` | Reason |
| --- | --- | --- |
| `LWLD.PA` | `URTH*2` | USD-based, 2× MSCI World; first trade 2025-10 |
| `NTSG.PA` | `URTH*0.9+IEF*0.6` | 90% developed equity plus 60% government-bond futures; launched 2024-11 |
| `GDE` | `SPY*0.9+GLD*0.9` | 90% US large-cap equity plus 90% gold futures; launched 2022-03 |
| `DBMF` | `AQMIX` | managed futures; first trade 2019-05 |
| every other ticker | blank | own history reaches back before 2017-04 |

### Rate and inflation series (FRED)

The risk-free rate and CPI come from FRED. `npm run download:market-data` stores each series as monthly `{ series, downloadedAt, observations: [{ date, value }] }` in `data/market-data/macro/<SERIES>.json`. It fetches the pair for **every reporting currency** (USD, EUR or CHF, the currencies the app supports), so it does not need to know which one is `CURRENCY_1`; the app reads the pair for `CURRENCY_1`. The call uses FRED's public CSV endpoint (`fredgraph.csv?id=<SERIES>`, no API key) and lives in its own module, like the Yahoo one, so the provider can be replaced.

| Currency | Rate | CPI |
| --- | --- | --- |
| USD | `TB3MS` (3-month T-bill) | `CPIAUCSL` |
| EUR | `IR3TIB01EZM156N` (3-month interbank) | `CP0000EZ19M086NEST` (HICP) |
| CHF | `IR3TIB01CHM156N` (3-month interbank) | `CHECPIALLMINMEI` |

FRED has a 3-month T-bill only for USD; for EUR and CHF the closest current cash rate is the OECD 3-month interbank rate. Freshness checked on 2026-11-04: USD rate to Oct 2026 and CPI to Sep 2026; EUR HICP to Sep 2026 but EUR rate only to Jan 2026; CHF rate to Sep 2026 but CHF CPI only to Apr 2025. OECD series on FRED go stale, so re-verify the IDs at implementation.

Known limit: the dataset keeps only rows where every column exists, so a stale series shortens the window. With the series above the usable window ends in Jan 2026 for EUR and Apr 2025 for CHF, and the latest months of returns are not sampled. The page shows the window end date next to the common-history hint.

### Monthly dataset

For the selected tickers, build one aligned table of month-end rows:

- asset returns: $r_t = P_t / P_{t-1} - 1$ on dividend-adjusted closes converted to `CURRENCY_1`;
- inflation: log CPI increment $\ln(\mathrm{CPI}_t / \mathrm{CPI}_{t-1})$;
- risk-free: effective monthly simple rate from the annual yield $y$ in percent: $(1 + y/100)^{1/12} - 1$.

A FRED observation dated the first day of a month belongs to the month-end row of that same month. Only rows where every column is finite are kept (common history). Invalid data returns a structured error; it is never clipped or silently dropped.

## Engines

Both engines produce one scenario per month: `{ assetReturns[], inflation, riskFreeRate }`. They know nothing about holdings, tax or React; the accounting loop knows nothing about where returns come from.

### Overrides (both engines)

Per ticker, with $m$ and $s$ the sample mean and sd of its monthly log returns, an override of expected return $g$ (annual geometric, net of TER) and/or volatility $\sigma_a$ (annual) maps every log return $\ell$ to

$$\ell' = \mu' + \frac{\sigma'}{s}(\ell - m), \qquad \mu' = \frac{\ln(1+g)}{12},\quad \sigma' = \frac{\sigma_a}{\sqrt{12}}$$

A blank override keeps the historical value ($\mu' = m$, $\sigma' = s$). Dependence between tickers is untouched. Inflation and risk-free overrides replace the sampled column with a constant.

Because the map is affine and per ticker, it can be applied **after** the paths are generated, with exactly the same result as generating with the override at the same seed. Bootstrap: the map is applied to the sampled rows. Student-t: $\Sigma' = D\Sigma D$ with $D = \mathrm{diag}(\sigma'_i/s_i)$ gives $L' = DL$, so $\ell'_i = \mu'_i + d_i(\ell_i - m_i)$; the repair acts on correlations and is unchanged. This is what lets overrides update live.

### Block bootstrap

Sample **blocks of consecutive whole rows** from the monthly dataset with replacement. Whole rows keep the real cross-asset dependence and the joint draw of inflation and risk-free; blocks keep short-term serial dependence (some volatility clustering and drawdown duration), which a plain i.i.d. bootstrap destroys. Blocks are circular and of fixed length; the length is a setting, default 12 months.

### Parametric multivariate Student-t

Joint log returns $\boldsymbol\ell_t = \boldsymbol\mu + L\mathbf z_t / \sqrt{\chi^2_\nu/\nu}$, with $\mathbf z_t \sim N(0, I)$ and $LL^\top = S$; simple returns are $e^{\ell}-1$, so the −100% floor holds by construction. The single shared $\chi^2$ draw per month stretches every asset together, which gives joint crashes. Inflation and risk-free are extra dimensions of the same joint model.

Fit once, before the loop, on the **historical** statistics (overrides are applied afterwards, see above):

1. $\mu$ = sample mean of log returns.
2. $\Sigma$ = unbiased sample covariance of log returns; zero-variance assets are rejected.
3. $\nu$ by moment matching on pooled standardized residuals: excess kurtosis $\gamma_2$ gives $\nu = 4 + 6/\gamma_2$, clamped to $[5, 100]$ ($\nu = 100$ if $\gamma_2 \le 0$); a manual $\nu$ is accepted in the same range.
4. Scale $S = \Sigma\,(\nu-2)/\nu$, so the simulated covariance matches the measured one.
5. Repair $S$ in correlation space with Higham's nearest-correlation algorithm (Dykstra correction) and record whether it moved; then Cholesky. A matrix that is still not positive definite is an error, never silently regularised.

Draw order per month is part of the contract: $D$ standard normals (Box-Muller, one normal per call), then one $\chi^2_\nu = 2\,\mathrm{Gamma}(\nu/2)$ (Marsaglia-Tsang), then the returns.

### Randomness

xoshiro128** seeded through a SplitMix-style expansion, never `Math.random`. Integer draws use rejection sampling to avoid modulo bias. Fixed reference vectors in the tests. The seed is part of the page URL and of the result.

## Inputs

The inputs live in the sidebar (see [Page and UI](#page-and-ui)).

### Portfolio construction

Replaces the previous ticker search box. One row per held ticker, from the same valuation as the `/networth` `Current` column (quantity above zero, aggregated across accounts):

- name (`DISPLAY_NAME`, then `FULL_NAME`), ticker, current value and current weight; a small **proxy** tag marks tickers whose history was backfilled (the splice date is in Model details);
- a **weight** override (%). When any weight is overridden the weights of all tickers must total 100% (cash excluded), and the form shows the running total; a *reset* control restores the valuation weights;
- two **advanced** overrides, **expected return** (% per year, geometric, net of TER) and **volatility** (% per year). The historical estimates are the greyed placeholders of these fields; a blank field uses them;
- a read-only **cash** row (balance) and a checkbox per manual (`value`) asset to add it as a constant amount.

Only held tickers are listed, and only tickers already in `data/market-data` can be simulated, because the app makes no runtime market-data requests. There is no benchmark comparison.

### Cash flows

- A mode switch: **portfolio only** or **with cash flows**.
- A year-by-year table with **yearly income** and **yearly spending** in `CURRENCY_1` and a computed net column. Rows are relative years from today, labelled "Year 1 · to Oct 2027". Savings are income minus spending.
- Helpers: paste from a spreadsheet; fill from a year with a start value and annual growth %; **fill from the last 12 months** of `cashflow` (income and expenses, contributions excluded, converted to `CURRENCY_1`).
- All amounts are **nominal** and are not indexed to simulated inflation; income is net of income tax (take-home). The user enters growing amounts year by year if wanted.
- **Blank years rule:** the simulation uses the **longest consecutive run of years starting at year 1 in which both income and spending are non-empty**. The table shades the rows that count and greys out the rest. Flows after that run are zero and the horizon is unchanged; the page shows a notice.
- The table follows the horizon; shortening the horizon hides the extra rows but keeps what was typed.
- **One-off events:** a table with label, month (`YYYY-MM`), amount and type (purchase or inflow).
- **Constant value:** manual assets the user chooses to include are added to total wealth as a fixed nominal amount that is not simulated.
- In portfolio-only mode none of the above applies and the portfolio is only subject to returns, rebalancing, costs and tax.

### Other settings

Engine (bootstrap or parametric), horizon in years, simulated paths (with an "up to N paths" hint from the cap), rebalancing (none, every N months, tolerance band), the cash-buffer months, fixed and variable order cost, capital-gains tax, nominal or real display. Advanced: random seed, block length, $\nu$ (auto or manual), inflation and risk-free overrides.

Dropped from the previous implementation: weekly data frequency, base-currency selector, initial investment, DCA and value-averaging modes (replaced by yearly income and spending), margin leverage, Markov engine.

## Portfolio accounting

All accounting is **nominal**; inflation only deflates for display (price level $P_t = \exp(\sum \pi)$ per path).

Starting state: invested value is the sum of the current values of the held tickers, split by the starting weights (current weights, or the overrides). Applying overrides at t0 is instantaneous and free of cost and tax, because it is a "what if", not a trade plan.

Per month, in this order:

1. Apply the month's return to every holding; cash earns the risk-free rate.
2. Apply the month's cash flows at month end (a flow never earns the return of the month it arrives in): $1/12$ of the year's income and spending, plus any one-off event dated in that month.
3. Settle the net flow through the **cash buffer**:
   - a **deficit** is paid from cash down to zero, then by selling the portfolio pro rata (costs and tax apply);
   - a **surplus** first refills cash up to the buffer target (default: 6 months of that year's spending), and the rest is invested at the starting weights;
   - initial cash is never swept at t0; with no cash flows cash is untouched and only earns the risk-free rate;
   - if total wealth reaches zero the path is **ruined**.
4. Rebalance if the policy triggers (drift: never; band: any $|h_i/E - w_i|$ above the band; calendar: every 1, 3, 6 or 12 months).
5. Costs, cost basis, loss carry-forward and tax for every trade.
6. Record holdings, cash and equity; update streaming metrics.

### Costs

- **TER** is embedded in the ticker's own history and subtracted on synthetic segments (see above). An expected-return override means the return the investor actually earns, net of TER.
- **Transaction costs**: a fixed amount plus a proportional rate per trade, defaults in the advanced panel; they apply to rebalancing, surplus investment and forced sales.

### Tax

One capital-gains rate. Average cost basis per ticker; a sale disposes basis in proportion; realised gain = proceeds − sale cost − basis disposed. Losses carry forward within the path and offset later gains; there are no refunds. Tax is paid when the sale happens. The initial basis of existing holdings equals their current value (the workbook has no cost basis), so only gains after t0 are taxed.

## Outputs

Every metric is a distribution across paths. Quantiles use linear interpolation (Excel `PERCENTILE.INC`, NumPy default). The accounting returns every output twice, nominal and real, so the display toggle is instant.

- **Fan chart:** percentile bands of wealth over time (p10–p90, p25–p75 and the median). Bands are cross-sectional per month, so they do not describe any single path. A dashed **paid-in** line (starting wealth plus net contributions) is on by default; about 10 sample paths can be overlaid (off by default).
- **Horizon table:** percentiles of wealth at 1, 3, 5, 10, 20, 30 and 40 years (those within the horizon) and the full horizon, plus the **loss probability** and **ruin probability** at each of those horizons. Ruin needs withdrawals to be possible, so it arrives with the cash flows of phase 2.
- **Terminal-value distribution:** histogram at a horizon chosen from the same fixed set (default: the full horizon), as market value or **after liquidation tax** (everything sold at that horizon). Marks at p10, p50, p90 and the starting wealth.
- **Risk metrics table:** median terminal wealth and p10–p90; loss probability (terminal wealth below starting wealth plus net contributions); ruin probability (total wealth reaches zero); median max drawdown (worst peak-to-trough fall of the contribution-neutral index per path); VaR and CVaR of terminal wealth change at 95% and 99%.
- Nominal by default; a toggle shows real values (nominal / path price level).

Failed paths (non-finite or infeasible accounting) are recorded with their code and excluded from quantiles; they are never treated as zero.

## Page and UI

Visual conventions follow the existing dashboards (square corners, black and zinc, thin borders, `SectionHeading`, shared Recharts props in `components/charts/chart-style.ts`, plain numbers with the currency named only in labels). `STYLE.MD` does not exist yet.

### Layout

- **Desktop:** a sticky **left sidebar** with the inputs (about 420 px, full height under the navbar, scrolling inside itself) and the results on the right.
- The sidebar has three tabs: **Portfolio**, **Cash flows**, **Settings**. Advanced options are collapsed sections inside the tabs. A bar pinned at the bottom of the sidebar holds **Run**, the run status, **Reset** and **Copy link**.
- **Mobile:** the sidebar stacks above the results as a collapsible panel and is not sticky; tables scroll horizontally.

### Live versus Run

| Needs a new **Run** (changes the generated paths) | Updates **live** (accounting only) |
| --- | --- |
| Engine, block length, $\nu$, seed, number of paths, horizon | Mode, yearly income and spending, one-off events, cash-buffer months, starting weights, return and volatility overrides, inflation and risk-free overrides, rebalancing, costs, capital-gains tax, manual constants, nominal/real, log scale, histogram horizon, table and chart toggles |

After a Run, changing a Run-only setting leaves the current results on screen with a "Settings changed, Run to apply" note; live inputs keep working on the stored paths until then. Live updates are debounced (about 150 ms) and a stale calculation is cancelled when a newer one starts.

### States

- **Empty state** (first load, and any link): the right pane shows the starting portfolio (starting wealth, allocation) and "Press Run". Nothing runs automatically.
- **Pending:** the Run button shows "Running N paths…", the previous results are dimmed; no progress bar. A live update dims the results only if it takes noticeably long.
- **Errors:** the same bordered error box as the other pages. Inputs are validated inline (weights not 100%, paths above the cap, horizon out of range), and Run is disabled while invalid.
- **Data quality:** the `/networth` warning box lists tickers without enough history, proxies in use, the common-history window and its end date, a repaired correlation matrix, failed paths, and the blank-years notice.

### Results (right pane)

1. Header: title and one line with starting wealth, invested, cash and the history window; a link to the methodology page (`/docs` until that page exists).
2. Toolbar: Nominal | Real, Linear | Log, sample paths.
3. Data-quality box.
4. Fan chart (X axis in **calendar years**).
5. Horizon table and risk metrics table.
6. Terminal distribution histogram.
7. **Model details** (collapsed): seed, $\nu$, block length, window, proxies and splice dates, algorithm versions.

### State in the URL

Every input is in the URL: the year table and events are encoded compactly, and the seed is included, so **Copy link** reproduces a scenario. The URL is updated with `history.replaceState`, not router navigation, so no server render is triggered while editing. A link opens with the inputs filled in and the empty state; the visitor presses Run. There is no other persistence. The URL carries what-if figures into browser history; this is accepted.

## Architecture

Follows the existing data flow, with the simulation in `lib/analytics` and the interactive part in the browser, as the net-worth benchmark already does:

```text
Google Sheets + data/market-data → lib/sheets + lib/market-data → loader (starting state + monthly dataset)
  → client: worker → lib/analytics/montecarlo (generate scenarios, then account) → charts
```

- **Server loader** (same shape as the other routes: takes `getMultiplier`, calls it first inside `try`, scales the workbook, then values it): returns serializable **inputs** only, no simulation: starting holdings valued in `CURRENCY_1`, cash, manual assets, ticker names, proxy flags and splice dates, the monthly dataset (returns, inflation, risk-free per month for the held tickers), their historical statistics, and the "last 12 months" income and spending. The page passes `resolveMultiplier`.
- **Two layers** in pure `lib/analytics/montecarlo`:
  1. `generateScenarios(dataset, engine, seed, paths, horizon)` → a stored `Float32Array` of simple returns, inflation and risk-free per path and month. Runs on **Run**.
  2. `account(scenarios, portfolio, cashFlows, options)` → the report (bands, horizon table, risk metrics, histograms; nominal and real). Runs on every live change, over the stored scenarios; overrides are applied here as the affine map above.
- **Worker:** a thin shell around those two functions in a Web Worker, so a Run or a live update never freezes the page. It keeps the stored scenarios between messages; each message carries a run id so stale results are ignored; a new Run cancels the previous one by terminating the worker.
- **Caps:** default 5,000 paths, maximum 20,000, horizon 1–40 years, and a stored-scenario size cap of paths × months × (tickers + 2) ≤ 40 million values (about 160 MB as Float32). The paths field shows the resulting "up to N paths" hint, as in the previous screen.
- **Latency target:** a live update at the defaults finishes in a few hundred milliseconds; at the caps it may take about a second.
- The page and components render only; no component fetches data. `lib/analytics` stays pure: no I/O, no environment, no cookies.

### Demo mode

The multiplier scales, in the loader and before anything is sent to the browser, every amount that comes from the workbook: quantities, cash and manual values (and the "last 12 months" income and spending), so a prefilled scenario stays consistent. The browser only ever receives scaled values. Amounts typed by the visitor (income, spending, one-offs, overrides) are the visitor's own what-if numbers and are not scaled. Percentages, returns, dates and tickers are not scaled; the historical market returns in the dataset are public data. Known limit unchanged: ratios stay real.

## Tests

`tests/montecarlo-*.test.ts`, synthetic data only, no environment variables:

- seeded PRNG reference vectors, rejection sampling, reproducibility from the seed;
- bootstrap draws whole consecutive rows; block wrap-around;
- Student-t: scale conversion, Higham repair of an indefinite matrix, simulated covariance close to the fitted one;
- overrides: mean and volatility map as specified, correlations unchanged; **applying them after generation equals generating with them at the same seed**, for both engines;
- hand-calculated accounting: one-asset compounding, end-of-month flows, rebalancing, average basis, loss carry-forward, costs, cash buffer, deficit sales;
- invariants: value conservation with zero costs and tax, non-negative holdings, basis conservation;
- accounting over stored scenarios is deterministic and independent of what was computed before;
- quantiles, VaR/CVaR, drawdown; the blank-years rule; the proxy splice and TER handling.

The worker is a thin shell and is not tested beyond a smoke test; the two layers are tested directly.

## Phases

1. **Data and engines:** longer history, proxy backfill (`metadata` column `PROXY`), FRED series, monthly dataset; both engines; scenario generation and accounting as two layers; worker; sidebar shell with Portfolio and Settings tabs; portfolio-only simulation with overrides; fan chart, horizon table, histogram.
2. **Cash flows and frictions:** Cash flows tab (year table, helpers, events), cash buffer, rebalancing policies, costs, capital-gains tax, all live.
3. **Risk metrics and polish:** ruin, loss, drawdown, VaR/CVaR, real toggle, model details, URL state, validation.
4. **Pinned baseline:** a **Pin** button keeps the current result as a faded overlay on the fan chart (median and p10–p90) and adds delta columns to the risk metrics table, so the effect of an edit is visible. The pinned result is a small copy of the summary (bands and metrics), not the paths, and is cleared by a new Run.
5. **Later:** stress scenarios, withdrawal policies and retirement phases.

## Open questions

None.
