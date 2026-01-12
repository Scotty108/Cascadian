/**
 * Batch test V37 on diverse wallet set
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';
import { calculatePnlV37 } from './pnl-v37';

interface TestResult {
  wallet: string;
  tradeCount: number;
  unmappedCount: number;
  calculated: number;
  api: number | null;
  diff: number | null;
  pctDiff: number | null;
  status: 'match' | 'close' | 'off' | 'no_api';
}

async function main() {
  const testWallets = process.argv.slice(2);

  let wallets: { trader_wallet: string; trade_count: number }[] = [];

  if (testWallets.length > 0) {
    // Use provided wallets
    wallets = testWallets.map(w => ({ trader_wallet: w, trade_count: 0 }));
  } else {
    // Get random wallets with different trade counts
    const result = await clickhouse.query({
      query: `
        WITH wallet_stats AS (
          SELECT trader_wallet, count() as trade_count
          FROM pm_trader_events_v3
          GROUP BY trader_wallet
        )
        SELECT trader_wallet, trade_count
        FROM wallet_stats
        WHERE trade_count BETWEEN 50 AND 500
        ORDER BY rand()
        LIMIT 30
      `,
      format: 'JSONEachRow',
    });
    wallets = await result.json() as any[];
  }

  console.log(`\nTesting V37 on ${wallets.length} wallets...\n`);
  console.log('Wallet                      | Trades | Unmapped | Calculated | API        | Diff     | Status');
  console.log('-'.repeat(100));

  const results: TestResult[] = [];

  for (const row of wallets) {
    const wallet = row.trader_wallet;
    if (!wallet) continue;

    try {
      const pnl = await calculatePnlV37(wallet);

      let status: TestResult['status'] = 'no_api';
      let diff: number | null = null;
      let pctDiff: number | null = null;

      if (pnl.api !== null) {
        diff = pnl.totalExclResolved - pnl.api;
        pctDiff = (diff / Math.abs(pnl.api || 1)) * 100;

        if (Math.abs(pctDiff) < 5) {
          status = 'match';
        } else if (Math.abs(pctDiff) < 20) {
          status = 'close';
        } else {
          status = 'off';
        }
      }

      const statusEmoji = {
        match: '✅',
        close: '⚠️',
        off: '❌',
        no_api: '⏸️',
      }[status];

      console.log(
        `${wallet.substring(0, 26)}... | ${pnl.tradeCount.toString().padStart(5)} | ${pnl.unmappedTradeCount.toString().padStart(7)} | $${pnl.totalExclResolved.toFixed(2).padStart(9)} | $${(pnl.api?.toFixed(2) || 'N/A').padStart(9)} | $${(diff?.toFixed(2) || 'N/A').padStart(7)} | ${statusEmoji}`
      );

      results.push({
        wallet,
        tradeCount: pnl.tradeCount,
        unmappedCount: pnl.unmappedTradeCount,
        calculated: pnl.totalExclResolved,
        api: pnl.api,
        diff,
        pctDiff,
        status,
      });
    } catch (error) {
      console.log(`${wallet.substring(0, 26)}... | ERROR: ${error}`);
    }
  }

  // Summary
  console.log('-'.repeat(100));
  console.log('\nSummary:');

  const withApi = results.filter(r => r.status !== 'no_api');
  const matches = results.filter(r => r.status === 'match').length;
  const close = results.filter(r => r.status === 'close').length;
  const off = results.filter(r => r.status === 'off').length;

  console.log(`  Total tested: ${results.length}`);
  console.log(`  With API data: ${withApi.length}`);
  console.log(`  ✅ Within 5%: ${matches} (${((matches / withApi.length) * 100).toFixed(1)}%)`);
  console.log(`  ⚠️ Within 20%: ${close}`);
  console.log(`  ❌ Off by >20%: ${off}`);

  const totalUnmapped = results.reduce((sum, r) => sum + r.unmappedCount, 0);
  if (totalUnmapped > 0) {
    console.log(`\n  ⚠️ Total unmapped trades across all wallets: ${totalUnmapped}`);
  }

  process.exit(0);
}

main().catch(console.error);
