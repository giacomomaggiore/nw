import { addDays, monthStart, today } from "@/lib/dates";
import type { MonthlyDataset } from "@/lib/analytics/montecarlo/types";
import type { AssetRow } from "@/types/workbook";
import { loadMacroSeries } from "./macro";
import type { MarketData } from "./prices";
import { MACRO_SERIES } from "./symbols";

type DailyPrice = { date: string; close: number };

function monthEndPrices(prices: DailyPrice[]) {
  const values = new Map<string, number>();
  for (const price of prices) values.set(monthStart(price.date), price.close);
  return values;
}

function monthlyReturns(prices: DailyPrice[]) {
  const monthly = monthEndPrices(prices);
  const months = [...monthly.keys()].sort();
  const returns = new Map<string, number>();
  for (let index = 1; index < months.length; index += 1) {
    const previous = monthly.get(months[index - 1])!;
    const current = monthly.get(months[index])!;
    if (previous > 0 && current > 0) returns.set(months[index], current / previous - 1);
  }
  return returns;
}

function latestRateOnOrBefore(rates: DailyPrice[], date: string) {
  let rate: number | null = null;
  for (const entry of rates) {
    if (entry.date > date) break;
    rate = entry.close;
  }
  return rate;
}

async function backfilledPrices(market: MarketData, asset: AssetRow) {
  const end = addDays(today(), 1);
  const actual = await market.adjustedHistory(asset.asset, "1900-01-01", end);
  if (asset.proxy.length === 0 || actual.length === 0) return actual;

  const proxyPrices = await Promise.all(asset.proxy.map(({ symbol }) => market.adjustedHistory(symbol, "1900-01-01", end)));
  const actualDates = new Set(actual.map(({ date }) => date));
  const byDate = proxyPrices.map((prices) => new Map(prices.map(({ date, close }) => [date, close])));
  const commonDates = [...byDate[0].keys()].filter((date) => byDate.every((column) => column.has(date))).sort();
  const firstActual = actual[0].date;
  let level = 100;
  const synthetic: DailyPrice[] = [];
  for (let index = 1; index < commonDates.length; index += 1) {
    const date = commonDates[index];
    if (date >= firstActual) break;
    const previous = commonDates[index - 1];
    const weightedReturn = asset.proxy.reduce((total, term, termIndex) =>
      total + term.weight * (byDate[termIndex].get(date)! / byDate[termIndex].get(previous)! - 1), 0,
    );
    // Synthetic history only fills the gap before the held ticker starts trading. Its own adjusted history always wins.
    level *= 1 + weightedReturn - (asset.ter ?? 0) / 252;
    if (!actualDates.has(date)) synthetic.push({ date, close: level });
  }
  if (synthetic.length === 0) return actual;
  const scale = actual[0].close / level;
  const spliced = synthetic.map((price) => ({ ...price, close: price.close * scale }));
  const fundCurrency = asset.fundCurrency ?? asset.currency;
  if (fundCurrency === asset.currency) return [...spliced, ...actual];
  const fx = await market.history(`${fundCurrency}${asset.currency}=X`, "1900-01-01", addDays(today(), 1));
  return [
    ...spliced.flatMap((price) => {
      const rate = latestRateOnOrBefore(fx, price.date);
      return rate === null ? [] : [{ date: price.date, close: price.close * rate }];
    }),
    ...actual,
  ];
}

async function convertedPrices(market: MarketData, asset: AssetRow, currency: string) {
  const prices = await backfilledPrices(market, asset);
  if (asset.currency === currency) return prices;
  const fx = await market.history(`${asset.currency}${currency}=X`, "1900-01-01", addDays(today(), 1));
  return prices.flatMap((price) => {
    const rate = latestRateOnOrBefore(fx, price.date);
    return rate === null ? [] : [{ date: price.date, close: price.close * rate }];
  });
}

function macroByMonth(observations: Awaited<ReturnType<typeof loadMacroSeries>>) {
  return new Map(observations.map(({ date, value }) => [monthStart(date), value]));
}

/**
 * Builds the common monthly history used by both simulation engines. Prices are total-return adjusted closes in the
 * reporting currency; every row is retained only when every ticker and macro observation exists.
 */
export async function loadMonthlyDataset(market: MarketData, assets: AssetRow[], currency: string): Promise<MonthlyDataset> {
  const instruments = assets.filter((asset) => asset.datatype === "quantity");
  if (instruments.length === 0) throw new Error("The assets tab has no quantity assets to simulate.");
  const macro = MACRO_SERIES[currency as keyof typeof MACRO_SERIES];
  if (!macro) throw new Error(`Monte Carlo supports USD, EUR and CHF reporting currencies, not ${currency}.`);

  const [priceColumns, rateObservations, cpiObservations] = await Promise.all([
    Promise.all(instruments.map((asset) => convertedPrices(market, asset, currency))),
    loadMacroSeries(macro.rate),
    loadMacroSeries(macro.cpi),
  ]);
  const returns = priceColumns.map(monthlyReturns);
  const rates = macroByMonth(rateObservations);
  const cpi = macroByMonth(cpiObservations);
  const months = [...returns[0].keys()].filter((month) => returns.every((column) => column.has(month)) && rates.has(month) && cpi.has(month)).sort();

  const previousCpi = new Map<string, number>();
  for (const [month, value] of cpi) previousCpi.set(month, value);
  const rows = months.flatMap((month) => {
    const previous = previousCpi.get(monthStart(month, -1));
    const current = cpi.get(month);
    const rate = rates.get(month);
    if (previous === undefined || current === undefined || previous <= 0 || current <= 0 || rate === undefined || rate <= -100) return [];
    return [{ month, inflation: Math.log(current / previous), riskFree: (1 + rate / 100) ** (1 / 12) - 1 }];
  });

  return {
    dates: rows.map(({ month }) => month),
    tickers: instruments.map((asset) => asset.asset),
    assetReturns: returns.map((column) => rows.map(({ month }) => column.get(month)!)),
    inflation: rows.map(({ inflation }) => inflation),
    riskFree: rows.map(({ riskFree }) => riskFree),
  };
}
