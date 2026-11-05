import type { AssetDatatype, AssetRow, NetWorthWorkbook, ProxyTerm } from "@/types/workbook";
import { readSheetValues, type SheetRows } from "./client";
import {
  cellText,
  hasHeaders,
  isBlankRow,
  isCurrencyCode,
  normalizeCurrency,
  normalizeHeaders,
  parseConstants,
  parseSheetDate,
} from "./parse";
import { parseProxy } from "./proxy";

export const ASSET_HEADERS = ["asset", "datatype", "currency", "account"];
export const METADATA_HEADERS = ["ticker", "display_name", "full_name", "currency", "ter", "issuer"];
/** Optional seventh `metadata` header: the history proxy of a young fund. */
export const METADATA_PROXY_HEADER = "proxy";
export const DATATYPES = ["quantity", "cash", "value"];
const SUPPORTED_CURRENCIES = ["EUR", "CHF", "USD"];

type NetWorthTabs = {
  assetRows: SheetRows;
  metadataRows: SheetRows;
  constantRows: SheetRows;
};

/** Normalised `metadata` headers without trailing blank cells, and the headers the tab must have. */
export function metadataHeaderCheck(headerRow: unknown[]) {
  const actual = normalizeHeaders(headerRow);
  while (actual.length > 0 && actual[actual.length - 1] === "") actual.pop();
  const expected = actual.length > METADATA_HEADERS.length ? [...METADATA_HEADERS, METADATA_PROXY_HEADER] : METADATA_HEADERS;
  return { actual, expected };
}

/** TER is a yearly fraction (0.0006 = 0.06%); a blank or non-numeric cell is null. */
function parseTer(value: unknown) {
  const text = cellText(value);
  const ter = Number(text);
  return text !== "" && Number.isFinite(ter) ? ter : null;
}

/** Instrument names, TER and history proxy keyed by ticker. */
function parseMetadata(rows: SheetRows) {
  return new Map(
    rows
      .filter((row) => !isBlankRow(row))
      .map((row) => {
        const [rawTicker, displayName, fullName, rawFundCurrency, ter, , proxy] = row;
        const ticker = cellText(rawTicker);
        const fundCurrency = normalizeCurrency(rawFundCurrency);
        let terms: ProxyTerm[];
        try {
          terms = parseProxy(proxy);
        } catch (error) {
          throw new Error(`The metadata tab has an invalid PROXY for ${ticker || "an unnamed ticker"}: ${error instanceof Error ? error.message : error}`);
        }
        if (terms.some((term) => term.symbol === ticker)) {
          throw new Error(`The metadata tab has an invalid PROXY for ${ticker}: a fund cannot be its own proxy.`);
        }
        return [ticker, { displayName: cellText(displayName) || null, fullName: cellText(fullName) || null, fundCurrency: isCurrencyCode(fundCurrency) ? fundCurrency : null, ter: parseTer(ter), proxy: terms }];
      }),
  );
}

function parseAsset(
  row: unknown[],
  reportingPeriods: string[],
  metadata: ReturnType<typeof parseMetadata>,
): AssetRow {
  const [asset, datatype, rawCurrency, account] = row.slice(0, 4).map(cellText);
  const currency = normalizeCurrency(rawCurrency);
  const reportingValues = new Map<string, number>();

  for (const [index, value] of row.slice(4).entries()) {
    if (value === "" || value === undefined) continue;
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      throw new Error(`The assets tab contains an invalid reporting value for ${asset || "an unnamed asset"}.`);
    }
    reportingValues.set(reportingPeriods[index], numericValue);
  }

  if (!asset || !DATATYPES.includes(datatype) || !isCurrencyCode(currency)) {
    throw new Error(`The assets tab contains an invalid row for ${asset || "an unnamed asset"}.`);
  }

  const instrument = metadata.get(asset);
  return {
    asset,
    datatype: datatype as AssetDatatype,
    currency,
    account,
    displayName: instrument?.displayName ?? null,
    fullName: instrument?.fullName ?? null,
    fundCurrency: instrument?.fundCurrency ?? null,
    ter: instrument?.ter ?? null,
    proxy: instrument?.proxy ?? [],
    reportingValues,
  };
}

/** `CURRENCY_1` first, then `CURRENCY_2/3`, then EUR/CHF/USD to fill up to three distinct supported currencies. */
function parseReportCurrencies(constantRows: SheetRows) {
  const constants = parseConstants(constantRows);
  const primary = constants.get("CURRENCY_1");
  if (!primary) {
    throw new Error("Set CURRENCY_1 in the constants tab.");
  }

  const candidates = [
    primary,
    constants.get("CURRENCY_2"),
    constants.get("CURRENCY_3"),
    ...SUPPORTED_CURRENCIES.filter((currency) => currency !== primary),
  ];
  const supported = candidates.filter((currency): currency is string => currency !== undefined && SUPPORTED_CURRENCIES.includes(currency));
  return [...new Set(supported)].slice(0, 3);
}

/** Validates and normalises the raw `assets`, `metadata` and `constants` tabs. */
export function parseNetWorthWorkbook({ assetRows, metadataRows, constantRows }: NetWorthTabs): NetWorthWorkbook {
  const [headers = [], ...assetDataRows] = assetRows;
  const [metadataHeaders = [], ...metadataDataRows] = metadataRows;

  if (!hasHeaders(normalizeHeaders(headers.slice(0, 4)), ASSET_HEADERS)) {
    throw new Error("The assets tab has invalid headers.");
  }
  const metadataCheck = metadataHeaderCheck(metadataHeaders);
  if (!hasHeaders(metadataCheck.actual, metadataCheck.expected)) {
    throw new Error("The metadata tab has invalid headers.");
  }

  const metadata = parseMetadata(metadataDataRows);
  const reportingPeriods = headers.slice(4).map((value) => parseSheetDate(value, "The assets tab contains an invalid reporting-period date."));
  const assets = assetDataRows.filter((row) => !isBlankRow(row)).map((row) => parseAsset(row, reportingPeriods, metadata));
  return { assets, reportingPeriods, currencies: parseReportCurrencies(constantRows) };
}

export async function loadNetWorthWorkbook(): Promise<NetWorthWorkbook> {
  const [assetRows, metadataRows, constantRows] = await readSheetValues("assets!A:Z", "metadata!A:G", "constants!A:B");
  return parseNetWorthWorkbook({ assetRows, metadataRows, constantRows });
}
