import type { Accounting } from "./accounting";
import { quantile } from "./quantiles";

/** Percentile levels of the fan chart and the horizon table. */
export const BAND_LEVELS = [0.1, 0.25, 0.5, 0.75, 0.9] as const;
/** Horizons, in years, of the horizon table and the histograms; the full horizon is always added. */
export const STANDARD_HORIZON_YEARS = [1, 3, 5, 10, 20, 30, 40] as const;

const DEFAULT_SAMPLE_PATHS = 10;
const DEFAULT_HISTOGRAM_BINS = 40;

export type Histogram = {
  /** `counts.length + 1` ascending bin edges. */
  edges: number[];
  counts: number[];
};

export type HorizonSummary = {
  months: number;
  /** Wealth at each of `BAND_LEVELS`. */
  nominal: number[];
  real: number[];
  /** Share of paths whose nominal wealth is below the paid-in amount. */
  lossProbability: number;
  nominalHistogram: Histogram;
  realHistogram: Histogram;
};

export type Summary = {
  paths: number;
  months: number;
  /** Percentile bands of wealth, index `month * BAND_LEVELS.length + level`, for months 0..months. */
  nominalBands: Float64Array;
  realBands: Float64Array;
  paidIn: Float64Array;
  horizons: HorizonSummary[];
  /** The first paths, path-major with `months + 1` values each, for the sample-path overlay. */
  samplePaths: { count: number; nominal: Float64Array; real: Float64Array };
};

/** Months of the horizon table: the standard years inside the horizon, plus the full horizon. */
export function horizonMonths(months: number) {
  const selected = new Set<number>(STANDARD_HORIZON_YEARS.map((years) => years * 12).filter((value) => value <= months));
  selected.add(months);
  return [...selected].sort((a, b) => a - b);
}

/** One month of every path, sorted ascending. `column` is a scratch array of `paths` values, reused between calls. */
function sortedWealth(accounting: Accounting, month: number, real: boolean, column: Float64Array) {
  const offset = month * accounting.paths;
  for (let path = 0; path < accounting.paths; path += 1) {
    column[path] = real
      ? accounting.wealth[offset + path] / accounting.priceLevel[offset + path]
      : accounting.wealth[offset + path];
  }
  return column.sort();
}

const bandValues = (sorted: Float64Array) => BAND_LEVELS.map((level) => quantile(sorted, level));

/** Equal-width bins from the 1st to the 99th percentile; outliers fall in the first or last bin so a long tail does not flatten the chart. */
function histogram(sorted: Float64Array, bins: number): Histogram {
  const low = quantile(sorted, 0.01);
  const width = (quantile(sorted, 0.99) - low) / bins;
  const counts = new Array<number>(bins).fill(0);
  for (const value of sorted) {
    const bin = width > 0 ? Math.min(bins - 1, Math.max(0, Math.floor((value - low) / width))) : 0;
    counts[bin] += 1;
  }
  return { edges: Array.from({ length: bins + 1 }, (_, index) => low + index * width), counts };
}

export function summarize(accounting: Accounting, options: { samplePaths?: number; histogramBins?: number } = {}): Summary {
  const { paths, months } = accounting;
  const bins = options.histogramBins ?? DEFAULT_HISTOGRAM_BINS;
  const column = new Float64Array(paths);
  const levels = BAND_LEVELS.length;

  const nominalBands = new Float64Array((months + 1) * levels);
  const realBands = new Float64Array((months + 1) * levels);
  for (let month = 0; month <= months; month += 1) {
    nominalBands.set(bandValues(sortedWealth(accounting, month, false, column)), month * levels);
    realBands.set(bandValues(sortedWealth(accounting, month, true, column)), month * levels);
  }

  const horizons = horizonMonths(months).map((horizon): HorizonSummary => {
    const nominal = sortedWealth(accounting, horizon, false, column);
    const nominalValues = bandValues(nominal);
    const nominalHistogram = histogram(nominal, bins);
    const real = sortedWealth(accounting, horizon, true, column);
    let losses = 0;
    for (let path = 0; path < paths; path += 1) {
      if (accounting.wealth[horizon * paths + path] < accounting.paidIn[horizon]) losses += 1;
    }
    return {
      months: horizon,
      nominal: nominalValues,
      real: bandValues(real),
      lossProbability: losses / paths,
      nominalHistogram,
      realHistogram: histogram(real, bins),
    };
  });

  const count = Math.min(options.samplePaths ?? DEFAULT_SAMPLE_PATHS, paths);
  const nominalPaths = new Float64Array(count * (months + 1));
  const realPaths = new Float64Array(count * (months + 1));
  for (let path = 0; path < count; path += 1) {
    for (let month = 0; month <= months; month += 1) {
      const nominal = accounting.wealth[month * paths + path];
      nominalPaths[path * (months + 1) + month] = nominal;
      realPaths[path * (months + 1) + month] = nominal / accounting.priceLevel[month * paths + path];
    }
  }

  return {
    paths,
    months,
    nominalBands,
    realBands,
    paidIn: accounting.paidIn,
    horizons,
    samplePaths: { count, nominal: nominalPaths, real: realPaths },
  };
}
