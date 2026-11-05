// Small dense symmetric-matrix routines for the parametric engine. Sizes are tens of rows, so plain arrays are enough.

export type Matrix = number[][];

const JACOBI_TOLERANCE = 1e-14;
const JACOBI_MAX_SWEEPS = 50;
const HIGHAM_TOLERANCE = 1e-10;
const HIGHAM_MAX_ITERATIONS = 200;
/** A repaired correlation entry that moved by more than this counts as "repaired". */
const REPAIR_THRESHOLD = 1e-9;

function identity(size: number): Matrix {
  return Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) => (i === j ? 1 : 0)));
}

function symmetrize(matrix: Matrix): Matrix {
  return matrix.map((row, i) => row.map((value, j) => (value + matrix[j][i]) / 2));
}

export function toCorrelation(covariance: Matrix) {
  const sd = covariance.map((row, i) => Math.sqrt(row[i]));
  const correlation = covariance.map((row, i) => row.map((value, j) => value / (sd[i] * sd[j])));
  return { correlation, sd };
}

export function fromCorrelation(correlation: Matrix, sd: number[]): Matrix {
  return correlation.map((row, i) => row.map((value, j) => value * sd[i] * sd[j]));
}

/** Cyclic Jacobi eigendecomposition of a symmetric matrix. Eigenvector k is column k of `vectors`. */
export function eigenDecomposition(input: Matrix) {
  const size = input.length;
  const a = input.map((row) => [...row]);
  const vectors = identity(size);

  for (let sweep = 0; sweep < JACOBI_MAX_SWEEPS; sweep += 1) {
    let offDiagonal = 0;
    for (let p = 0; p < size - 1; p += 1) {
      for (let q = p + 1; q < size; q += 1) offDiagonal += a[p][q] ** 2;
    }
    if (Math.sqrt(offDiagonal) < JACOBI_TOLERANCE) break;

    for (let p = 0; p < size - 1; p += 1) {
      for (let q = p + 1; q < size; q += 1) {
        if (a[p][q] === 0) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        // A <- G'AG with the plane rotation G in (p, q), and V <- VG.
        for (let k = 0; k < size; k += 1) {
          const kp = a[k][p];
          const kq = a[k][q];
          a[k][p] = c * kp - s * kq;
          a[k][q] = s * kp + c * kq;
        }
        for (let k = 0; k < size; k += 1) {
          const pk = a[p][k];
          const qk = a[q][k];
          a[p][k] = c * pk - s * qk;
          a[q][k] = s * pk + c * qk;
        }
        for (let k = 0; k < size; k += 1) {
          const kp = vectors[k][p];
          const kq = vectors[k][q];
          vectors[k][p] = c * kp - s * kq;
          vectors[k][q] = s * kp + c * kq;
        }
      }
    }
  }

  return { values: a.map((row, i) => row[i]), vectors };
}

/** Nearest positive semi-definite matrix in Frobenius norm: negative eigenvalues are floored at zero. */
function projectPositiveSemiDefinite(matrix: Matrix): Matrix {
  const { values, vectors } = eigenDecomposition(symmetrize(matrix));
  const size = matrix.length;
  const projected = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  for (let k = 0; k < size; k += 1) {
    const eigenvalue = Math.max(values[k], 0);
    for (let i = 0; i < size; i += 1) {
      for (let j = 0; j < size; j += 1) projected[i][j] += eigenvalue * vectors[i][k] * vectors[j][k];
    }
  }
  return symmetrize(projected);
}

/**
 * Higham's nearest correlation matrix with Dykstra's correction, which makes the limit the nearest point of the
 * intersection of "positive semi-definite" and "unit diagonal" and not just a point in it.
 */
export function nearestCorrelation(correlation: Matrix) {
  const size = correlation.length;
  let y = correlation;
  let correction: Matrix = correlation.map((row) => row.map(() => 0));

  for (let iteration = 0; iteration < HIGHAM_MAX_ITERATIONS; iteration += 1) {
    const shifted = y.map((row, i) => row.map((value, j) => value - correction[i][j]));
    const projected = projectPositiveSemiDefinite(shifted);
    correction = projected.map((row, i) => row.map((value, j) => value - shifted[i][j]));
    const next = projected.map((row, i) => row.map((value, j) => (i === j ? 1 : value)));

    let change = 0;
    for (let i = 0; i < size; i += 1) {
      for (let j = 0; j < size; j += 1) change = Math.max(change, Math.abs(next[i][j] - y[i][j]));
    }
    y = next;
    if (change < HIGHAM_TOLERANCE) {
      let moved = 0;
      for (let i = 0; i < size; i += 1) {
        for (let j = 0; j < size; j += 1) moved = Math.max(moved, Math.abs(y[i][j] - correlation[i][j]));
      }
      return { matrix: y, repaired: moved > REPAIR_THRESHOLD };
    }
  }
  throw new Error("The correlation matrix could not be repaired: Higham's algorithm did not converge.");
}

/** Lower-triangular Cholesky factor. A matrix that is not positive definite is an error, never regularised. */
export function cholesky(matrix: Matrix): Matrix {
  const size = matrix.length;
  const pivotFloor = Math.max(...matrix.map((row, i) => row[i])) * 1e-12;
  const lower = Array.from({ length: size }, () => new Array<number>(size).fill(0));

  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let sum = matrix[i][j];
      for (let k = 0; k < j; k += 1) sum -= lower[i][k] * lower[j][k];
      if (i === j) {
        if (sum <= pivotFloor) {
          throw new Error("The covariance matrix is not positive definite.");
        }
        lower[i][i] = Math.sqrt(sum);
      } else {
        lower[i][j] = sum / lower[j][j];
      }
    }
  }
  return lower;
}
