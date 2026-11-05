# Workbook reference

The workbook is a Google Sheet with six tabs. For the setup steps, see [step 2 of the README](../README.md#step-2-create-your-workbook). Use this page to build the tabs by hand, or to fix the errors that `npm run test:sheets` reports.

## Rules for every tab


- Tab names are lowercase and fixed.
- The first row is the header row, except in `constants`.
- Dates are real Google Sheets dates.
- Currencies are three-letter uppercase codes, for example `EUR`.
- Headers are not case-sensitive.

## `cashflow`

One row is one transaction.

| DATE | TYPE | NAME | AMOUNT | CURRENCY | CATEGORY | SUBCATEGORY | NOTES |
| --- | --- | --- | ---: | --- | --- | --- | --- |
| 2026-01-05 | income | Salary January | 5000 | EUR | salary | | |
| 2026-01-08 | expense | Supermarket | 82.40 | EUR | Grocery | | |
| 2026-01-31 | contribution | Monthly investing | 1000 | EUR | | | |
| 2026-03-15 | income | Sold shares | 2000 | EUR | withdrawal | | |

- `TYPE` is `income`, `expense` or `contribution`, in lowercase.
- `AMOUNT` is never negative. The type gives the direction.
- `DATE`, `TYPE`, `NAME`, `AMOUNT` and `CURRENCY` are required. `CATEGORY`, `SUBCATEGORY` and `NOTES` are optional.
- A non-empty `CATEGORY` must match a value in `categories.CATEGORY` exactly, with the same capital letters. If you are not sure, leave it blank. The row then counts as an unclassified expense.
- The seventh header may be `CITY`. It is an old name for `SUBCATEGORY`.
- A `contribution` is money moving into your invested portfolio. A withdrawal from the portfolio is an `income` row with the category `withdrawal`. `salary` is the income category used for the salary charts. Both need a row in `categories`.

## `assets`

One row is one asset or account. After the first four columns, each column is a reporting period.

| ASSET | DATATYPE | CURRENCY | ACCOUNT | 2026-01-31 | 2026-02-28 |
| --- | --- | --- | --- | ---: | ---: |
| VT | quantity | USD | Broker | 24 | 26 |
| Cash | cash | EUR | My Bank | 20000 | 21000 |
| Car | value | EUR | - | 8000 | 7900 |

- Period dates are in ascending order. You need at least one.
- `DATATYPE` is `quantity`, `cash` or `value`, in lowercase:
  - `quantity`: units held. The app multiplies them by the price on that date. `ASSET` must be a Yahoo Finance symbol.
  - `cash`: a cash balance.
  - `value`: a value you set yourself, for things without a ticker.
- A blank cell means "no value for this period".
- Every value is converted with the exchange rate of its date.

## `metadata`

One row for each `quantity` asset.

| TICKER | DISPLAY_NAME | FULL_NAME | CURRENCY | TER | ISSUER | PROXY |
| --- | --- | --- | --- | --- | --- | --- |
| VT | World stocks | Vanguard Total World Stock ETF | USD | 0.06% | Vanguard | |
| NTSG.PA | | WisdomTree Global Efficient Core | USD | 0.25% | WisdomTree | URTH*0.9+IEF*0.6 |

- `TICKER` equals the `ASSET` of the `quantity` row.
- Every column except `DISPLAY_NAME` and `PROXY` is required. `PROXY` is an optional seventh column.
- `CURRENCY` is the fund's own currency. The currency of its price is the `CURRENCY` of its row in `assets`.
- `TER` is the yearly cost as a fraction: 0.06% is stored as `0.0006`. Format the cell as a percentage and type `0.06%`, or type `0.0006`. A plain `0.06` would mean 6% a year, so `npm run test:sheets` rejects any value above `0.05`.
- `PROXY` gives a young fund a history for the Monte Carlo page. Leave it blank when the fund has been trading long enough. Otherwise write one or more Yahoo Finance symbols joined by `+`, each with an optional weight after `*` (a missing weight is 1):
  - `URTH*2` is twice the return of `URTH`, for a 2x leveraged fund;
  - `URTH*0.9+IEF*0.6` is 90% equities plus 60% bonds, for a fund that holds both;
  - `AQMIX` is the symbol alone.
- Write the weights with a dot as the decimal separator, no `=` at the start, and at most 10 per symbol. A symbol appears once, and a fund is never its own proxy. Weights above 1 in total are financed at the cash rate, and the rest of a total below 1 stays in cash. See [Monte Carlo](montecarlo.md) for how the history is rebuilt.
- The net-worth table shows `DISPLAY_NAME`, or `FULL_NAME` if it is blank.
- You need at least one row.

## `categories`

| CATEGORY | PARENT_CATEGORY | IS_ESSENTIAL | IS_RECURRING |
| --- | --- | --- | --- |
| salary | Income | | TRUE |
| withdrawal | Income | | |
| Grocery | Food | TRUE | TRUE |
| Restaurants | Food | | |
| Rent | Housing | TRUE | TRUE |
| tax | Taxes | TRUE | |

- `CATEGORY` values are unique. `PARENT_CATEGORY` is required.
- `IS_ESSENTIAL` and `IS_RECURRING` are `TRUE` or blank.
- Expenses are reported by `CATEGORY`, grouped by `PARENT_CATEGORY`.

## `saa`

Target allocation by period. No page uses it yet, but `npm run test:sheets` checks it, so keep a header row and at least one row.

| ASSET_CLASS | INSTRUMENT | 2026-01-01 |
| --- | --- | ---: |
| equities | VT | 0.9 |
| bonds | BND | 0.1 |

- Date columns are in ascending order. Targets are not negative and do not need to add up to 100%.

## `constants`

No header row. Column A is the key. Column B is the value. Keys are unique and not case-sensitive. Do not leave a value blank.

| Key | Value |
| --- | --- |
| `CURRENCY_1` | Main report currency. Required. Use `EUR`, `CHF` or `USD` |
| `CURRENCY_2`, `CURRENCY_3` | Optional second and third report currency. If missing or invalid, they are filled in order from `EUR`, `CHF`, `USD` |
| `APP_NAME` | Site name and prefix of every page title. Default `Net Worth`. It is public in the page HTML, so keep it generic |
| `APP_DESCRIPTION` | Page description. Default `Private personal-wealth dashboard`. Also public |
| `ALLOWED_EMAILS` | Google accounts that see real values. One cell, comma-separated. [Step 8](../README.md#step-8-optional-google-sign-in) |
| `LUCKY_SEED` | A phrase that unlocks real values for anyone who types it in the *Seed* box. Optional. [Step 7](../README.md#step-7-run-the-app) |
| `LOCALE` | Not used by the app yet |
