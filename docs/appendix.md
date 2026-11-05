# Appendix

Back to the [README](../README.md).

## A. Workbook reference

The full rules and example rows for the six tabs are in [docs/workbook.md](workbook.md). The overview of the tabs is in [step 2](../README.md#step-2-create-your-workbook).

## B. Demo mode and the seed

Anyone who is not allowed to see your real data sees demo values. Demo mode multiplies every money amount by one random factor between 0 and 10. The factor comes from a seed.

**Who sees what**

| Visitor | Result |
| --- | --- |
| Signed in, email on `ALLOWED_EMAILS` | Real values. The *Seed* box is hidden |
| Seed equals `LUCKY_SEED` | Real values |
| Anyone else, signed in or not | Demo values |
| The app cannot read the allowlist | Demo values |
| `DEMO_SALT` is missing and the visitor has no real access | The amount pages show an error. They never fall back to real values |

**The seed**

- The navbar has a *Seed* box. Type any text (up to 64 characters) and click *Apply*. An empty box means the default seed `1`.
- The seed is saved in a cookie that only the server can read, so it stays for every page and every reload.
- The same seed always gives the same factor. Different seeds give unrelated factors: `9` and `10` have nothing in common.

**The random number**

The factor is made from the seed and `DEMO_SALT`. The code is in `src/lib/demo/multiplier.ts`:

```ts
const DEMO_MULTIPLIER_MAX = 10;

function demoMultiplier(seed: string, salt: string) {
  const digest = createHmac("sha256", salt).update(seed).digest(); // HMAC-SHA256(key = salt, message = seed)
  return (digest.readUIntBE(0, 6) / 2 ** 48) * DEMO_MULTIPLIER_MAX; // first 6 bytes -> number in [0, 1) -> [0, 10)
}
```

In words:

1. Compute HMAC-SHA256 with `DEMO_SALT` as the key and the seed as the message.
2. Read the first 6 bytes as a whole number and divide it by 2^48. The result is between 0 and 1.
3. Multiply by 10. The factor is between 0 and 10, and every value in that range is equally likely.

Without the salt, a visitor cannot work out the factor for a seed. Changing `DEMO_SALT` changes the factor of every seed.

**What is multiplied**

The app multiplies the data it reads from your sheet, before any calculation. It multiplies asset quantities, cash balances, manual values and transaction amounts. Prices and exchange rates are not changed. Because of this, every total, chart and table stays consistent with the others.

These are not changed: percentages and returns, counts, dates, names, categories, tickers and account names.

**Limits. Read this before you put the app on the internet.**

- Ratios stay real, so the shape of your portfolio and spending stays visible.
- A script can try many seeds. The largest result it sees gets close to 10 times the real value. So someone can estimate your real amounts.
- `LUCKY_SEED` can be guessed if it is short. There is no limit on attempts.
- Names, tickers, account names, categories and dates are not hidden.
- Treat demo mode as casual hiding, not as protection. Do not publish data you cannot afford to leak.

More detail is in [docs/how-it-works.md](how-it-works.md#demo-mode).

## C. Troubleshooting

Every message and its fix is in [docs/troubleshooting.md](troubleshooting.md). The three most common problems:

- **`npm run dev` stops right away.** `npm run test:sheets` found a problem in the workbook. Read the list and fix the sheet.
- **The amounts look random.** You see demo values. See [step 7](../README.md#step-7-run-the-app).
- **A change has no effect.** Changes to `.env.local` need a restart of the server. `LUCKY_SEED` and `ALLOWED_EMAILS` are cached for a few minutes.

## D. Code layout and commands

```text
Google Sheets + data/market-data → lib/sheets + lib/market-data → lib/analytics → app route → components
```

| Path | What it holds |
| --- | --- |
| `src/lib/sheets` | The only code that talks to Google Sheets. Parsing and checks |
| `src/lib/market-data` | Reads the local price files and converts values |
| `src/lib/analytics` | Pure calculations. No I/O, no React |
| `src/lib/auth`, `src/lib/demo` | Sign-in, access rules and the demo multiplier |
| `src/app` | Pages and loaders (server components) |
| `src/components` | Tables and Recharts charts |
| `scripts` | `download-market-data.ts` and `test-google-sheets.ts` |
| `tests` | Tests with fake data |
| `data/market-data` | Downloaded price files |
| `docs` | [How it works](how-it-works.md): technical notes |

| Command | What it does |
| --- | --- |
| `npm run dev` | Checks the workbook, then starts the app on port 3000 |
| `npm run build`, `npm start` | Production build and server |
| `npm test` | Test suite. No setup needed |
| `npm run test:sheets` | Checks the live workbook |
| `npm run download:market-data` | Refreshes the price files |
| `npm run lint` | ESLint |

More: [docs/how-it-works.md](how-it-works.md) (technical notes) and [CLAUDE.md](../CLAUDE.md) (rules for the code and the workbook).

## E. Setup details

Extra detail for each [setup step](../README.md#setup).

### Step 1. Get the code and run the tests

`npm test` needs no setup. It uses fake data only. It should pass. One test checks that a calculation runs in under 200 ms, so it can fail on a slow or busy machine. Run it again if that happens.

### Step 2. Create your workbook

- Dates must be real dates in the sheet, not text.
- The rules and example rows for every tab are in [docs/workbook.md](workbook.md) (see also [A](#a-workbook-reference)).

### Step 3. Create a Google service account

Keep the JSON file outside the repository. Never commit it or paste it anywhere.

### Step 4. Create `.env.local`

- `.env.local` is ignored by git. Never commit it, and never print or share these values.
- `GOOGLE_PRIVATE_KEY` goes on one line, in double quotes, with the `\n` characters kept.
- `DEMO_SALT` is another random string, made the same way as `AUTH_SECRET`. It is used for the demo-mode random number. Do not change it later without a reason: every seed then gives a new result (see [B](#b-demo-mode-and-the-seed)).

### Step 5. Check the workbook

`npm run test:sheets` reads all six tabs and checks them against the rules in [docs/workbook.md](workbook.md). It lists every problem with its row number. It also runs the app's own parsers, so if this passes, the pages can read your data. Fix the sheet until it passes.

### Step 6. Download market data

`npm run download:market-data` downloads maximum-history daily prices, exchange rates and proxy symbols from Yahoo Finance, plus the FRED rate and CPI series used by Monte Carlo. It saves compact one-row-per-line Yahoo files in `data/market-data` and macro files in `data/market-data/macro`. It downloads:

- Every `ASSET` in `assets` with the datatype `quantity`. The `ASSET` value must be a Yahoo Finance symbol, for example `VT` or `IWDA.AS`.
- `ACWI` and `BND`, for the benchmark.
- An exchange-rate pair (for example `EURCHF=X`) from every currency in your workbook to every report currency.
- Every configured `metadata.PROXY` symbol, with the supported-currency FX pairs needed to combine proxy returns.
- The FRED rate and CPI pair for each supported reporting currency.

The history starts at the earliest date available from the provider. The script waits half a second between requests, so it can take several minutes. If Yahoo or FRED refuses a request, run it again.

### Step 7. Run the app

Open `/` for cashflow and `/networth` for net worth. The amounts look wrong because you see demo values (see [B](#b-demo-mode-and-the-seed)). To see your real values, pick one of two ways:

- **Option A: lucky seed (quick, no Google sign-in).**
  1. In the `constants` tab, add a row. Column A: `LUCKY_SEED`. Column B: a long phrase, for example four random words.
  2. In the app, type the same phrase in the *Seed* box in the navbar and click *Apply*. It is case-sensitive.
  3. The warning icon disappears and you see real values.

  The sheet is cached for a few minutes, so wait a little if it does not work at once.
- **Option B: Google sign-in.** See step 8.

### Step 8. Google sign-in

Extra detail for the numbered steps in the [README](../README.md#step-8-optional-google-sign-in):

- **Branding (2).** Fill in the app name (for example `Net Worth`), your user support email and your developer contact email. Links to a home page, privacy policy and terms are optional while the app is in Testing.
- **Data access (4).** Never add Sheets or Drive scopes. The service account reads the sheet, not your login.
- **Redirect URI (5).** There must be no trailing slash. If you run on another port, add that port too.
- **`ALLOWED_EMAILS` (8).** Put your emails in **one cell**, separated by commas, for example `you@gmail.com, partner@gmail.com`. Never use one row per email: rows with the same key overwrite each other.
- **Signing in (9).** Click the red `?` in the navbar and sign in. The border turns green. If your email is on the list, you see real values and the *Seed* box disappears.

Good to know:

- Only verified Google emails can sign in. The allowlist is checked on the server for every request.
- If the app cannot read the allowlist, nobody gets real data.
- Google may show "Google hasn't verified this app". Click *Advanced*, then *Continue*.
- The allowlist is cached for a few minutes. A removed email loses access within that time.
- Anyone who can edit your workbook can change the allowlist. Share the workbook read-only with everyone but yourself.
- If you publish the OAuth app, any Google account can sign in, but only allowlisted emails see real data. Write real text in `/privacy` and `/ts` first.

### Step 9. Deploy

You do not need to deploy. Running the app on your own computer is the safest option. If you want a public address:

1. Read the limits in [B](#b-demo-mode-and-the-seed). The demo mode hides amounts only. Names, dates, tickers and ratios stay visible.
2. Use a host that runs Next.js, for example Vercel. Set the same variables from `.env.local` in the host settings. `.env.local` is not deployed.
3. Also set `AUTH_TRUST_HOST=true`. It is needed on a proxied host and for `npm start`.
4. In the OAuth client, add the redirect URI `https://<your-domain>/api/auth/callback/google`.
5. `data/market-data` is in git, so the host already has the price files. Run `npm run download:market-data`, commit the changed files and push.
6. Fill in `ALLOWED_EMAILS` and, if you want it, a long `LUCKY_SEED` in `constants`.

To test a production build on your computer: `npm run build && npm start`.

## F. Updating your data

Do this after each change to your data.

1. **Update the sheet by hand.**
   - Add new transactions to `cashflow`.
   - Add a new date column to `assets` with the units, balances and values for the period.
   - Add new tickers to `metadata`.
   - Keep `cashflow.CATEGORY` equal to a value in `categories.CATEGORY`, or leave it blank if you are not sure.
2. **Check it**: `npm run test:sheets`. `npm run dev` does this for you when it starts.
3. **Refresh market data**: `npm run download:market-data`. Run it after you add a ticker or a currency, after you add a new period, and from time to time.
4. **Start the app**: `npm run dev`.

Good things to know:

- You can add empty date columns for future periods in `assets`, they are ignored until an asset has a value in them, periods without data show `—`.
- The app reads the sheet on every page load, so a data change shows after a reload. `LUCKY_SEED`, `ALLOWED_EMAILS`, `APP_NAME` and `APP_DESCRIPTION` are cached for a few minutes.
- The app never requests prices while rendering. "Current" values use the last downloaded close, so run `npm run download:market-data` regularly (step 3 above).
