import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadMonthlyDataset } from "@/lib/market-data/montecarlo";
import { createMarketData } from "@/lib/market-data/prices";
import type { AssetRow } from "@/types/workbook";
import { setupMarketData } from "./support/market-data-fixture";

const dates = Array.from({ length: 62 }, (_, index) => {
  const date = new Date(Date.UTC(2020, index, 1));
  return date.toISOString().slice(0, 10);
});
const asset: AssetRow = {
  asset: "VT",
  datatype: "quantity",
  currency: "USD",
  account: "IB",
  displayName: null,
  fullName: "Vanguard Total World",
  ter: null,
  proxy: [],
  reportingValues: new Map(),
};

let fixture: ReturnType<typeof setupMarketData>;
beforeEach(() => {
  fixture = setupMarketData({ VT: dates.map((date, index) => [date, 100 + index] as [string, number]) });
  const macro = join(process.cwd(), "data", "market-data", "macro");
  mkdirSync(macro, { recursive: true });
  const write = (series: string, values: number[]) => writeFileSync(
    join(macro, `${series}.json`),
    JSON.stringify({ series, downloadedAt: "test", observations: dates.map((date, index) => ({ date, value: values[index] })) }),
  );
  write("TB3MS", dates.map(() => 3));
  write("CPIAUCSL", dates.map((_date, index) => 100 + index));
});
afterEach(() => fixture.cleanup());

describe("loadMonthlyDataset", () => {
  it("aligns adjusted monthly returns with CPI and the annual cash rate", async () => {
    const dataset = await loadMonthlyDataset(createMarketData(), [asset], "USD");
    assert.equal(dataset.dates.length, 61);
    assert.deepEqual(dataset.tickers, ["VT"]);
    assert.ok(Math.abs(dataset.assetReturns[0][0] - 0.01) < 1e-12);
    assert.ok(Math.abs(dataset.inflation[0] - Math.log(101 / 100)) < 1e-12);
    assert.ok(Math.abs(dataset.riskFree[0] - ((1.03) ** (1 / 12) - 1)) < 1e-12);
  });
});
