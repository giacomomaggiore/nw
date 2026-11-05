import type { MarketPrice } from "@/types/market-data";

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{ close?: Array<number | null> }>;
        adjclose?: Array<{ adjclose?: Array<number | null> }>;
      };
    }>;
  };
};

function unixSeconds(date: string) {
  return Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);
}

/** Daily prices for `[start, end)` from Yahoo; a null start requests the maximum available history. */
export async function downloadYahooPrices(symbol: string, start: string | null, end: string): Promise<MarketPrice[]> {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("period1", start === null ? "0" : String(unixSeconds(start)));
  url.searchParams.set("period2", String(unixSeconds(end)));
  url.searchParams.set("interval", "1d");
  url.searchParams.set("events", "history");
  url.searchParams.set("includeAdjustedClose", "true");

  const response = await fetch(url, { headers: { "User-Agent": "nw-market-data-downloader/1.0" } });
  if (!response.ok) {
    throw new Error(`Yahoo Finance did not return data for ${symbol} (${response.status}).`);
  }

  const result = ((await response.json()) as YahooChartResponse).chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const adjustedCloses = result?.indicators?.adjclose?.[0]?.adjclose ?? [];
  const prices = timestamps.flatMap((timestamp, index) => {
    const close = closes[index];
    if (typeof close !== "number") return [];
    const adjustedClose = adjustedCloses[index];
    return [{
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      close,
      adjustedClose: typeof adjustedClose === "number" ? adjustedClose : null,
    }];
  });

  if (prices.length === 0) {
    throw new Error(`Yahoo Finance has no prices for ${symbol}.`);
  }
  return prices;
}
