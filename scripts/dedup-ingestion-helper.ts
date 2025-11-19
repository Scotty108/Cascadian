/**
 * Deduplication Helper for Ingestion Scripts
 *
 * Use this helper in ALL ingestion scripts to prevent duplicates
 * before inserting into ClickHouse.
 *
 * Usage:
 *   import { deduplicateTrades } from './dedup-ingestion-helper';
 *
 *   const rawTrades = await fetchTradesFromAPI();
 *   const uniqueTrades = deduplicateTrades(rawTrades);
 *   await insertToClickHouse(uniqueTrades);
 */

export interface Trade {
  transaction_hash: string;
  log_index: number;
  timestamp: number | Date;
  wallet?: string;
  [key: string]: any; // Allow other fields
}

/**
 * Deduplicates trades using (transaction_hash, log_index) as natural key
 * Keeps the most recent version if multiple exist
 *
 * @param trades - Array of trade records
 * @returns Deduplicated array
 */
export function deduplicateTrades<T extends Trade>(trades: T[]): T[] {
  const uniqueTrades = new Map<string, T>();

  for (const trade of trades) {
    const key = `${trade.transaction_hash}:${trade.log_index}`;

    // Convert timestamp to number for comparison
    const tradeTime = typeof trade.timestamp === 'number'
      ? trade.timestamp
      : new Date(trade.timestamp).getTime();

    // Keep most recent version
    if (!uniqueTrades.has(key)) {
      uniqueTrades.set(key, trade);
    } else {
      const existing = uniqueTrades.get(key)!;
      const existingTime = typeof existing.timestamp === 'number'
        ? existing.timestamp
        : new Date(existing.timestamp).getTime();

      if (tradeTime > existingTime) {
        uniqueTrades.set(key, trade);
      }
    }
  }

  const dedupedArray = Array.from(uniqueTrades.values());

  // Log deduplication stats
  const duplicatesRemoved = trades.length - dedupedArray.length;
  if (duplicatesRemoved > 0) {
    console.log(`⚠️  Removed ${duplicatesRemoved} duplicates (${((duplicatesRemoved / trades.length) * 100).toFixed(2)}%)`);
  }

  return dedupedArray;
}

/**
 * Validates that trades array has no duplicates
 * Throws error if duplicates found
 *
 * @param trades - Array of trade records
 * @throws Error if duplicates found
 */
export function validateNoDuplicates<T extends Trade>(trades: T[]): void {
  const seen = new Set<string>();
  const duplicates: string[] = [];

  for (const trade of trades) {
    const key = `${trade.transaction_hash}:${trade.log_index}`;

    if (seen.has(key)) {
      duplicates.push(key);
    } else {
      seen.add(key);
    }
  }

  if (duplicates.length > 0) {
    throw new Error(
      `Duplicate trades found: ${duplicates.length} duplicates\n` +
      `First few: ${duplicates.slice(0, 5).join(', ')}`
    );
  }
}

/**
 * Gets duplication statistics for a trades array
 *
 * @param trades - Array of trade records
 * @returns Stats object
 */
export function getDuplicationStats<T extends Trade>(trades: T[]): {
  total: number;
  unique: number;
  duplicates: number;
  duplicationFactor: number;
} {
  const uniqueKeys = new Set(
    trades.map(t => `${t.transaction_hash}:${t.log_index}`)
  );

  return {
    total: trades.length,
    unique: uniqueKeys.size,
    duplicates: trades.length - uniqueKeys.size,
    duplicationFactor: trades.length / uniqueKeys.size
  };
}

/**
 * Example usage in ingestion script
 */
export async function exampleIngestion() {
  // Fetch raw data
  const rawTrades = await fetchTradesFromAPI();
  console.log(`Fetched ${rawTrades.length} trades from API`);

  // Deduplicate before inserting
  const uniqueTrades = deduplicateTrades(rawTrades);
  console.log(`After dedup: ${uniqueTrades.length} unique trades`);

  // Validate (optional - throws error if duplicates found)
  validateNoDuplicates(uniqueTrades);

  // Insert to ClickHouse
  await insertToClickHouse(uniqueTrades);
  console.log('✅ Inserted deduplicated trades');
}

// Placeholder functions for example
async function fetchTradesFromAPI(): Promise<Trade[]> {
  return [];
}

async function insertToClickHouse(trades: Trade[]): Promise<void> {
  // Implementation
}
