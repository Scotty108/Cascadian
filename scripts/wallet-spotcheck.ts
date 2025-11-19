#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';
import { writeFileSync, mkdirSync } from 'fs';

const ch = getClickHouseClient();

const WALLETS = [
  '0x2e0b70d482e6b389e81dea528be57d825dd48070',
  '0x662244931c392df70bd064fa91f838eea0bfd7a9',
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', // baseline
  '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
  '0xd06f0f7719df1b3b75b607923536b3250825d4a6',
];

interface WalletSpotcheck {
  wallet: string;
  is_baseline: boolean;
  our_vw_trades_canonical: number;
  our_fact_trades_clean: number;
  our_trade_direction_assignments: number;
  our_total_unique_tables: number;
  our_realized_pnl: number | null;
  our_gross_gains: number | null;
  our_gross_losses: number | null;
  polymarket_url: string;
  polymarket_pnl: number | null;
  polymarket_predictions: number | null;
  delta_pnl: number | null;
  delta_pct: number | null;
  screenshot_path: string | null;
  notes: string;
}

async function queryWalletData(wallet: string): Promise<{
  vw_trades: number;
  fact_trades: number;
  trade_dir: number;
  realized_pnl: number | null;
  gross_gains: number | null;
  gross_losses: number | null;
}> {
  console.log(`\n📊 Querying ClickHouse for ${wallet.substring(0, 10)}...`);

  // Query vw_trades_canonical
  const vwQ = await ch.query({
    query: `
      SELECT count() as cnt
      FROM default.vw_trades_canonical
      WHERE lower(wallet_address_norm) = lower('${wallet}')
    `,
  });
  const vwResult = await vwQ.json();
  const vw_trades = vwResult.data[0]?.cnt || 0;

  // Query fact_trades_clean
  const factQ = await ch.query({
    query: `
      SELECT count() as cnt
      FROM cascadian_clean.fact_trades_clean
      WHERE lower(wallet_address) = lower('${wallet}')
    `,
  });
  const factResult = await factQ.json();
  const fact_trades = factResult.data[0]?.cnt || 0;

  // Query trade_direction_assignments
  const tdaQ = await ch.query({
    query: `
      SELECT count() as cnt
      FROM default.trade_direction_assignments
      WHERE lower(wallet_address) = lower('${wallet}')
    `,
  });
  const tdaResult = await tdaQ.json();
  const trade_dir = tdaResult.data[0]?.cnt || 0;

  // Query wallet_metrics for PnL
  let realized_pnl = null;
  let gross_gains = null;
  let gross_losses = null;

  try {
    const metricsQ = await ch.query({
      query: `
        SELECT
          realized_pnl,
          gross_gains_usd,
          gross_losses_usd
        FROM default.wallet_metrics
        WHERE lower(wallet_address) = lower('${wallet}')
          AND time_window = 'lifetime'
        LIMIT 1
      `,
    });
    const metricsResult = await metricsQ.json();
    if (metricsResult.data.length > 0) {
      realized_pnl = metricsResult.data[0].realized_pnl;
      gross_gains = metricsResult.data[0].gross_gains_usd;
      gross_losses = metricsResult.data[0].gross_losses_usd;
    }
  } catch (e) {
    console.log('   ⚠️  wallet_metrics query failed, trying trade_cashflows_v3...');
    // Fallback to trade_cashflows_v3
    try {
      const cashflowQ = await ch.query({
        query: `
          SELECT
            sum(toFloat64(cashflow_usdc)) as realized_pnl,
            sumIf(toFloat64(cashflow_usdc), toFloat64(cashflow_usdc) > 0) as gross_gains,
            abs(sumIf(toFloat64(cashflow_usdc), toFloat64(cashflow_usdc) < 0)) as gross_losses
          FROM default.trade_cashflows_v3
          WHERE lower(wallet) = lower('${wallet}')
        `,
      });
      const cashflowResult = await cashflowQ.json();
      if (cashflowResult.data.length > 0) {
        realized_pnl = cashflowResult.data[0].realized_pnl;
        gross_gains = cashflowResult.data[0].gross_gains;
        gross_losses = cashflowResult.data[0].gross_losses;
      }
    } catch (e2) {
      console.log('   ⚠️  trade_cashflows_v3 query also failed');
    }
  }

  console.log(`   vw_trades_canonical: ${vw_trades.toLocaleString()}`);
  console.log(`   fact_trades_clean: ${fact_trades.toLocaleString()}`);
  console.log(`   trade_direction_assignments: ${trade_dir.toLocaleString()}`);
  console.log(`   realized_pnl: $${realized_pnl?.toLocaleString() || 'N/A'}`);

  return {
    vw_trades,
    fact_trades,
    trade_dir,
    realized_pnl,
    gross_gains,
    gross_losses,
  };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('WALLET SPOT-CHECK: 5 Random Wallets');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('Goal: Determine if data gap is isolated or systemic');
  console.log(`Wallets to check: ${WALLETS.length}\n`);

  const results: WalletSpotcheck[] = [];

  for (let i = 0; i < WALLETS.length; i++) {
    const wallet = WALLETS[i];
    const isBaseline = wallet.toLowerCase() === '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

    console.log(`\n[${ i + 1}/${WALLETS.length}] Processing ${wallet}`);
    if (isBaseline) {
      console.log('   ⭐ This is the baseline wallet (already validated)');
    }

    const data = await queryWalletData(wallet);

    // Count unique tables with data
    const uniqueTables = [
      data.vw_trades > 0 ? 1 : 0,
      data.fact_trades > 0 ? 1 : 0,
      data.trade_dir > 0 ? 1 : 0,
    ].reduce((a, b) => a + b, 0);

    const result: WalletSpotcheck = {
      wallet,
      is_baseline: isBaseline,
      our_vw_trades_canonical: data.vw_trades,
      our_fact_trades_clean: data.fact_trades,
      our_trade_direction_assignments: data.trade_dir,
      our_total_unique_tables: uniqueTables,
      our_realized_pnl: data.realized_pnl,
      our_gross_gains: data.gross_gains,
      our_gross_losses: data.gross_losses,
      polymarket_url: `https://polymarket.com/wallet/${wallet}`,
      polymarket_pnl: null, // Will be filled by Playwright
      polymarket_predictions: null, // Will be filled by Playwright
      delta_pnl: null,
      delta_pct: null,
      screenshot_path: null,
      notes: '',
    };

    results.push(result);

    // Small delay between wallets
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Save intermediate results
  mkdirSync('tmp', { recursive: true });
  writeFileSync(
    'tmp/wallet-spotcheck.json',
    JSON.stringify(results, null, 2)
  );

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('PRELIMINARY RESULTS (ClickHouse only):\n');

  for (const result of results) {
    console.log(`${result.wallet}:`);
    console.log(`  vw_trades_canonical: ${result.our_vw_trades_canonical.toLocaleString()}`);
    console.log(`  fact_trades_clean: ${result.our_fact_trades_clean.toLocaleString()}`);
    console.log(`  trade_direction_assignments: ${result.our_trade_direction_assignments.toLocaleString()}`);
    console.log(`  realized_pnl: $${result.our_realized_pnl?.toLocaleString() || 'N/A'}`);
    console.log();
  }

  console.log('✅ ClickHouse queries complete');
  console.log('📄 Saved to: tmp/wallet-spotcheck.json');
  console.log('\n⏭️  Next: Run Playwright script to capture Polymarket UI data\n');

  console.log('═══════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
