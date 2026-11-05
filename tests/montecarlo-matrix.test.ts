import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cholesky,
  eigenDecomposition,
  fromCorrelation,
  nearestCorrelation,
  toCorrelation,
  type Matrix,
} from "@/lib/analytics/montecarlo/matrix";

function near(actual: number, expected: number, epsilon = 1e-10) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} vs ${expected}`);
}

function product(a: Matrix, b: Matrix) {
  return a.map((row) => b[0].map((_, j) => row.reduce((sum, value, k) => sum + value * b[k][j], 0)));
}

const transpose = (matrix: Matrix) => matrix[0].map((_, j) => matrix.map((row) => row[j]));

describe("eigenDecomposition", () => {
  it("finds the eigenvalues of a 2x2 matrix", () => {
    const { values } = eigenDecomposition([[2, 1], [1, 2]]);
    const sorted = [...values].sort((a, b) => a - b);
    near(sorted[0], 1);
    near(sorted[1], 3);
  });

  it("returns orthonormal eigenvectors that rebuild the matrix", () => {
    const matrix = [[4, 1, 0.5], [1, 3, 0.2], [0.5, 0.2, 2]];
    const { values, vectors } = eigenDecomposition(matrix);
    const identity = product(transpose(vectors), vectors);
    identity.forEach((row, i) => row.forEach((value, j) => near(value, i === j ? 1 : 0)));
    const diagonal = values.map((value, i) => values.map((_, j) => (i === j ? value : 0)));
    const rebuilt = product(product(vectors, diagonal), transpose(vectors));
    rebuilt.forEach((row, i) => row.forEach((value, j) => near(value, matrix[i][j])));
  });
});

describe("cholesky", () => {
  it("factors a positive definite matrix", () => {
    const lower = cholesky([[4, 2], [2, 3]]);
    near(lower[0][0], 2);
    near(lower[1][0], 1);
    near(lower[1][1], Math.SQRT2);
    near(lower[0][1], 0);
  });

  it("rejects matrices that are not positive definite instead of regularising them", () => {
    assert.throws(() => cholesky([[1, 2], [2, 1]]), /not positive definite/);
    assert.throws(() => cholesky([[1, 1], [1, 1]]), /not positive definite/);
  });
});

describe("correlation helpers", () => {
  it("splits a covariance matrix into correlation and volatilities and back", () => {
    const covariance = [[4, 3], [3, 9]];
    const { correlation, sd } = toCorrelation(covariance);
    near(correlation[0][1], 0.5);
    assert.deepEqual(sd, [2, 3]);
    assert.deepEqual(fromCorrelation(correlation, sd), covariance);
  });
});

describe("nearestCorrelation", () => {
  it("leaves a valid correlation matrix unchanged", () => {
    const { matrix, repaired } = nearestCorrelation([[1, 0.5], [0.5, 1]]);
    assert.equal(repaired, false);
    near(matrix[0][1], 0.5);
  });

  it("repairs an indefinite matrix into a positive semi-definite one with unit diagonal", () => {
    // Its determinant is negative, so it cannot be a correlation matrix.
    const indefinite = [[1, 0.9, -0.9], [0.9, 1, 0.9], [-0.9, 0.9, 1]];
    assert.ok(Math.min(...eigenDecomposition(indefinite).values) < -0.1);

    const { matrix, repaired } = nearestCorrelation(indefinite);
    assert.equal(repaired, true);
    matrix.forEach((row, i) => {
      near(row[i], 1);
      row.forEach((value, j) => near(value, matrix[j][i]));
    });
    assert.ok(Math.min(...eigenDecomposition(matrix).values) > -1e-8);
  });
});
