/**
 * Stage A: Generate candidate wallet list for export-grade filtering
 *
 * Filters out whales to avoid:
 * - Query size limits (large tokenId IN clauses)
 * - Proxy wallet patterns (high transfer exposure)
 * - Market makers (too many tokens)
 *
 * Output: tmp/candidate_wallets.json
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import * as fs from 'fs';
import * as path from 'path';
import { getClickHouseClient } from '../../lib/clickhouse/client';

interface CandidateWallet {
  wallet: string;
  trades: number;
  external_sells_ratio: number;
  profit_factor: number;
  engine_pnl: number;
}

async function main() {
  const client = getClickHouseClient();

  console.log('=== STAGE A: GENERATE CANDIDATE WALLETS ===\n');

  // Query for candidate wallets from pre-computed cache
  // Uses external_sells_ratio to pre-filter wallets likely to pass export gates
  // Sweet spot: 200-3000 trades (avoids timeouts)
  // Order by external_sells_ratio ASC (best candidates first)
  const query = `
    SELECT
      wallet,
      trade_count as trades,
      external_sells_ratio,
      profit_factor,
      engine_pnl
    FROM pm_wallet_engine_pnl_cache
    WHERE trade_count BETWEEN 200 AND 3000
      AND external_sells_ratio < 0.15      -- Pre-filter low external sells
      AND profit_factor > 0.3              -- Not total losers (lowered threshold)
      AND abs(engine_pnl) > 50             -- Meaningful PnL (lowered threshold)
    ORDER BY external_sells_ratio ASC,     -- Best candidates first
             profit_factor DESC
    LIMIT 2000
  `;

  console.log('Running candidate query (from pm_wallet_engine_pnl_cache)...');
  console.log('Filters: 200-3000 trades, external_sells_ratio < 15%, profit_factor > 0.3\n');

  const result = await client.query({
    query,
    format: 'JSONEachRow',
  });

  const candidates = (await result.json()) as CandidateWallet[];

  console.log(`Found ${candidates.length} candidate wallets\n`);

  // Show distribution
  const tradesBuckets = {
    '200-500': 0,
    '500-1k': 0,
    '1k-5k': 0,
    '5k-10k': 0,
    '10k-20k': 0,
  };

  for (const c of candidates) {
    if (c.trades < 500) tradesBuckets['200-500']++;
    else if (c.trades < 1000) tradesBuckets['500-1k']++;
    else if (c.trades < 5000) tradesBuckets['1k-5k']++;
    else if (c.trades < 10000) tradesBuckets['5k-10k']++;
    else tradesBuckets['10k-20k']++;
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
  const outputPath = path.join(tmpDir, 'candidate_wallets.json');
  fs.writeFileSync(outputPath, JSON.stringify(candidates, null, 2));
  console.log(`Written to: ${outputPath}`);

  // Also write a simple list of addresses
  const addressListPath = path.join(tmpDir, 'candidate_wallets_list.txt');
  fs.writeFileSync(addressListPath, candidates.map(c => c.wallet).join('\n'));
  console.log(`Address list: ${addressListPath}`);

  // Sample first 10
  console.log('\nSample candidates (first 10):');
  console.log('Wallet'.padEnd(44) + 'Trades'.padEnd(10) + 'ExtSells%'.padEnd(12) + 'PnL');
  console.log('-'.repeat(80));
  for (const c of candidates.slice(0, 10)) {
    console.log(
      c.wallet.padEnd(44) +
      c.trades.toLocaleString().padEnd(10) +
      ((c.external_sells_ratio * 100).toFixed(1) + '%').padEnd(12) +
      '$' + c.engine_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })
    );
  }

  console.log('\nDone.');
  process.exit(0);
}

main().catch(console.error);
