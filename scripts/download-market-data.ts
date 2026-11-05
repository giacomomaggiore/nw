// Refreshes the local price store in data/market-data from Yahoo Finance. Run with `npm run download:market-data`.
// This is the only code that calls the market-data provider for the stored files.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { addDays, today } from "@/lib/dates";
import { downloadFredObservations, fredFileContents } from "@/lib/market-data/fred";
import { marketDataDirectory, priceFilePath } from "@/lib/market-data/prices";
import { MACRO_SERIES, requiredMarketSymbols } from "@/lib/market-data/symbols";
import { downloadYahooPrices } from "@/lib/market-data/yahoo";
import { loadCashflowWorkbook } from "@/lib/sheets/cashflow";
import { loadNetWorthWorkbook } from "@/lib/sheets/net-worth";

loadEnvConfig(process.cwd());

async function main() {
  const [netWorth, cashflow] = await Promise.all([loadNetWorthWorkbook(), loadCashflowWorkbook()]);
  const symbols = requiredMarketSymbols(netWorth, cashflow);
  const end = addDays(today(), 1);

  await mkdir(marketDataDirectory(), { recursive: true });
  for (const symbol of symbols) {
    const prices = await downloadYahooPrices(symbol, null, end);
    await writeFile(priceFilePath(symbol), `${JSON.stringify({ symbol, downloadedAt: new Date().toISOString(), prices })}\n`);
    // Stay polite to the provider.
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const macroDirectory = join(marketDataDirectory(), "macro");
  await mkdir(macroDirectory, { recursive: true });
  const currencies = new Set([...netWorth.currencies, ...cashflow.reportingCurrencies]);
  const macroSeries = [...currencies].flatMap((currency) => {
    const series = MACRO_SERIES[currency as keyof typeof MACRO_SERIES];
    return series ? [series.rate, series.cpi] : [];
  });
  for (const series of [...new Set(macroSeries)]) {
    await writeFile(join(macroDirectory, `${series}.json`), fredFileContents(series, await downloadFredObservations(series)));
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.info(`Updated ${symbols.length} Yahoo and ${new Set(macroSeries).size} FRED market-data files.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Market-data download failed.");
  process.exitCode = 1;
});
