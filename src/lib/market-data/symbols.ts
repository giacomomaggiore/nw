import type { CashflowWorkbook, NetWorthWorkbook } from "@/types/workbook";
import { BENCHMARK_TICKERS } from "./benchmark";

export const SUPPORTED_MACRO_CURRENCIES = ["USD", "EUR", "CHF"] as const;
export const MACRO_SERIES = {
  USD: { rate: "TB3MS", cpi: "CPIAUCSL" },
  EUR: { rate: "IR3TIB01EZM156N", cpi: "CP0000EZ19M086NEST" },
  CHF: { rate: "IR3TIB01CHM156N", cpi: "CHECPIALLMINMEI" },
} as const;

/**
 * Every Yahoo symbol the dashboards look up: quantity tickers, the benchmark ETFs, and an FX pair from each currency
 * in the workbooks to each reporting currency.
 */
export function requiredMarketSymbols(netWorth: NetWorthWorkbook, cashflow: CashflowWorkbook) {
  const currencies = new Set([
    ...netWorth.currencies,
    ...netWorth.assets.map((asset) => asset.currency),
    ...cashflow.transactions.map((transaction) => transaction.currency),
  ]);
  const reportingCurrencies = new Set([...netWorth.currencies, ...cashflow.reportingCurrencies]);
  const proxySymbols = netWorth.assets.flatMap((asset) => asset.proxy.map((term) => term.symbol));
  // Proxy terms can be denominated in any supported currency. Fetching the complete
  // supported-currency cross set keeps the downloader independent of Yahoo metadata.
  const proxyCurrencies = proxySymbols.length === 0 ? [] : [...SUPPORTED_MACRO_CURRENCIES];
  const fxSymbols = [...currencies].flatMap((from) =>
    [...reportingCurrencies].filter((to) => to !== from).map((to) => `${from}${to}=X`),
  );
  const proxyFxSymbols = proxyCurrencies.flatMap((from) =>
    [...new Set([...currencies, ...reportingCurrencies])].filter((to) => to !== from).map((to) => `${from}${to}=X`),
  );
  const tickers = netWorth.assets.filter((asset) => asset.datatype === "quantity").map((asset) => asset.asset);

  return [...new Set([...tickers, ...proxySymbols, BENCHMARK_TICKERS.stock, BENCHMARK_TICKERS.bond, ...fxSymbols, ...proxyFxSymbols])].sort();
}
