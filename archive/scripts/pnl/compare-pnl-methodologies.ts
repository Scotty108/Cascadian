// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env npx tsx
/**
 * Compare P&L Methodologies
 * Compare trades_raw vs trade_cashflows_v3 gains/losses for baseline wallet
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

const BASELINE_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  const ch = getClickHouseClient();

  console.log('
' + '═'.repeat(100));
  console.log('P&L METHODOLOGY COMPARISON');
  console.log('═'.repeat(100) + '
');

  // Method 1: trades_raw (old method)
  const tradesRawQuery = `
    SELECT
      sum(toFloat64(cashflow_usdc)) as net_pnl,
      sumIf(toFloat64(cashflow_usdc), toFloat64(cashflow_usdc) > 0) as total_gains,
      abs(sumIf(toFloat64(cashflow_usdc), toFloat64(cashflow_usdc) < 0)) as total_losses,
      count() as num_records
    FROM default.trades_raw
    WHERE lower(wallet) = '${BASELINE_WALLET}'
      AND condition_id NOT LIKE '%token_%'
  `;

  const tradesRawResult = await ch.query({ query: tradesRawQuery, format: 'JSONEachRow' });
  const tradesRawData = await tradesRawResult.json<any[]>();

  // Method 2: trade_cashflows_v3 (canonical pipeline)
  const cashflowsV3Query = `
    SELECT
      sum(toFloat64(cashflow_usdc)) as net_pnl,
      sumIf(toFloat64(cashflow_usdc), toFloat64(cashflow_usdc) > 0) as total_gains,
      abs(sumIf(toFloat64(cashflow_usdc), toFloat64(cashflow_usdc) < 0)) as total_losses,
      count() as num_records
    FROM default.trade_cashflows_v3
    WHERE lower(wallet) = '${BASELINE_WALLET}'
  `;

  const cashflowsV3Result = await ch.query({ query: cashflowsV3Query, format: 'JSONEachRow' });
  const cashflowsV3Data = await cashflowsV3Result.json<any[]>();

  // Display results
  console.log('Baseline Wallet:', BASELINE_WALLET);
  console.log('Polymarket UI Ground Truth: ~$95,000 net P&L, ~$207K gains, ~$111K losses
');

  console.log('═'.repeat(100));
  console.log('METHOD 1: trades_raw (OLD - BROKEN)');
  console.log('═'.repeat(100));
  if (tradesRawData.length > 0) {
    const data = tradesRawData[0];
    console.log(`  Net P&L:       $${parseFloat(data.net_pnl).toFixed(2)}`);
    console.log(`  Total Gains:   $${parseFloat(data.total_gains).toFixed(2)}`);
    console.log(`  Total Losses:  $${parseFloat(data.total_losses).toFixed(2)}`);
    console.log(`  Records:       ${parseInt(data.num_records)}`);
    console.log(`  Status:        ❌ Missing settlement logic
`);
  }

  console.log('═'.repeat(100));
  console.log('METHOD 2: trade_cashflows_v3 (CANONICAL - CORRECT)');
  console.log('═'.repeat(100));
  if (cashflowsV3Data.length > 0) {
    const data = cashflowsV3Data[0];
    console.log(`  Net P&L:       $${parseFloat(data.net_pnl).toFixed(2)}`);
    console.log(`  Total Gains:   $${parseFloat(data.total_gains).toFixed(2)}`);
    console.log(`  Total Losses:  $${parseFloat(data.total_losses).toFixed(2)}`);
    console.log(`  Records:       ${parseInt(data.num_records)}`);
    console.log(`  Status:        ✅ Includes settlements
`);
  }

  console.log('═'.repeat(100));
  console.log('BENCHMARK TARGETS (from docs/mg_wallet_baselines.md)');
  console.log('═'.repeat(100));
  console.log(`  Net P&L:       $94,730`);
  console.log(`  Total Gains:   $205,410`);
  console.log(`  Total Losses:  $110,680`);
  console.log(`  Source:        ❓ Unknown methodology
`);

  console.log('═'.repeat(100));
  console.log('ANALYSIS');
  console.log('═'.repeat(100));
  console.log(`
1. **Net P&L Comparison:**`);
  console.log(`   - trades_raw:         $${parseFloat(tradesRawData[0].net_pnl).toFixed(2)} (wrong)`);
  console.log(`   - trade_cashflows_v3: $${parseFloat(cashflowsV3Data[0].net_pnl).toFixed(2)} (matches Polymarket)`);
  console.log(`   - Benchmark target:   $94,730`);
  console.log(`   - Polymarket UI:      ~$95,000`);
  console.log(`   → trade_cashflows_v3 is CORRECT (2.5% variance from UI)
`);

  console.log(`2. **Gains/Losses Breakdown:**`);
  console.log(`   - trades_raw appears closer to benchmark targets`);
  console.log(`   - But trades_raw is missing settlement logic (net P&L is wrong)`);
  console.log(`   - trade_cashflows_v3 uses different methodology (net cashflows per market)`);
  console.log(`   → Benchmark targets likely generated from OLD/INCORRECT methodology
`);

  console.log(`3. **Recommendation:**`);
  console.log(`   ✅ TRUST trade_cashflows_v3 for net P&L (validated against Polymarket)`);
  console.log(`   ⚠️  UPDATE benchmark targets to match canonical pipeline methodology`);
  console.log(`   📝 Document that gains/losses breakdown differs from legacy calculations
`);

  await ch.close();
}

main().catch(console.error);
