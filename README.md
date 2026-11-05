# Private cashflow and net-worth breakdown

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js 20.9+](https://img.shields.io/badge/node-%3E%3D20.9-339933.svg)](https://nodejs.org)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org)
[![Data: Google Sheets](https://img.shields.io/badge/data-Google%20Sheets-34a853.svg)](#step-2-create-your-workbook)

A private dashboard for your net worth and your cashflow. 
<br/>Your data lives and stays in your Google Sheet. The app reads the sheet, adds prices and exchange rates saved on your computer, and shows tables and charts.

Developed by <a href= "https://giacomomaggiore.com" target="_blank">Giacomo Maggiore</a>. Open source, [MIT license](LICENSE).

![Net worth dashboard: trend, asset table and benchmark comparison](docs/images/networth.png)

![Cashflow dashboard: monthly trend and summary table](docs/images/cashflow.png)

## Intro

You manually insert your data into  Google Sheet and the app only reads it (no internal/external database and the app stores nothing about your finances).
<br/>Two main views are ready:
  - **Cashflow** (`/`): income, expenses, savings and savings rate by month
  - **Net worth** (`/networth`): net worth over time, a table of every asset, a benchmark comparison and monthly rankings.

Note that you are the only one seeing real amounts. Everyone else who opens the app sees randomized amounts. See [Appendix B](docs/appendix.md#b-demo-mode-and-the-seed).

(WIP: `/saa`, `/montecarlo` and `/docs` views)

---

The app is built with Next.js 16, React 19, TypeScript, Tailwind CSS 4, Recharts, `googleapis` (Google Sheets), Auth.js (`next-auth` 5, beta). Prices and exchange rates come from Yahoo Finance; the downloader also stores maximum-history proxy data and FRED macro series for Monte Carlo.

## Project philosophy

Google Sheet is the only source of truth: you enter there each fact once, in a plain format you can read anywhere, and the app never changes your sheet.<br/>
All calculations are plain deterministic functions: the same input always gives the same result and the pages only draw the results.... so, yes: _there's no Gpt, Gemini or similar: you have to put the work and expect boring metrics and summaries, no fluff AI insights._ 
<br/>Prices and exchange rates are files on your computer and can be refreshed with one command.

### What you track

The idea is that in `assets` you write what you hold at the end of each period, usually the end of the month _(for a ticker you write the number of units, for cash you write the balance, for anything else you write a value, then the app turns units into money with the price of that date)._

For cashflow, only money that comes in/out of your portfolio is recorded with the following logic:
  - salary and other income: `income` _(optional subcategory allowed)_
  - spending: `expense` _(optional subcategories allowed)_
  - money you move into your invested portfolio: `contribution`.
  - money you take out of it: `income` with the category `withdrawal`.

_(Note that every amount has a corresponding currency that uses the exchange rate of its own date)_

Do not record purchases, sales, dividends fees or taxes of the investment/broker platform, since contributions should not be considered as spending: they are left out of income, spending, savings  and category reports and they only count in performance comparison with the benchmark.

Furthermore, the app compares your financial instruments with a 60/40 portfolio _(ACWI and BND)_ and with 100% stocks _(ACWI)_ by replicating contributions and withdrawals and assuming reinvested dividends. Cash and manually valued assets are not included. 


## Setup

Steps 1 to 7 give you a working app on your computer _(eventually: you can host it on Vercel at almost-zero extra-cost)_. Steps 8, 9 are optional.

Note that NO paid service is needed. If a step fails, look up the message in [docs/troubleshooting.md](docs/troubleshooting.md).

### Step 1. Get the code

You need Node.js 20.9 or newer and a Google account.

```bash
git clone https://github.com/giacomomaggiore/nw.git
cd nw
npm install
npm test
```

_`npm test` should pass with no setup. More in [Appendix E](docs/appendix.md#step-1-get-the-code-and-run-the-tests)._

### Step 2. Create your workbook

The source of truth is a Google Sheet with six tabs.

1. <a href ="https://docs.google.com/spreadsheets/d/1Yd84qpGreXoR8UZNV3eCdF0E2qKZmSZTlyw0KR6ic50/edit?usp=sharing" target="_blank"> Open the Google Sheet template here</a> then click:
  *File → Make a copy*.
   If you do not have the template, create a new sheet and build the tabs by hand from [docs/workbook.md](docs/workbook.md).
2. Keep the tab names exactly: `cashflow`, `assets`, `categories`, `metadata`, `saa`, `constants`. 
3. Keep the header rows. Replace the example rows with your own data.
4. In `constants`, set at least `CURRENCY_1` to `EUR`, `CHF` or `USD`.

Every tab needs its header row and at least one data row (the `constants` tab has no header row).

| Tab | What it holds | Columns |
| --- | --- | --- |
| `cashflow` | one row per transaction | `DATE`, `TYPE`, `NAME`, `AMOUNT`, `CURRENCY`, `CATEGORY`, `SUBCATEGORY`, `NOTES` |
| `assets` | one row per asset, one column per period | `ASSET`, `DATATYPE`, `CURRENCY`, `ACCOUNT`, then one date per period |
| `categories` | expense, income categories | `CATEGORY`, `PARENT_CATEGORY`, `IS_ESSENTIAL`, `IS_RECURRING` |
| `metadata` | name, fees of the tickers in `assets`, optional history proxy | `TICKER`, `DISPLAY_NAME`, `FULL_NAME`, `CURRENCY`, `TER`, `ISSUER`, optional `PROXY` |
| `saa` | target allocation by period _(not implemented yet)_ | `ASSET_CLASS`, `INSTRUMENT`, then one date per period |
| `constants` | settings: key in column A, value in column B | _no header row_ |

Full rules and example rows are in [docs/workbook.md](docs/workbook.md). Dates must be real dates, not text ([Appendix E](docs/appendix.md#step-2-create-your-workbook)).

### Step 3. Create a Google service account

The app reads your sheet with a service account. This is like a _"robot account"_ that only has the access you give it.

1. Open [console.cloud.google.com](https://console.cloud.google.com). Pick a project, or create one with *New project*.
2. Go to *APIs & Services → Library*. Search for *Google Sheets API* and click *Enable*.
3. Go to *IAM & Admin → Service Accounts → Create service account*. Give it any name. You do not need to give it a role.
4. Open the new account. Go to *Keys → Add key → Create new key → JSON → Create*. A JSON file downloads.
5. Open the JSON file. You need two values: `client_email` and `private_key`.
6. Open your Google Sheet. Click *Share*. Paste the `client_email` and give it **Viewer** access.
7. Keep the JSON file outside the repository ([Appendix E](docs/appendix.md#step-3-create-a-google-service-account)).

### Step 4. Create `.env.local`

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in these five values:

| Variable | Value |
| --- | --- |
| `GOOGLE_SHEET_ID` | long id in your sheet URL: `docs.google.com/spreadsheets/d/<ID>/edit` |
| `GOOGLE_CLIENT_EMAIL` | `client_email` from the JSON file |
| `GOOGLE_PRIVATE_KEY` | `private_key` from the JSON file, in double quotes, with the `\n` characters kept: `"-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"` |
| `AUTH_SECRET` | random string. Create one with `openssl rand -base64 32` |
| `DEMO_SALT` | another random string, made the same way or just invented by yourself. Details in ([Appendix B](docs/appendix.md#b-demo-mode-and-the-seed)) |

`.env.local` is ignored by git. More in [Appendix E](docs/appendix.md#step-4-create-envlocal).

### Step 5. Check the workbook

```bash
npm run test:sheets
```

This checks all six tabs and lists every problem with its row number. See [Appendix E](docs/appendix.md#step-5-check-the-workbook).

### Step 6. Download market data

```bash
npm run download:market-data
```

This downloads maximum-history daily prices, exchange rates and proxy symbols from Yahoo Finance, plus the FRED rate and CPI series, and saves them in `data/market-data`. What exactly is downloaded is in [Appendix E](docs/appendix.md#step-6-download-market-data).

_Note that the file names are your tickers, so if you publish your own copy of this repository, anyone can see which instruments you track._

### Step 7. Run the app

```bash
npm run dev
```

This runs `npm run test:sheets` first and then starts the app at [http://localhost:3000](http://localhost:3000).

Note that all amounts will look wrong... _but do not panic:_ this is expected. <br/>Right now you are a visitor without access, so the app shows demo values: every amount is multiplied by a pseudo-random factor.

To see your real values, pick one of two ways:

- **Lucky seed (quick, no Google sign-in).**: in the `constants` tab, add a row, add a new constant with key `LUCKY_SEED` and value your lucky string _(recently i used "cinnamonroll")_. <br/>In the app, if you then type the same string in the *Seed* box in the navbar and click *Apply*, the warning icon disappears and you see real values.

  _(The sheet may be cached for a few minutes, so wait a little if it does not work at once)_

- **Google sign-in.** See following step _(a bit longer...)_

More detail on both: [Appendix E](docs/appendix.md#step-7-run-the-app).

### Step 8. Optional: Google sign-in

With this you sign in with your Google account so the app shows real values to the emails you allow. _You do not need it if you use the lucky seed._

Google sign-in uses an OAuth client: it is a different credential from the service account in step 3, but it can live in the same Cloud project.

1. In the Cloud Console, open *APIs & Services → OAuth consent screen*. It may be called *Google Auth Platform*. Click *Get started* if asked.
2. In *Branding*: fill in the app name, user support email and developer contact email.
3. In *Audience* choose **External** and leave the publishing status on **Testing** (in testing, only the accounts listed under *Test users* can sign in, so add your own Gmail address there).
4. In *Data access* keep the default scopes: `openid`, `userinfo.email` and `userinfo.profile`.
5. Go to *Clients → Create client*. Choose **Web application**. Leave *Authorized JavaScript origins* empty. Under *Authorized redirect URIs* add exactly:
   `http://localhost:3000/api/auth/callback/google` _(or the domain when you want to host the page if you plan to do so)_
6. Click *Create*. Copy the **Client ID** and the **Client secret** since Google may not show the secret again.
7. In `.env.local`, remove the `#` in front of `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` and paste the two values.
8. In the `constants` tab, add a new constant with key `ALLOWED_EMAILS` and as value your emails **in one cell** separated by commas.
9. Restart `npm run dev` and log in by clicking the red `?`.

Extra detail for these steps and a list of good things to know (verified emails, caching, publishing the app) are in [Appendix E](docs/appendix.md#step-8-google-sign-in).

### Step 9. Optional: deploy

You do not need to deploy. Running the app on your own computer is the safest option, but... _If you want a public address:_ follow the steps in [Appendix E](docs/appendix.md#step-9-deploy), after reading the limits in [Appendix B](docs/appendix.md#b-demo-mode-and-the-seed).

## Usage

Remember that there's no smart AI that reads your bank accounts and fills the data. _You have to update the sheet by hand!_

For example, you can start with:
   - Add new transactions to `cashflow`.
   - Add a new date column to `assets` with the units, balances and values for the period.
   - Add new tickers to `metadata`.

Also remember to refresh market data when you update your assets with `npm run download:market-data`

Then, test everything with `npm run test:sheets` and start with `npm run dev` does this for you when it starts.

You can then deep dive into your analytics... _but be mindful that 99% you are just spending time on money you have already spent!_

The full routine, with caching and market-data notes, is in [Appendix F](docs/appendix.md#f-updating-your-data).

## Contributing

Issues and pull requests are welcome, but please, _before doing so,_ read [CLAUDE.md](CLAUDE.md) first, it has the workbook and the code rules.

Then, before you open a pull request, run:

  ```bash
  npm run lint
  npx tsc --noEmit
  npm test
  ```

Add or update a test for every change to a parser, a calculation or the market-data code. Tests use fake data only.

---

## Appendix

The appendix is in [docs/appendix.md](docs/appendix.md):

- [A. Workbook reference](docs/appendix.md#a-workbook-reference): rules and example rows for the six tabs.
- [B. Demo mode and the seed](docs/appendix.md#b-demo-mode-and-the-seed): who sees real values, how the seed becomes a random factor (`HMAC-SHA256(DEMO_SALT, seed)`, scaled to a number between 0 and 10), and the limits.
- [C. Troubleshooting](docs/appendix.md#c-troubleshooting): the most common problems and where the full list is.
- [D. Code layout and commands](docs/appendix.md#d-code-layout-and-commands): folders, npm commands and the data flow.
- [E. Setup details](docs/appendix.md#e-setup-details): extra detail for each setup step, Google sign-in notes and deployment.
- [F. Updating your data](docs/appendix.md#f-updating-your-data): the routine after each data change, caching and refreshing market data.

## Disclaimer and license

This is a personal tracking tool. It is not financial advice. Numbers can be wrong, for example when a price is missing, so check the warnings before you rely on a result. Market data comes from an unofficial Yahoo Finance endpoint. Check the Yahoo terms for your use. The code that downloads it is in `scripts/download-market-data.ts` and `src/lib/market-data/yahoo.ts`, so you can replace the provider.

Released under the [MIT license](LICENSE). Developed by [Giacomo Maggiore](https://giacomomaggiore.com).
