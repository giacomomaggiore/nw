import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkAssetsTab,
  checkCashflowTab,
  checkCategoriesTab,
  checkConstantsTab,
  checkMetadataTab,
  checkSaaTab,
  checkWorkbook,
  type WorkbookTabs,
} from "@/lib/sheets/validate";

const cashflowHeader = ["DATE", "TYPE", "NAME", "AMOUNT", "CURRENCY", "CATEGORY", "SUBCATEGORY", "NOTES"];
const valid: WorkbookTabs = {
  cashflow: [cashflowHeader, [46_037, "expense", "Landlord", 1000, "CHF", "Rent"], [46_038, "contribution", "Broker", 300, "EUR"]],
  assets: [["ASSET", "DATATYPE", "CURRENCY", "ACCOUNT", 46_023, 46_054], ["VT", "quantity", "USD", "IB", 10, 12], [], ["Cash", "cash", "EUR", "Bank", 5, ""]],
  constants: [["CURRENCY_1", "CHF"], ["FIRE target", 1_500_000]],
  saa: [["ASSET_CLASS", "INSTRUMENT", 46_023, 46_054], ["equities", "VT", 0.9, 0.8]],
  categories: [["CATEGORY", "PARENT_CATEGORY", "IS_ESSENTIAL", "IS_RECURRING"], ["Rent", "Housing", true, true]],
  metadata: [["TICKER", "DISPLAY_NAME", "FULL_NAME", "CURRENCY", "TER", "ISSUER"], ["VT", "", "Vanguard Total World", "USD", 0.0007, "Vanguard"]],
};

describe("workbook validation", () => {
  it("accepts a valid workbook and summarises every tab", () => {
    const checks = checkWorkbook(valid);
    assert.deepEqual(checks.flatMap((check) => check.errors), []);
    assert.deepEqual(checks.map((check) => check.summary), [
      "2 cashflow rows",
      "3 asset rows across 2 reporting periods",
      "2 constants",
      "1 SAA rows",
      "1 category rows",
      "1 metadata rows",
    ]);
  });

  it("flags cashflow headers, missing fields, types, amounts and currencies with row numbers", () => {
    const check = checkCashflowTab([
      ["DATE", "TYPE", "NAME"],
      [46_037, "refund", "x", 5, "CHF"],
      [46_037, "expense", "x", -5, "CHF"],
      [46_037, "expense", "x", 5, "chf"],
      [46_037, "expense", "", 5, "CHF"],
    ]);
    assert.equal(check.errors.length, 5);
    assert.match(check.errors[0], /Invalid cashflow headers/);
    assert.match(check.errors[1], /Row 2: invalid transaction type "refund"/);
    assert.match(check.errors[2], /Row 3: amount "-5" must be a non-negative number/);
    assert.match(check.errors[3], /Row 4: currency "chf"/);
    assert.match(check.errors[4], /Row 5: date, transaction type, name, amount, and currency are required/);
    assert.match(checkCashflowTab([]).errors[0], /cashflow tab is empty/);
  });

  it("accepts CITY as the legacy seventh cashflow header", () => {
    assert.deepEqual(checkCashflowTab([["date", "type", "name", "amount", "currency", "category", "city", "notes"]]).errors, []);
  });

  it("flags asset headers, period columns, datatypes, currencies and non-numeric values", () => {
    const check = checkAssetsTab([
      ["ASSET", "DATATYPE", "CURRENCY", "ACCOUNT", 46_054, 46_023, "soon"],
      ["VT", "Quantity", "USD", "IB", 1],
      ["VT", "quantity", "usd", "IB", 1],
      ["VT", "quantity", "USD", "IB", "many"],
      ["", "cash", "EUR"],
    ]);
    assert.deepEqual(check.errors, [
      "assets column 7: reporting period must be a Google Sheets date.",
      "assets reporting-period dates must be in ascending order.",
      'Row 2: invalid datatype "Quantity".',
      'Row 3: currency "usd" must be a three-letter uppercase code.',
      "Row 4: reporting-period values must be numbers.",
      "Row 5: asset, datatype, and currency are required.",
    ]);
    assert.match(checkAssetsTab([["ASSET", "DATATYPE", "CURRENCY", "ACCOUNT"], ["VT", "quantity", "USD", "IB"]]).errors[0], /at least one reporting-period date/);
    assert.match(checkAssetsTab([["ASSET"]]).errors[0], /header row and at least one asset row/);
  });

  it("flags empty constants and rows without a key or value", () => {
    assert.match(checkConstantsTab([]).errors[0], /constants tab is empty/);
    assert.deepEqual(checkConstantsTab([["CURRENCY_1", "CHF"], ["", 1], ["KEY", ""]]).errors, [
      "constants row 2: key and value are required.",
      "constants row 3: key and value are required.",
    ]);
  });

  it("flags saa headers, dates and targets", () => {
    const check = checkSaaTab([["CLASS", "INSTRUMENT", 46_054, 46_023], ["equities", "VT", -0.1, "x"], ["", "VT"]]);
    assert.match(check.errors[0], /Invalid saa headers/);
    assert.ok(check.errors.includes("saa reporting-period dates must be in ascending order."));
    assert.ok(check.errors.includes("saa row 2: targets must be non-negative numbers."));
    assert.ok(check.errors.includes("saa row 3: asset class and instrument are required."));
  });

  it("flags incomplete, non-boolean and duplicate categories, and cashflow rows using unknown ones", () => {
    const check = checkCategoriesTab(
      [valid.categories[0], ["Rent", "Housing", true], ["Food", "", ""], ["Gym", "Health", "yes"], ["Rent", "Other"]],
      [cashflowHeader, [1, "expense", "x", 1, "CHF", "Holiday"], [1, "expense", "x", 1, "CHF", ""]],
    );
    assert.deepEqual(check.errors, [
      "categories row 3: category and parent category are required.",
      "categories row 4: essential and recurring must be boolean TRUE or blank.",
      'categories row 5: duplicate category "Rent".',
      'cashflow row 2: unknown category "Holiday".',
    ]);
  });

  it("requires every metadata field except the display name", () => {
    const check = checkMetadataTab([
      valid.metadata[0],
      ["VT", "", "", "USD", 0.0007, "Vanguard"],
      ["IWDA.AS", "World", "iShares", "euro", 0.002, "iShares"],
    ]);
    assert.deepEqual(check.errors, [
      "metadata row 2: ticker, full name, currency, TER, and issuer are required.",
      "metadata row 3: currency must be a three-letter uppercase code.",
    ]);
    assert.deepEqual(checkMetadataTab(valid.metadata).errors, []);
  });

  it("flags a TER that looks like a percentage typed as a plain number", () => {
    const check = checkMetadataTab([
      valid.metadata[0],
      ["VT", "", "Vanguard", "USD", 0.06, "Vanguard"],
      ["IWDA.AS", "", "iShares", "EUR", -0.001, "iShares"],
      ["BND", "", "Vanguard", "USD", "low", "Vanguard"],
      ["SPY", "", "SSGA", "USD", 0, "SSGA"],
    ]);
    assert.equal(check.errors.length, 3);
    assert.match(check.errors[0], /^metadata row 2: TER must be a yearly fraction between 0 and 0.05/);
    assert.match(check.errors[1], /^metadata row 3: TER must be a yearly fraction/);
    assert.match(check.errors[2], /^metadata row 4: TER must be a yearly fraction/);
  });

  it("accepts the optional PROXY column and reports a bad formula with its row", () => {
    const header = [...(valid.metadata[0] as string[]), "PROXY"];
    assert.deepEqual(
      checkMetadataTab([header, ["VT", "", "Vanguard", "USD", 0.0007, "Vanguard", ""], ["NTSG.PA", "", "WisdomTree", "USD", 0.0025, "WisdomTree", "URTH*0.9+IEF*0.6"]]).errors,
      [],
    );
    const check = checkMetadataTab([
      header,
      ["NTSG.PA", "", "WisdomTree", "USD", 0.0025, "WisdomTree", "URTH*0,9"],
      ["LWLD.PA", "", "Amundi", "USD", 0.006, "Amundi", "LWLD.PA"],
    ]);
    assert.equal(check.errors.length, 2);
    assert.match(check.errors[0], /^metadata row 2: invalid PROXY\. .*not a valid weight/);
    assert.equal(check.errors[1], "metadata row 3: a fund cannot be its own proxy.");
  });

  it("allows a seventh header only when it is PROXY", () => {
    const base = valid.metadata[0] as string[];
    assert.deepEqual(checkMetadataTab([[...base, "PROXY", ""], valid.metadata[1]]).errors, []);
    assert.match(checkMetadataTab([[...base, "NOTES"], valid.metadata[1]]).errors[0], /Invalid metadata headers/);
  });
});
