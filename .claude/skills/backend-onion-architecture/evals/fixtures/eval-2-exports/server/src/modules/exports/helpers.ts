export interface ExchangeRateTable {
  base: string;
  rates: Record<string, number>;
}

export async function normalizeAmountsToUsd(rows: Array<{ currency: string; amount: number }>) {
  const response = await fetch('https://api.exchangerate.host/latest?base=USD');
  const table = (await response.json()) as ExchangeRateTable;
  return rows.map((row) => ({
    ...row,
    amountUsd: row.currency === 'USD' ? row.amount : row.amount / (table.rates[row.currency] ?? 1),
  }));
}

export function bucketBySize(rows: Array<{ amountUsd: number }>) {
  return {
    small: rows.filter((r) => r.amountUsd < 100).length,
    medium: rows.filter((r) => r.amountUsd >= 100 && r.amountUsd < 1000).length,
    large: rows.filter((r) => r.amountUsd >= 1000).length,
  };
}
