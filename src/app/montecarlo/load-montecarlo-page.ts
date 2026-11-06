import { validateDataset } from "@/lib/analytics/montecarlo/dataset";
import type { Portfolio } from "@/lib/analytics/montecarlo/accounting";
import type { MonthlyDataset } from "@/lib/analytics/montecarlo/types";
import { scaleNetWorthWorkbook } from "@/lib/demo/scale";
import { loadMonthlyDataset } from "@/lib/market-data/montecarlo";
import { createMarketData } from "@/lib/market-data/prices";
import { valueNetWorth } from "@/lib/market-data/net-worth";
import { loadNetWorthWorkbook } from "@/lib/sheets/net-worth";
import type { NetWorthWorkbook } from "@/types/workbook";

export type MonteCarloInstrument = {
  ticker: string;
  name: string;
  value: number;
  expectedReturn: number;
  volatility: number;
  proxy: boolean;
};

export type MonteCarloInputs = {
  currency: string;
  dataset: MonthlyDataset;
  portfolio: Portfolio;
  instruments: MonteCarloInstrument[];
  historyStart: string;
  historyEnd: string;
};

export type MonteCarloPageData = { inputs: MonteCarloInputs; error: null } | { inputs: null; error: string };

export type MonteCarloPageSources = { netWorth: () => Promise<NetWorthWorkbook> };
export const defaultMonteCarloSources: MonteCarloPageSources = { netWorth: loadNetWorthWorkbook };

/**
 * Reads and scales the workbook, values current holdings in CURRENCY_1, then prepares serializable public return
 * history for the browser worker. No scenarios are generated on the server.
 */
export async function loadMonteCarloPage(
  sources: MonteCarloPageSources = defaultMonteCarloSources,
  getMultiplier: () => number | Promise<number> = () => 1,
): Promise<MonteCarloPageData> {
  try {
    const multiplier = await getMultiplier();
    const workbook = scaleNetWorthWorkbook(await sources.netWorth(), multiplier);
    const currency = workbook.currencies[0];
    const market = createMarketData();
    const valued = await valueNetWorth(market, workbook);
    const currentIndex = valued.periods.length - 1;
    const byTicker = new Map<string, MonteCarloInstrument>();
    let cash = 0;

    valued.assets.forEach((asset, index) => {
      const value = asset.convertedValues[0][currentIndex];
      if (value === null) return;
      if (asset.datatype === "quantity" && value > 0) {
        const source = workbook.assets[index];
        const existing = byTicker.get(asset.asset);
        if (existing) existing.value += value;
        else byTicker.set(asset.asset, {
          ticker: asset.asset,
          name: asset.instrumentName ?? asset.asset,
          value,
          expectedReturn: 0,
          volatility: 0,
          proxy: source.proxy.length > 0,
        });
      } else if (asset.datatype === "cash") {
        cash += value;
      }
    });

    const instruments = [...byTicker.values()];
    if (instruments.length === 0) throw new Error("Add a quantity asset with a current value before running Monte Carlo.");
    const assets = instruments.map(({ ticker }) => workbook.assets.find((asset) => asset.asset === ticker)!);
    const dataset = await loadMonthlyDataset(market, assets, currency);
    validateDataset(dataset);
    for (const instrument of instruments) {
      const tickerIndex = dataset.tickers.indexOf(instrument.ticker);
      const returns = tickerIndex < 0 ? [] : dataset.assetReturns[tickerIndex];
      if (returns.length > 0) {
        const mean = returns.reduce((sum, current) => sum + current, 0) / returns.length;
        const variance = returns.reduce((sum, current) => sum + (current - mean) ** 2, 0) / Math.max(1, returns.length - 1);
        instrument.expectedReturn = (1 + mean) ** 12 - 1;
        instrument.volatility = Math.sqrt(variance * 12);
      }
    }
    const historyStart = dataset.dates[0];
    const historyEnd = dataset.dates.at(-1)!;
    const portfolio: Portfolio = {
      values: dataset.tickers.map((ticker) => byTicker.get(ticker)?.value ?? 0),
      cash,
      constantValue: 0,
      weights: null,
    };
    return { inputs: { currency, dataset, portfolio, instruments, historyStart, historyEnd }, error: null };
  } catch (error) {
    return { inputs: null, error: error instanceof Error ? error.message : "The Monte Carlo data could not be loaded." };
  }
}
