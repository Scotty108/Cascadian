/**
 * Phase 1: Build Candidate Universe
 *
 * Pulls unbiased candidate universe directly from pm_unified_ledger_v6
 * No CLV prefilter - uses raw ledger data
 *
 * Filters:
 * - n_events >= 10 (diversified)
 * - total_notional >= $5k (meaningful volume)
 * - n_trades >= 20 (not one-shot luck)
 * - active in last 14 days
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';
import * as fs from 'fs';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
});

export interface CandidateWallet {
  wallet: string;
  n_trades: number;
  n_events: number;
  total_notional: number;
  last_trade: string;
}

export async function buildCandidateUniverse(): Promise<CandidateWallet[]> {
  console.log('=== Phase 1: Build Candidate Universe ===\n');
  console.log('Source: pm_unified_ledger_v6 (unbiased, no CLV prefilter)\n');

  // Two-phase approach to avoid memory issues:
  // 1. Get list of active wallets from pre-computed CLV table (fast)
  // 2. Compute metrics for those wallets from ledger

  console.log('Phase 1a: Getting active wallets from CLV table...');
  const activeWalletsQuery = `
    SELECT DISTINCT lower(wallet) AS wallet
    FROM pm_trade_clv_features_60d
    WHERE trade_time >= now() - INTERVAL 14 DAY
    LIMIT 5000
  `;

  const activeResult = await ch.query({ query: activeWalletsQuery, format: 'JSONEachRow' });
  const activeWallets = (await activeResult.json() as any[]).map(r => r.wallet);
  console.log(`Found ${activeWallets.length} recently active wallets\n`);

  // Process in batches
  const batchSize = 500;
  const allCandidates: CandidateWallet[] = [];

  for (let i = 0; i < activeWallets.length; i += batchSize) {
    const batch = activeWallets.slice(i, i + batchSize);
    const walletList = batch.map(w => `'${w}'`).join(',');
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(activeWallets.length / batchSize);

    console.log(`Phase 1b: Processing batch ${batchNum}/${totalBatches}...`);

    const query = `
      SELECT
        lower(wallet_address) AS wallet,
        count() AS n_trades,
        uniqExact(condition_id) AS n_events,
        round(sum(abs(usdc_delta)), 2) AS total_notional,
        formatDateTime(max(event_time), '%Y-%m-%d %H:%i:%S') AS last_trade
      FROM pm_unified_ledger_v6
      WHERE lower(wallet_address) IN (${walletList})
        AND event_time >= now() - INTERVAL 60 DAY
        AND source_type = 'CLOB'
        AND condition_id IS NOT NULL
        AND condition_id != ''
      GROUP BY wallet
      HAVING n_events >= 10
        AND total_notional >= 5000
        AND n_trades >= 20
    `;

    try {
      const result = await ch.query({ query, format: 'JSONEachRow' });
      const batchCandidates = await result.json() as CandidateWallet[];
      allCandidates.push(...batchCandidates);
    } catch (err) {
      console.log(`  Batch ${batchNum} error: ${(err as Error).message.slice(0, 80)}`);
    }
  }

  // Sort by notional and take top 2000
  const candidates = allCandidates
    .sort((a, b) => b.total_notional - a.total_notional)
    .slice(0, 2000);

  console.log(`Found ${candidates.length} candidate wallets\n`);

  // Display top 20
  console.log('Top 20 by Volume:');
  console.log('Wallet                                     | Trades | Events | Notional    | Last Trade');
  console.log('-------------------------------------------|--------|--------|-------------|------------------');
  for (const c of candidates.slice(0, 20)) {
    console.log(
      `${c.wallet} | ${String(c.n_trades).padStart(6)} | ${String(c.n_events).padStart(6)} | $${Number(c.total_notional).toLocaleString().padStart(10)} | ${c.last_trade.slice(0, 16)}`
    );
  }

  // Summary stats
  const totalNotional = candidates.reduce((sum, c) => sum + c.total_notional, 0);
  const avgEvents = candidates.reduce((sum, c) => sum + c.n_events, 0) / candidates.length;
  const avgTrades = candidates.reduce((sum, c) => sum + c.n_trades, 0) / candidates.length;

  console.log(`\nSummary:`);
  console.log(`  Total candidates: ${candidates.length}`);
  console.log(`  Total notional: $${totalNotional.toLocaleString()}`);
  console.log(`  Avg events/wallet: ${avgEvents.toFixed(1)}`);
  console.log(`  Avg trades/wallet: ${avgTrades.toFixed(1)}`);

  // Save intermediate output
  const outputPath = 'exports/copytrade/phase1_candidates.json';
  fs.mkdirSync('exports/copytrade', { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    phase: 1,
    description: 'Unbiased candidate universe from pm_unified_ledger_v6',
    filters: {
      n_events: '>= 10',
      total_notional: '>= $5,000',
      n_trades: '>= 20',
      last_active: 'within 14 days',
    },
    count: candidates.length,
    wallets: candidates,
  }, null, 2));
  console.log(`\nSaved to: ${outputPath}`);

  return candidates;
}

async function main() {
  try {
    await buildCandidateUniverse();
  } finally {
    await ch.close();
  }
}

if (require.main === module) {
  main().catch(console.error);
}
