/**
 * Golden Wallet Scorer
 *
 * Scores eligible wallets and streams high-scorers (score > 1.0) to ClickHouse.
 *
 * Filters:
 * - No ERC1155 transfers
 * - Active last 14 days
 * - Over 15 markets (>30 tokens)
 * - Over $20K volume
 *
 * Streams wallets with score > 1.0 to pm_golden_wallets_v1 as they're found.
 *
 * Usage:
 *   npx tsx scripts/leaderboard/score-golden-wallets.ts
 *   npx tsx scripts/leaderboard/score-golden-wallets.ts --min-score 0.5 --workers 10
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient, ClickHouseClient } from '@clickhouse/client';
import { computeCCRv1 } from '../../lib/pnl/ccrEngineV1';
import { ccrToWalletScore, WalletScore } from '../../lib/leaderboard/scoring';

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (name: string, def: number) => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? parseFloat(args[idx + 1]) : def;
};

const MIN_SCORE = getArg('min-score', 1.0);
const WORKERS = getArg('workers', 8); // 8 is safe for ClickHouse

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 300000, // 5 min timeout
});

async function getEligibleWallets(): Promise<string[]> {
  console.log('Loading eligible wallets...\n');

  // Get ERC1155 recipients to exclude
  const q1 = 'SELECT DISTINCT lower(to_address) as wallet FROM pm_erc1155_transfers';
  const r1 = await client.query({
    query: q1,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300 }
  });
  const ercSet = new Set((await r1.json() as any[]).map(r => r.wallet));
  console.log(`  ERC1155 wallets to exclude: ${ercSet.size.toLocaleString()}`);

  // Query with filters: 14 days, >15 markets (>30 tokens), >$20K volume
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const q2 = `
    SELECT
      lower(trader_wallet) as wallet,
      countDistinct(token_id) as token_count,
      sum(usdc_amount) / 1e6 as volume_usdc
    FROM pm_trader_events_v2
    WHERE is_deleted = 0
      AND trade_time >= '${fourteenDaysAgo}'
    GROUP BY lower(trader_wallet)
    HAVING countDistinct(token_id) > 30
      AND sum(usdc_amount) / 1e6 > 20000
  `;

  const r2 = await client.query({
    query: q2,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300 }
  });
  const traders = await r2.json() as any[];
  console.log(`  Active traders matching criteria: ${traders.length.toLocaleString()}`);

  // Filter out ERC1155 recipients
  const eligible = traders
    .filter(t => !ercSet.has(t.wallet))
    .map(t => t.wallet);

  console.log(`  ✅ Eligible (no ERC1155): ${eligible.length.toLocaleString()}\n`);

  return eligible;
}

async function insertGoldenWallet(score: WalletScore): Promise<void> {
  await client.insert({
    table: 'pm_golden_wallets_v1',
    values: [{
      wallet: score.wallet,
      score: score.score,
      mu: score.mu,
      M: score.M,
      win_rate: score.win_rate,
      realized_pnl: score.realized_pnl,
      num_trades: score.num_trades,
      positions_count: score.positions_count,
      resolved_count: score.resolved_count,
      volume_traded: score.volume_traded,
    }],
    format: 'JSONEachRow',
  });
}

async function scoreWallet(wallet: string): Promise<WalletScore | null> {
  try {
    const metrics = await computeCCRv1(wallet);
    return ccrToWalletScore(metrics);
  } catch (e: any) {
    // Skip wallets that error (system contracts, no trades, etc.)
    return null;
  }
}

async function main() {
  console.log('═'.repeat(60));
  console.log('GOLDEN WALLET SCORER');
  console.log(`Streaming wallets with score > ${MIN_SCORE} to pm_golden_wallets_v1`);
  console.log('═'.repeat(60) + '\n');

  // Get eligible wallets
  const wallets = await getEligibleWallets();

  if (wallets.length === 0) {
    console.log('No eligible wallets found!');
    await client.close();
    return;
  }

  const total = wallets.length;
  let completed = 0;
  let errors = 0;
  let goldenCount = 0;
  let idx = 0;

  const startTime = Date.now();

  // Worker function
  async function processNext(): Promise<void> {
    while (idx < wallets.length) {
      const myIdx = idx++;
      const wallet = wallets[myIdx];

      const score = await scoreWallet(wallet);
      completed++;

      if (score === null) {
        errors++;
      } else if (score.score >= MIN_SCORE) {
        goldenCount++;
        await insertGoldenWallet(score);
        console.log(`\n🌟 GOLDEN #${goldenCount}: ${wallet.slice(0, 10)}... | Score: ${score.score.toFixed(4)} | μ: ${(score.mu * 100).toFixed(1)}% | PnL: $${score.realized_pnl.toLocaleString()}`);
      }

      // Progress update every 10 wallets
      if (completed % 10 === 0 || completed === total) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = completed / elapsed;
        const remaining = total - completed;
        const eta = remaining / rate;

        const etaStr = eta > 3600
          ? `${Math.floor(eta / 3600)}h ${Math.floor((eta % 3600) / 60)}m`
          : eta > 60
            ? `${Math.floor(eta / 60)}m ${Math.floor(eta % 60)}s`
            : `${Math.floor(eta)}s`;

        const pct = ((completed / total) * 100).toFixed(1);
        process.stdout.write(`\rProgress: ${completed}/${total} (${pct}%) | Rate: ${rate.toFixed(2)}/sec | Golden: ${goldenCount} | Errors: ${errors} | ETA: ${etaStr}    `);
      }
    }
  }

  // Launch workers
  console.log(`Starting ${WORKERS} workers...\n`);
  const workers = Array(WORKERS).fill(null).map(() => processNext());
  await Promise.all(workers);

  // Final summary
  const totalTime = (Date.now() - startTime) / 1000;
  console.log('\n\n' + '═'.repeat(60));
  console.log('COMPLETE');
  console.log('═'.repeat(60));
  console.log(`Total wallets scored: ${completed.toLocaleString()}`);
  console.log(`Golden wallets found: ${goldenCount}`);
  console.log(`Errors: ${errors}`);
  console.log(`Time: ${Math.floor(totalTime / 60)}m ${Math.floor(totalTime % 60)}s`);
  console.log(`\nQuery golden wallets: SELECT * FROM pm_golden_wallets_v1 ORDER BY score DESC`);

  await client.close();
}

main().catch(console.error);
