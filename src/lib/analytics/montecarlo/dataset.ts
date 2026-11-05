import type { MonthlyDataset } from "./types";

/** Shortest history the engines accept; the page warns below a longer, recommended length. */
export const MIN_HISTORY_MONTHS = 60;

/** Throws on the first problem. History is never clipped or silently dropped. */
export function validateDataset(dataset: MonthlyDataset) {
  const rows = dataset.dates.length;
  if (dataset.tickers.length === 0) {
    throw new Error("The dataset has no tickers.");
  }
  if (new Set(dataset.tickers).size !== dataset.tickers.length) {
    throw new Error("The dataset tickers must be unique.");
  }
  if (rows < MIN_HISTORY_MONTHS) {
    throw new Error(`The common history has ${rows} months; at least ${MIN_HISTORY_MONTHS} are needed.`);
  }
  if (dataset.assetReturns.length !== dataset.tickers.length) {
    throw new Error("The dataset needs one return column per ticker.");
  }
  if (dataset.inflation.length !== rows || dataset.riskFree.length !== rows) {
    throw new Error("The inflation and risk-free columns must have one value per date.");
  }
  for (let row = 1; row < rows; row += 1) {
    if (dataset.dates[row] <= dataset.dates[row - 1]) {
      throw new Error("The dataset dates must be strictly increasing.");
    }
  }

  dataset.tickers.forEach((ticker, index) => {
    const returns = dataset.assetReturns[index];
    if (returns.length !== rows) {
      throw new Error(`${ticker} has ${returns.length} returns for ${rows} dates.`);
    }
    // A return of -100% or lower has no logarithm and cannot be a month of a real fund.
    if (!returns.every((value) => Number.isFinite(value) && value > -1)) {
      throw new Error(`${ticker} has a return that is not finite or is -100% or lower.`);
    }
  });
  if (!dataset.inflation.every(Number.isFinite)) {
    throw new Error("The inflation column has a value that is not finite.");
  }
  if (!dataset.riskFree.every((value) => Number.isFinite(value) && value > -1)) {
    throw new Error("The risk-free column has a value that is not finite or is -100% or lower.");
  }
}
