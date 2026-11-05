import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { loadCashflowPage } from "@/app/cashflow/load-cashflow-page";
import { loadNetWorthPage, type NetWorthPageSources } from "@/app/networth/load-net-worth-page";
import { addDays, monthStart, today } from "@/lib/dates";
import type { AssetRow, CashflowTransaction, CashflowWorkbook, NetWorthWorkbook } from "@/types/workbook";
import { setupMarketData, type PriceRows } from "./support/market-data-fixture";

const WARNING = "Cashflow or benchmark comparison data could not be loaded.";
const d1 = addDays(today(), -90);
const d2 = addDays(today(), -60);
const d3 = addDays(today(), -30);

const flat = (rate: number): PriceRows => [[d1, rate], [d2, rate], [d3, rate], [today(), rate]];
const fxFiles = Object.fromEntries(
  ["CHF", "EUR", "USD"].flatMap((from) => ["CHF", "EUR", "USD"].filter((to) => to !== from).map((to) => [`${from}${to}=X`, flat(1.1)])),
);
// Prices end today, so nothing is topped up from Yahoo.
const marketFiles: Record<string, PriceRows> = {
  VT: [[d1, 100], [d2, 105], [d3, 110], [today(), 115]],
  ACWI: [[d2, 100], [d3, 104], [today(), 108]],
  BND: [[d2, 100], [d3, 101], [today(), 102]],
  ...fxFiles,
};

const asset = (name: string, datatype: AssetRow["datatype"], currency: string, values: Array<[string, number]>): AssetRow => ({
  asset: name,
  datatype,
  currency,
  account: "-",
  displayName: null,
  fullName: null,
  ter: null,
  proxy: [],
  reportingValues: new Map(values),
});
const netWorthWorkbook = (currencies: string[]): NetWorthWorkbook => ({
  reportingPeriods: [d2, d3],
  currencies,
  assets: [asset("VT", "quantity", "USD", [[d2, 10], [d3, 12]]), asset("Savings", "cash", "CHF", [[d2, 1_000], [d3, 1_100]])],
});
const transaction = (date: string, type: CashflowTransaction["type"], amount: number, category: string | null = null): CashflowTransaction => ({
  date,
  type,
  amount,
  currency: "CHF",
  category,
});
const cashflowWorkbook: CashflowWorkbook = {
  categories: [],
  reportingCurrencies: ["CHF", "EUR"],
  transactions: [
    transaction(addDays(today(), -75), "contribution", 300),
    transaction(addDays(today(), -45), "income", 5_000, "Salary"),
    transaction(addDays(today(), -40), "income", 100, "withdrawal"),
  ],
};
const sources = (overrides: Partial<NetWorthPageSources> & { currencies?: string[] } = {}): NetWorthPageSources => ({
  netWorth: async () => netWorthWorkbook(overrides.currencies ?? ["CHF", "EUR"]),
  cashflow: async () => cashflowWorkbook,
  ...overrides,
});

let fixture: ReturnType<typeof setupMarketData>;
afterEach(() => fixture?.cleanup());

describe("loadNetWorthPage", () => {
  it("builds the report, growth series, hall of fame and benchmark inputs", async () => {
    fixture = setupMarketData(marketFiles);
    const page = await loadNetWorthPage(sources());
    assert.equal(page.error, null);
    assert.ok(page.report);
    assert.deepEqual(page.report.warnings, []);
    assert.equal(page.growthSeries?.length, 2);
    assert.equal(page.growthSeries?.[0].length, page.report.periods.length);
    assert.equal(page.hallOfFame?.length, 12);
    assert.equal(page.benchmarkInputs?.[0].prices.length, 3);
  });

  it("gives the benchmark the contribution at the start of the next month and the withdrawal as an outflow", async () => {
    fixture = setupMarketData(marketFiles);
    const { benchmarkInputs } = await loadNetWorthPage(sources());
    const cashflows = benchmarkInputs![0].cashflows;
    assert.equal(cashflows.length, 2);
    assert.deepEqual(cashflows[0], { date: monthStart(addDays(today(), -75), 1), amount: 300 });
    assert.deepEqual(cashflows[1], { date: addDays(today(), -40), amount: -100 });
  });

  it("leaves empty future periods and flows after the latest holdings out of every series", async () => {
    fixture = setupMarketData(marketFiles);
    // A contribution made after the last reported period is invested next month: not in the portfolio's values yet.
    const pending = transaction(addDays(today(), -20), "contribution", 800);
    const page = await loadNetWorthPage(sources({
      netWorth: async () => ({ ...netWorthWorkbook(["CHF", "EUR"]), reportingPeriods: [d2, d3, addDays(today(), 30)] }),
      cashflow: async () => ({ ...cashflowWorkbook, transactions: [...cashflowWorkbook.transactions, pending] }),
    }));

    assert.deepEqual(page.report?.periods, [d2, d3, today()]);
    assert.equal(page.benchmarkInputs?.[0].cashflows.length, 2, "the pending contribution is not replayed into the benchmark");
    assert.ok(page.report?.absoluteChanges.at(-1) !== null, "current is compared with the last valued period");
    const current = page.growthSeries?.[0].at(-1);
    assert.ok(current && current.totalIncrease !== null && current.financialIncrease !== null && current.financialIncrease > 0);
  });

  it("keeps the growth table and rankings when only the benchmark prices are missing", async () => {
    fixture = setupMarketData(Object.fromEntries(Object.entries(marketFiles).filter(([symbol]) => symbol !== "ACWI" && symbol !== "BND")));
    const page = await loadNetWorthPage(sources());
    assert.equal(page.error, null);
    assert.equal(page.growthSeries?.length, 2);
    assert.equal(page.hallOfFame?.length, 12);
    assert.deepEqual(page.benchmarkInputs?.[0].prices, []);
    assert.deepEqual(page.report?.warnings, [WARNING]);
  });

  it("drops the cashflow-dependent sections, with a warning, when the cashflow workbook cannot be loaded", async () => {
    fixture = setupMarketData(marketFiles);
    const page = await loadNetWorthPage(sources({ cashflow: async () => { throw new Error("Sheets unavailable"); } }));
    assert.equal(page.error, null);
    assert.ok(page.report);
    assert.equal(page.growthSeries, null);
    assert.equal(page.hallOfFame, null);
    assert.deepEqual(page.report.warnings, [WARNING]);
    assert.equal(page.benchmarkInputs?.length, 2, "the portfolio series is still available");
  });

  it("ranks CHF and EUR months even when the report currencies differ", async () => {
    fixture = setupMarketData(marketFiles);
    const page = await loadNetWorthPage(sources({ currencies: ["USD", "CHF"] }));
    assert.equal(page.error, null);
    assert.deepEqual(page.report?.currencies, ["USD", "CHF"]);
    assert.equal(page.hallOfFame?.length, 12);
    assert.ok(page.hallOfFame?.some((metric) => metric.id === "income-eur" && metric.topTen.length > 0));
  });

  it("returns the error message when the net-worth workbook cannot be loaded", async () => {
    fixture = setupMarketData(marketFiles);
    const page = await loadNetWorthPage(sources({ netWorth: async () => { throw new Error("The assets tab has invalid headers."); } }));
    assert.deepEqual(page, {
      report: null,
      benchmarkInputs: null,
      growthSeries: null,
      hallOfFame: null,
      error: "The assets tab has invalid headers.",
    });
  });
});

describe("loadCashflowPage", () => {
  it("builds one report per reporting currency, converting at each transaction's FX rate", async () => {
    fixture = setupMarketData(marketFiles);
    const page = await loadCashflowPage(async () => cashflowWorkbook);
    assert.equal(page.error, null);
    assert.equal(page.currency, "CHF");
    assert.deepEqual(Object.keys(page.reports ?? {}), ["CHF", "EUR"]);
    assert.equal(page.reports?.CHF.periods.reduce((sum, period) => sum + (period.income ?? 0), 0), 5_100);
    assert.ok(Math.abs((page.reports?.EUR.periods.reduce((sum, period) => sum + (period.income ?? 0), 0) ?? 0) - 5_100 * 1.1) < 1e-9);
  });

  it("returns the error message when market data or the workbook is unavailable", async () => {
    fixture = setupMarketData({});
    const missingFx = await loadCashflowPage(async () => cashflowWorkbook);
    assert.equal(missingFx.reports, null);
    assert.match(missingFx.error ?? "", /Download market data for CHFEUR=X/);

    const failing = await loadCashflowPage(async () => { throw new Error("The cashflow tab has invalid headers."); });
    assert.deepEqual(failing, { currency: null, reports: null, error: "The cashflow tab has invalid headers." });
  });
});
