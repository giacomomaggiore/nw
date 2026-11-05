import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requiredMarketSymbols } from "@/lib/market-data/symbols";
import type { AssetRow, CashflowWorkbook, NetWorthWorkbook } from "@/types/workbook";

const asset = (name: string, datatype: AssetRow["datatype"], currency: string): AssetRow => ({
  asset: name,
  datatype,
  currency,
  account: "-",
  displayName: null,
  fullName: null,
  ter: null,
  proxy: [],
  reportingValues: new Map(),
});

describe("requiredMarketSymbols", () => {
  const netWorth: NetWorthWorkbook = {
    reportingPeriods: [],
    currencies: ["CHF", "EUR"],
    assets: [asset("VT", "quantity", "USD"), asset("Savings", "cash", "EUR"), asset("House", "value", "GBP")],
  };
  const cashflow: CashflowWorkbook = {
    categories: [],
    reportingCurrencies: ["CHF", "USD"],
    transactions: [{ date: "2026-01-01", type: "expense", amount: 1, currency: "JPY", category: null }],
  };
  const symbols = requiredMarketSymbols(netWorth, cashflow);

  it("includes quantity tickers and the benchmark ETFs, but not cash or manual assets", () => {
    assert.ok(symbols.includes("VT"));
    assert.ok(symbols.includes("ACWI"));
    assert.ok(symbols.includes("BND"));
    assert.ok(!symbols.includes("Savings"));
    assert.ok(!symbols.includes("House"));
  });

  it("includes an FX pair from every workbook currency to every reporting currency, never a currency to itself", () => {
    for (const pair of ["USDCHF=X", "USDEUR=X", "EURCHF=X", "EURUSD=X", "GBPCHF=X", "GBPUSD=X", "JPYEUR=X", "JPYUSD=X", "CHFEUR=X", "CHFUSD=X"]) {
      assert.ok(symbols.includes(pair), `missing ${pair}`);
    }
    for (const same of ["CHFCHF=X", "EUREUR=X", "USDUSD=X"]) assert.ok(!symbols.includes(same));
  });

  it("is sorted and free of duplicates", () => {
    assert.deepEqual(symbols, [...new Set(symbols)].sort());
  });

  it("includes proxy tickers and supported-currency FX pairs when a proxy is configured", () => {
    const withProxy = {
      ...netWorth,
      assets: [{ ...netWorth.assets[0], proxy: [{ symbol: "URTH", weight: 2 }] }, ...netWorth.assets.slice(1)],
    };
    const proxySymbols = requiredMarketSymbols(withProxy, cashflow);
    assert.ok(proxySymbols.includes("URTH"));
    assert.ok(proxySymbols.includes("USDCHF=X"));
    assert.ok(proxySymbols.includes("EURUSD=X"));
    assert.ok(proxySymbols.includes("CHFUSD=X"));
  });
});
