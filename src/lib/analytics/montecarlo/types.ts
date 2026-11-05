/** Month-end history of the held tickers in CURRENCY_1. Every array has one entry per history row. */
export type MonthlyDataset = {
  /** ISO month-end dates, strictly increasing. */
  dates: string[];
  tickers: string[];
  /** Simple monthly returns, `assetReturns[ticker][row]`. */
  assetReturns: number[][];
  /** Log CPI increment of the month. */
  inflation: number[];
  /** Effective simple monthly risk-free rate. */
  riskFree: number[];
};

/** `blockLength` is the number of months per block of consecutive history rows; `nu` null estimates the degrees of freedom. */
export type EngineSettings = { engine: "bootstrap"; blockLength: number } | { engine: "studentT"; nu: number | null };

export type ScenarioSettings = {
  /** Unsigned 32-bit integer. */
  seed: number;
  paths: number;
  months: number;
  engine: EngineSettings;
};

export type ScenarioDetails = {
  randomVersion: string;
  engineVersion: string;
  historyMonths: number;
  /** Degrees of freedom used by the Student-t engine, null for the bootstrap. */
  nu: number | null;
  /** Whether the Student-t correlation matrix had to be repaired, null for the bootstrap. */
  correlationRepaired: boolean | null;
};

/** Generated market scenarios: the random part of a run, stored so the accounting can be re-run cheaply. */
export type Scenarios = {
  paths: number;
  months: number;
  tickers: string[];
  /**
   * Path-major, then month, then column: one block of `tickers.length + 2` values per path and month, holding the
   * simple return of every ticker, the log inflation increment and the effective risk-free rate.
   */
  values: Float32Array;
  /** Mean and standard deviation of each ticker's historical monthly log return (the reference for overrides). */
  logMean: number[];
  logSd: number[];
  details: ScenarioDetails;
};

/** Fills `out` with one month: ticker returns, then log inflation, then the risk-free rate. */
export type ScenarioEngine = {
  /** `month` counts from 0 at the start of each path. */
  next(month: number, out: Float64Array): void;
};
