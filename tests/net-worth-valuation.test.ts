import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { buildNetWorthReport } from "@/lib/analytics/net-worth";
import { loadFinancialPriceIncreases, valueNetWorth } from "@/lib/market-data/net-worth";
import { createMarketData } from "@/lib/market-data/prices";
import type { AssetRow, NetWorthWorkbook } from "@/types/workbook";
import { setupMarketData } from "./support/market-data-fixture";

const PERIODS = ["2026-01-31", "2026-02-28"];
const CURRENT = "2026-03-15";

function asset(overrides: Partial<AssetRow> & Pick<AssetRow, "asset" | "datatype" | "currency">, values: Array<[string, number]>): AssetRow {
  return { account: "-", displayName: null, fullName: null, ter: null, proxy: [], reportingValues: new Map(values), ...overrides };
}

const workbook: NetWorthWorkbook = {
  reportingPeriods: PERIODS,
  currencies: ["CHF", "EUR"],
  assets: [
    asset({ asset: "VT", datatype: "quantity", currency: "USD", fullName: "Vanguard Total World" }, [["2026-01-31", 10], ["2026-02-28", 20]]),
    asset({ asset: "Savings", datatype: "cash", currency: "EUR", displayName: "Savings" }, [["2026-01-31", 1_000]]),
    asset({ asset: "House", datatype: "value", currency: "CHF" }, [["2026-02-28", 5_000]]),
  ],
};

// First close on or after each period: Jan 31 → Feb 2 (105), Feb 28 → Mar 2 (110); latest is Mar 13 (120).
const vtPrices: Array<[string, number]> = [["2026-01-30", 100], ["2026-02-02", 105], ["2026-03-02", 110], ["2026-03-13", 120]];
const flat = (rate: number): Array<[string, number]> => [["2026-01-30", rate], ["2026-03-13", rate]];
const marketFiles = {
  VT: vtPrices,
  "USDCHF=X": flat(0.9),
  "USDEUR=X": flat(0.8),
  "EURCHF=X": flat(0.95),
  "CHFEUR=X": flat(1.05),
};

let fixture: ReturnType<typeof setupMarketData>;
afterEach(() => fixture?.cleanup());

function close(actual: number | null | undefined, expected: number) {
  assert.ok(actual !== null && actual !== undefined && Math.abs(actual - expected) < 1e-9, `${actual} vs ${expected}`);
}

describe("valueNetWorth", () => {
  beforeEach(() => {
    fixture = setupMarketData(marketFiles);
  });

  it("prices quantities at the period's price, and the current column at the latest reported holdings and price", async () => {
    const [vt] = (await valueNetWorth(createMarketData(), workbook, CURRENT)).assets;
    assert.deepEqual(vt.values, [10 * 105, 20 * 110, 20 * 120]);
  });

  it("values the current column at the latest available price, not the price on the current date", async () => {
    // Prices run to Mar 13; a current date of Mar 1 would otherwise pick the Mar 2 close (110).
    const [vt] = (await valueNetWorth(createMarketData(), workbook, "2026-03-01")).assets;
    assert.equal(vt.values[2], 20 * 120);
  });

  it("reports cash and manual values as given, leaving periods without a value empty", async () => {
    const { assets, periods } = await valueNetWorth(createMarketData(), workbook, CURRENT);
    assert.deepEqual(periods, [...PERIODS, CURRENT]);
    assert.deepEqual(assets[1].values, [1_000, null, null]);
    assert.deepEqual(assets[2].values, [null, 5_000, 5_000]);
  });

  it("leaves out reporting periods after the latest one with values, so the current column follows the last valued period", async () => {
    const withEmptyColumns = { ...workbook, reportingPeriods: [...PERIODS, "2026-03-31", "2026-04-30"] };
    const valued = await valueNetWorth(createMarketData(), withEmptyColumns, CURRENT);
    assert.deepEqual(valued.periods, [...PERIODS, CURRENT]);

    const report = buildNetWorthReport(valued);
    const [totals] = report.totals;
    close(report.absoluteChanges.at(-1), totals.at(-1)! - totals.at(-2)!);
    close(report.percentageChanges.at(-1), (totals.at(-1)! / totals.at(-2)! - 1) * 100);
  });

  it("keeps an empty period that sits between valued ones", async () => {
    const withGap = { ...workbook, reportingPeriods: ["2026-01-31", "2026-02-14", "2026-02-28"] };
    const valued = await valueNetWorth(createMarketData(), withGap, CURRENT);
    assert.deepEqual(valued.periods, ["2026-01-31", "2026-02-14", "2026-02-28", CURRENT]);
  });

  it("converts every value into each report currency at that period's FX rate", async () => {
    const [vt, savings, house] = (await valueNetWorth(createMarketData(), workbook, CURRENT)).assets;
    assert.equal(vt.convertedValues[0][1], 20 * 110 * 0.9);
    assert.equal(vt.convertedValues[1][2], 20 * 120 * 0.8);
    assert.deepEqual(savings.convertedValues[0], [1_000 * 0.95, null, null]);
    assert.deepEqual(savings.convertedValues[1], [1_000, null, null]);
    assert.deepEqual(house.convertedValues[1], [null, 5_000 * 1.05, 5_000 * 1.05]);
  });

  it("measures year-to-date performance of quantity assets in each currency, using adjusted prices", async () => {
    const [vt, savings] = (await valueNetWorth(createMarketData(), workbook, CURRENT)).assets;
    close(vt.ytdPerformance.CHF, 20);
    close(vt.ytdPerformance.EUR, 20);
    assert.deepEqual(savings.ytdPerformance, { CHF: null, EUR: null });
  });

  it("labels quantity assets with their display or full name and a quote link", async () => {
    const { assets } = await valueNetWorth(createMarketData(), workbook, CURRENT);
    assert.equal(assets[0].instrumentName, "Vanguard Total World");
    assert.equal(assets[0].instrumentUrl, "https://finance.yahoo.com/quote/VT");
    assert.deepEqual([assets[1].instrumentName, assets[1].instrumentUrl], [null, null]);
  });

  it("turns missing market data into empty cells and warnings instead of failing", async () => {
    const withMissing = { ...workbook, assets: [...workbook.assets, asset({ asset: "XYZ", datatype: "quantity", currency: "USD" }, [["2026-01-31", 5], ["2026-02-28", 5]])] };
    const valuedAssets = await valueNetWorth(createMarketData(), withMissing, CURRENT);
    assert.deepEqual(valuedAssets.assets[3].values, [null, null, null]);
    assert.deepEqual(valuedAssets.assets[3].ytdPerformance, { CHF: null, EUR: null });
    assert.ok(valuedAssets.warnings.includes("Download market data for XYZ with npm run download:market-data."));
    // The remaining assets are unaffected and the totals skip the missing asset.
    assert.deepEqual(buildNetWorthReport(valuedAssets).totals[0].slice(0, 2), [1_000 * 0.95 + 10 * 105 * 0.9, 20 * 110 * 0.9 + 5_000]);
  });

  it("requires at least one reported value", async () => {
    await assert.rejects(valueNetWorth(createMarketData(), { ...workbook, assets: [] }, CURRENT), /at least one reporting-period value/);
  });
});

describe("loadFinancialPriceIncreases", () => {
  beforeEach(() => {
    fixture = setupMarketData(marketFiles);
  });

  it("multiplies each period's price change by the holdings at its start, converted at the start-of-period FX rate", async () => {
    const increases = await loadFinancialPriceIncreases(createMarketData(), workbook, [...PERIODS, CURRENT]);
    // Feb: (110 - 105) × 10 USD. Current: (120 - 110) × 20 USD.
    assert.deepEqual(increases[0], [null, 50 * 0.9, 200 * 0.9]);
    assert.deepEqual(increases[1], [null, 50 * 0.8, 200 * 0.8]);
  });

  it("is zero for periods that start without holdings, and null when a price is missing", async () => {
    const noHoldings = { ...workbook, assets: [asset({ asset: "VT", datatype: "quantity", currency: "USD" }, [["2026-02-28", 20]])] };
    const [chf] = await loadFinancialPriceIncreases(createMarketData(), noHoldings, [...PERIODS, CURRENT]);
    assert.deepEqual(chf, [null, 0, 200 * 0.9]);

    fixture.cleanup();
    fixture = setupMarketData({ "USDCHF=X": flat(0.9), "USDEUR=X": flat(0.8) });
    const [missing] = await loadFinancialPriceIncreases(createMarketData(), workbook, [...PERIODS, CURRENT]);
    assert.deepEqual(missing, [null, null, null]);
  });
});
