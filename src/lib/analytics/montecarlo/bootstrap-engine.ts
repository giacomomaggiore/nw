import type { Random } from "./random";
import type { MonthlyDataset, ScenarioEngine } from "./types";

export const BOOTSTRAP_VERSION = "block-bootstrap-v1";

/**
 * Circular block bootstrap. A path is made of blocks of consecutive history months; each block starts at a uniform
 * random row and wraps around the end. Whole rows keep the cross-asset dependence and the joint inflation and
 * risk-free draw, and blocks keep short-term serial dependence.
 */
export function createBootstrapEngine(dataset: MonthlyDataset, blockLength: number, random: Random): ScenarioEngine {
  const rows = dataset.dates.length;
  const tickers = dataset.tickers.length;
  if (!Number.isInteger(blockLength) || blockLength < 1 || blockLength > rows) {
    throw new Error(`The block length must be a whole number of months from 1 to ${rows}.`);
  }
  let blockStart = 0;

  return {
    next(month, out) {
      const offset = month % blockLength;
      if (offset === 0) blockStart = random.nextInt(rows);
      const row = (blockStart + offset) % rows;
      for (let ticker = 0; ticker < tickers; ticker += 1) out[ticker] = dataset.assetReturns[ticker][row];
      out[tickers] = dataset.inflation[row];
      out[tickers + 1] = dataset.riskFree[row];
    },
  };
}
