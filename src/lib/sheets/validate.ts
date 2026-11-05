// Workbook contract checks for `npm run test:sheets`. Pure: they take raw tab rows and report every problem found,
// with row numbers, instead of stopping at the first one like the app's parsers do.
import type { SheetRows } from "./client";
import { CASHFLOW_HEADERS, CASHFLOW_TYPES, CATEGORY_HEADERS } from "./cashflow";
import { ASSET_HEADERS, DATATYPES, metadataHeaderCheck } from "./net-worth";
import { cellText, hasHeaders, isBlankRow, isCurrencyCode, normalizeHeaders } from "./parse";
import { parseProxy } from "./proxy";

export type TabCheck = { tab: string; summary: string; errors: string[] };

export type WorkbookTabs = {
  cashflow: SheetRows;
  assets: SheetRows;
  constants: SheetRows;
  saa: SheetRows;
  categories: SheetRows;
  metadata: SheetRows;
};

const SAA_HEADERS = ["asset_class", "instrument"];
/** Upper bound of a plausible yearly TER as a fraction (5%). */
const MAX_TER = 0.05;

function headerError(tab: string, actual: string[], expected: string[]) {
  return hasHeaders(actual, expected) ? [] : [`Invalid ${tab} headers. Expected: ${expected.join(", ")}. Found: ${actual.join(", ")}`];
}

/** Date columns after the fixed columns must be Google Sheets dates in ascending order. */
function periodColumnErrors(tab: string, headers: unknown[], fixedColumns: number) {
  const periods = headers.slice(fixedColumns).map(Number);
  const errors = periods.flatMap((period, index) =>
    Number.isFinite(period) ? [] : [`${tab} column ${index + fixedColumns + 1}: reporting period must be a Google Sheets date.`],
  );
  if (periods.some((period, index) => index > 0 && period <= periods[index - 1])) {
    errors.push(`${tab} reporting-period dates must be in ascending order.`);
  }
  return { periods, errors };
}

function isFlag(value: unknown) {
  return value === "" || value === undefined || value === true;
}

export function checkCashflowTab(rows: SheetRows): TabCheck {
  const tab = "cashflow";
  if (rows.length === 0) {
    return { tab, summary: "0 rows", errors: ["The cashflow tab is empty. Add the required header row and at least one transaction."] };
  }

  const [headers, ...transactions] = rows;
  // `CITY` is the legacy name of the seventh column.
  const actualHeaders = normalizeHeaders(headers).map((header, index) => (index === 6 && header === "city" ? "subcategory" : header));
  const errors = headerError(tab, actualHeaders, CASHFLOW_HEADERS);

  for (const [index, row] of transactions.entries()) {
    const rowNumber = index + 2;
    const [date, type, name, amount, currency] = row.map(cellText);
    if (!date || !type || !name || !amount || !currency) {
      errors.push(`Row ${rowNumber}: date, transaction type, name, amount, and currency are required.`);
      continue;
    }
    if (!CASHFLOW_TYPES.includes(type.toLowerCase())) errors.push(`Row ${rowNumber}: invalid transaction type "${type}".`);
    if (!Number.isFinite(Number(amount)) || Number(amount) < 0) errors.push(`Row ${rowNumber}: amount "${amount}" must be a non-negative number.`);
    if (!isCurrencyCode(currency)) errors.push(`Row ${rowNumber}: currency "${currency}" must be a three-letter uppercase code.`);
  }

  return { tab, summary: `${transactions.length} cashflow rows`, errors };
}

export function checkAssetsTab(rows: SheetRows): TabCheck {
  const tab = "assets";
  if (rows.length < 2) {
    return { tab, summary: `${rows.length} rows`, errors: ["The assets tab must contain a header row and at least one asset row."] };
  }

  const [headers, ...assets] = rows;
  const errors = headerError(tab, normalizeHeaders(headers.slice(0, 4)), ASSET_HEADERS);
  const periods = periodColumnErrors(tab, headers, 4);
  errors.push(...periods.errors);
  if (periods.periods.length === 0) errors.push("Add at least one reporting-period date after the Account column.");

  for (const [index, row] of assets.entries()) {
    const rowNumber = index + 2;
    if (isBlankRow(row)) continue;

    const [asset, datatype, currency] = row.slice(0, 3).map(cellText);
    if (!asset || !datatype || !currency) {
      errors.push(`Row ${rowNumber}: asset, datatype, and currency are required.`);
      continue;
    }
    // The app only accepts the exact lower-case datatypes, so the check does too.
    if (!DATATYPES.includes(datatype)) errors.push(`Row ${rowNumber}: invalid datatype "${datatype}".`);
    if (!isCurrencyCode(currency)) errors.push(`Row ${rowNumber}: currency "${currency}" must be a three-letter uppercase code.`);
    if (row.slice(4).some((value) => value !== "" && !Number.isFinite(Number(value)))) {
      errors.push(`Row ${rowNumber}: reporting-period values must be numbers.`);
    }
  }

  return { tab, summary: `${assets.length} asset rows across ${periods.periods.length} reporting periods`, errors };
}

export function checkConstantsTab(rows: SheetRows): TabCheck {
  const errors = rows.length === 0 ? ["The constants tab is empty."] : [];
  for (const [index, [key, value]] of rows.entries()) {
    if (!cellText(key) || value === "" || value === undefined) errors.push(`constants row ${index + 1}: key and value are required.`);
  }
  return { tab: "constants", summary: `${rows.length} constants`, errors };
}

export function checkSaaTab(rows: SheetRows): TabCheck {
  const tab = "saa";
  const summary = `${Math.max(rows.length - 1, 0)} SAA rows`;
  if (rows.length < 2) return { tab, summary, errors: ["The saa tab must contain a header row and at least one target row."] };

  const [headers, ...targets] = rows;
  const errors = [...headerError(tab, normalizeHeaders(headers.slice(0, 2)), SAA_HEADERS), ...periodColumnErrors(tab, headers, 2).errors];
  for (const [index, target] of targets.entries()) {
    const [assetClass, instrument] = target.slice(0, 2).map(cellText);
    if (!assetClass || !instrument) errors.push(`saa row ${index + 2}: asset class and instrument are required.`);
    if (target.slice(2).some((value) => value !== "" && (!Number.isFinite(Number(value)) || Number(value) < 0))) {
      errors.push(`saa row ${index + 2}: targets must be non-negative numbers.`);
    }
  }
  return { tab, summary, errors };
}

/** Every non-empty cashflow category must exist here, so the cashflow rows are needed too. */
export function checkCategoriesTab(rows: SheetRows, cashflowRows: SheetRows): TabCheck {
  const tab = "categories";
  const summary = `${Math.max(rows.length - 1, 0)} category rows`;
  if (rows.length < 2) return { tab, summary, errors: ["The categories tab must contain a header row and at least one category row."] };

  const [headers, ...categories] = rows;
  const errors = headerError(tab, normalizeHeaders(headers), CATEGORY_HEADERS);
  const names = new Set<string>();
  for (const [index, [category, parent, essential, recurring]] of categories.entries()) {
    const name = cellText(category);
    if (!name || !cellText(parent)) errors.push(`categories row ${index + 2}: category and parent category are required.`);
    else if (!isFlag(essential) || !isFlag(recurring)) errors.push(`categories row ${index + 2}: essential and recurring must be boolean TRUE or blank.`);
    else if (names.has(name)) errors.push(`categories row ${index + 2}: duplicate category "${name}".`);
    else names.add(name);
  }

  for (const [index, row] of cashflowRows.slice(1).entries()) {
    const category = cellText(row[5]);
    if (category && !names.has(category)) errors.push(`cashflow row ${index + 2}: unknown category "${category}".`);
  }
  return { tab, summary, errors };
}

export function checkMetadataTab(rows: SheetRows): TabCheck {
  const tab = "metadata";
  const summary = `${Math.max(rows.length - 1, 0)} metadata rows`;
  if (rows.length < 2) return { tab, summary, errors: ["The metadata tab must contain a header row and at least one instrument row."] };

  const [headers, ...instruments] = rows;
  const { actual, expected } = metadataHeaderCheck(headers);
  const errors = headerError(tab, actual, expected);
  for (const [index, instrument] of instruments.entries()) {
    // DISPLAY_NAME and PROXY are optional; every other field is required.
    const [ticker, , fullName, currency, ter, issuer, proxy] = instrument.map(cellText);
    const row = `metadata row ${index + 2}`;
    if (!ticker || !fullName || !currency || !ter || !issuer) {
      errors.push(`${row}: ticker, full name, currency, TER, and issuer are required.`);
    }
    if (currency && !isCurrencyCode(currency)) errors.push(`${row}: currency must be a three-letter uppercase code.`);
    // A TER typed as a percentage (0.06 for 0.06%) would be read as 6% a year.
    if (ter && !(Number(ter) >= 0 && Number(ter) <= MAX_TER)) {
      errors.push(`${row}: TER must be a yearly fraction between 0 and ${MAX_TER} (store 0.06% as 0.0006, or format the cell as a percentage).`);
    }
    try {
      if (parseProxy(proxy).some((term) => term.symbol === ticker)) errors.push(`${row}: a fund cannot be its own proxy.`);
    } catch (error) {
      errors.push(`${row}: invalid PROXY. ${error instanceof Error ? error.message : error}`);
    }
  }
  return { tab, summary, errors };
}

export function checkWorkbook(tabs: WorkbookTabs): TabCheck[] {
  return [
    checkCashflowTab(tabs.cashflow),
    checkAssetsTab(tabs.assets),
    checkConstantsTab(tabs.constants),
    checkSaaTab(tabs.saa),
    checkCategoriesTab(tabs.categories, tabs.cashflow),
    checkMetadataTab(tabs.metadata),
  ];
}
