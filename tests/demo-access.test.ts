import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { loadCashflowPage } from "@/app/cashflow/load-cashflow-page";
import { loadNetWorthPage } from "@/app/networth/load-net-worth-page";
import { addDays, today } from "@/lib/dates";
import { DEMO_MULTIPLIER_MAX, demoMultiplier } from "@/lib/demo/multiplier";
import { scaleCashflowWorkbook, scaleNetWorthWorkbook } from "@/lib/demo/scale";
import { parseAccessSettings } from "@/lib/sheets/access-settings";
import type { CashflowWorkbook, NetWorthWorkbook } from "@/types/workbook";
import { setupMarketData } from "./support/market-data-fixture";

describe("demoMultiplier", () => {
  it("is deterministic, within the range and depends on both seed and salt", () => {
    assert.equal(demoMultiplier("9", "salt"), demoMultiplier("9", "salt"));
    assert.notEqual(demoMultiplier("9", "salt"), demoMultiplier("10", "salt"));
    assert.notEqual(demoMultiplier("9", "salt"), demoMultiplier("9", "other"));
    for (let seed = 0; seed < 200; seed++) {
      const value = demoMultiplier(String(seed), "salt");
      assert.ok(value >= 0 && value < DEMO_MULTIPLIER_MAX, `${seed} -> ${value}`);
    }
  });

  it("spreads over the whole range", () => {
    const values = Array.from({ length: 500 }, (_, seed) => demoMultiplier(String(seed), "salt"));
    assert.ok(Math.min(...values) < 0.05 * DEMO_MULTIPLIER_MAX && Math.max(...values) > 0.95 * DEMO_MULTIPLIER_MAX);
  });

  it("refuses to run without a salt", () => {
    assert.throws(() => demoMultiplier("9", undefined), /DEMO_SALT/);
    assert.throws(() => demoMultiplier("9", ""), /DEMO_SALT/);
  });
});

const netWorth: NetWorthWorkbook = {
  reportingPeriods: ["2026-01-01"],
  currencies: ["CHF"],
  assets: [{ asset: "VT", datatype: "quantity", currency: "USD", account: "IB", displayName: null, fullName: null, ter: null, proxy: [], reportingValues: new Map([["2026-01-01", 10]]) }],
};
const cashflow: CashflowWorkbook = {
  categories: [],
  reportingCurrencies: ["CHF"],
  transactions: [
    { date: "2026-01-05", type: "income", amount: 1_000, currency: "CHF", category: "salary" },
    { date: "2026-01-06", type: "expense", amount: 400, currency: "CHF", category: null },
  ],
};

describe("demo scaling", () => {
  it("multiplies quantities and amounts and keeps everything else", () => {
    const scaledAssets = scaleNetWorthWorkbook(netWorth, 1.5);
    assert.equal(scaledAssets.assets[0].reportingValues.get("2026-01-01"), 15);
    assert.equal(scaledAssets.assets[0].account, "IB");
    assert.equal(netWorth.assets[0].reportingValues.get("2026-01-01"), 10, "the input is not mutated");

    const scaledCashflow = scaleCashflowWorkbook(cashflow, 0.5);
    assert.deepEqual(scaledCashflow.transactions.map((transaction) => transaction.amount), [500, 200]);
    assert.equal(scaledCashflow.transactions[0].category, "salary");
  });

  it("returns the same workbook for the real-values multiplier 1", () => {
    assert.equal(scaleNetWorthWorkbook(netWorth, 1), netWorth);
    assert.equal(scaleCashflowWorkbook(cashflow, 1), cashflow);
  });
});

let fixture: ReturnType<typeof setupMarketData>;
afterEach(() => fixture?.cleanup());

describe("loadCashflowPage with a multiplier", () => {
  it("scales income and expenses while the savings rate stays the same", async () => {
    fixture = setupMarketData({});
    const real = await loadCashflowPage(async () => cashflow);
    const demo = await loadCashflowPage(async () => cashflow, () => 2);
    const month = (page: typeof real) => page.reports!.CHF.periods.find((period) => period.income !== null)!;

    assert.equal(month(demo).income, 2 * month(real).income!);
    assert.equal(month(demo).expenses, 2 * month(real).expenses!);
    assert.equal(month(demo).savingsRate, month(real).savingsRate);
  });
});

describe("loader errors", () => {
  it("shows the error message, and never loads the workbook, when the multiplier cannot be resolved", async () => {
    fixture = setupMarketData({});
    let loaded = false;
    const page = await loadCashflowPage(async () => { loaded = true; return cashflow; }, async () => { throw new Error("Set DEMO_SALT in the environment."); });

    assert.deepEqual(page, { currency: null, reports: null, error: "Set DEMO_SALT in the environment." });
    assert.equal(loaded, false);
  });
});

describe("loadNetWorthPage with a multiplier", () => {
  it("scales the portfolio totals and leaves the percentage changes alone", async () => {
    const day = (offset: number) => addDays(today(), offset);
    const asset = (values: Array<[string, number]>): NetWorthWorkbook["assets"][number] => ({
      asset: "Savings", datatype: "cash", currency: "CHF", account: "-", displayName: null, fullName: null, ter: null, proxy: [], reportingValues: new Map(values),
    });
    const workbook: NetWorthWorkbook = { reportingPeriods: [day(-60), day(-30)], currencies: ["CHF"], assets: [asset([[day(-60), 1_000], [day(-30), 1_100]])] };
    const sources = { netWorth: async () => workbook, cashflow: async () => cashflow };
    fixture = setupMarketData({});
    const real = await loadNetWorthPage(sources);
    const demo = await loadNetWorthPage(sources, () => 3);

    assert.equal(demo.report!.totals[0][1], 3 * real.report!.totals[0][1]!);
    assert.equal(demo.report!.absoluteChanges[1], 3 * real.report!.absoluteChanges[1]!);
    assert.equal(demo.report!.percentageChanges[1], real.report!.percentageChanges[1]);
  });

  it("returns the error message when the multiplier cannot be resolved", async () => {
    fixture = setupMarketData({});
    const page = await loadNetWorthPage({ netWorth: async () => netWorth, cashflow: async () => cashflow }, () => { throw new Error("Set DEMO_SALT in the environment."); });
    assert.equal(page.error, "Set DEMO_SALT in the environment.");
    assert.equal(page.report, null);
  });
});

describe("parseAccessSettings", () => {
  it("lower-cases and trims the allowlist and reads the lucky seed as typed", () => {
    const settings = parseAccessSettings([
      ["ALLOWED_EMAILS", " A@x.com, b@X.com ,, "],
      ["LUCKY_SEED", "Open Sesame"],
    ]);
    assert.deepEqual(settings, { allowedEmails: ["a@x.com", "b@x.com"], luckySeed: "Open Sesame" });
  });

  it("grants nothing when the keys are missing or blank", () => {
    assert.deepEqual(parseAccessSettings([]), { allowedEmails: [], luckySeed: null });
    assert.deepEqual(parseAccessSettings([["ALLOWED_EMAILS", ""], ["LUCKY_SEED", "  "]]), { allowedEmails: [], luckySeed: null });
  });
});
