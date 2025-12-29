/**
 * Generate V19s-compatible candidates from pm_wallet_trade_stats
 *
 * Uses pre-aggregated pm_wallet_trade_stats for fast queries (no GROUP BY timeout).
 * The V19s engine will validate each candidate against pm_unified_ledger_v6 at runtime.
 *
 * Usage:
 *   npx tsx scripts/pnl/generate-v19s-candidates.ts
 *
 * Output:
 *   tmp/v19s_candidates.json
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import * as fs from 'fs';
import * as path from 'path';
import { getClickHouseClient } from '../../lib/clickhouse/client';

interface V19sCandidate {
  wallet: string;
  trades: number;
  maker_count: number;
  last_trade: string;
  total_usdc: number;
}

async function main() {
  const client = getClickHouseClient();

  console.log('=== GENERATE V19s CANDIDATES FROM TRADE STATS ===\n');

  // Use pre-aggregated table for speed (no timeout on GROUP BY)
  // Filter: 200-3000 total trades, >$1000 volume, recent activity
  const query = `
    SELECT
      lower(wallet) AS wallet,
      total_count AS trades,
      maker_count,
      last_trade_time AS last_trade,
      total_usdc
    FROM pm_wallet_trade_stats FINAL
    WHERE total_count BETWEEN 200 AND 3000
      AND total_usdc >= 1000
      AND last_trade_time >= now() - INTERVAL 90 DAY
    ORDER BY total_count ASC
    LIMIT 5000
  `;

  console.log('Running query against pm_wallet_trade_stats...');
  console.log('Filters: 200 <= trades <= 3000, volume >= $1000, active in 90 days\n');

  const result = await client.query({
    query,
    format: 'JSONEachRow',
  });

  const candidates = (await result.json()) as V19sCandidate[];

  console.log(`Found ${candidates.length} candidates\n`);

  // Show distribution
  const tradesBuckets = {
    '200-500': 0,
    '500-1k': 0,
    '1k-3k': 0,
  };

  for (const c of candidates) {
    if (c.trades < 500) tradesBuckets['200-500']++;
    else if (c.trades < 1000) tradesBuckets['500-1k']++;
    else tradesBuckets['1k-3k']++;
  }

  console.log('Trade count distribution:');
  for (const [bucket, count] of Object.entries(tradesBuckets)) {
    console.log(`  ${bucket}: ${count} wallets`);
  }
  console.log('');

  // Ensure tmp directory exists
  const tmpDir = path.join(process.cwd(), 'tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  // Write to JSON file
  const outputPath = path.join(tmpDir, 'v19s_candidates.json');
  fs.writeFileSync(outputPath, JSON.stringify(candidates, null, 2));
  console.log(`Written to: ${outputPath}`);

  // Sample first 10
  console.log('\nSample candidates (first 10):');
  console.log('Wallet'.padEnd(44) + 'Trades'.padEnd(10) + 'USDC'.padEnd(12) + 'Last Trade');
  console.log('-'.repeat(95));
  for (const c of candidates.slice(0, 10)) {
    console.log(
      c.wallet.padEnd(44) +
      c.trades.toString().padEnd(10) +
      `$${c.total_usdc.toFixed(0)}`.padEnd(12) +
      c.last_trade
    );
  }

  console.log('\nDone.');
  process.exit(0);
}

main().catch(console.error);
