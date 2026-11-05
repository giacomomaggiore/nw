/** Quantile of an ascending array by linear interpolation (Excel PERCENTILE.INC, NumPy default). */
export function quantile(sorted: ArrayLike<number>, q: number) {
  if (sorted.length === 0) {
    throw new Error("A quantile needs at least one value.");
  }
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (position - lower) * (sorted[upper] - sorted[lower]);
}
