export const MIN_NU = 5;
export const MAX_NU = 100;

export function mean(values: ArrayLike<number>) {
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) sum += values[index];
  return sum / values.length;
}

/** Sample standard deviation (n - 1). */
export function standardDeviation(values: ArrayLike<number>) {
  const average = mean(values);
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) sum += (values[index] - average) ** 2;
  return Math.sqrt(sum / (values.length - 1));
}

/** Unbiased covariance matrix of equally long columns. */
export function covarianceMatrix(columns: number[][]) {
  const count = columns[0].length;
  const averages = columns.map(mean);
  return columns.map((first, i) =>
    columns.map((second, j) => {
      let sum = 0;
      for (let row = 0; row < count; row += 1) sum += (first[row] - averages[i]) * (second[row] - averages[j]);
      return sum / (count - 1);
    }),
  );
}

/**
 * Excess kurtosis of all columns pooled after standardizing each one, so a volatile column does not dominate.
 * Population moments: a Student-t with nu degrees of freedom has excess kurtosis 6 / (nu - 4).
 */
export function pooledExcessKurtosis(columns: number[][]) {
  let m2 = 0;
  let m4 = 0;
  let count = 0;
  for (const column of columns) {
    const average = mean(column);
    const deviation = standardDeviation(column);
    for (const value of column) {
      const z = (value - average) / deviation;
      m2 += z * z;
      m4 += z ** 4;
      count += 1;
    }
  }
  m2 /= count;
  m4 /= count;
  return m4 / (m2 * m2) - 3;
}

/** Degrees of freedom by moment matching, clamped so the fourth moment stays finite. */
export function estimateNu(columns: number[][]) {
  const excess = pooledExcessKurtosis(columns);
  if (excess <= 0) return MAX_NU;
  return Math.min(MAX_NU, Math.max(MIN_NU, 4 + 6 / excess));
}
