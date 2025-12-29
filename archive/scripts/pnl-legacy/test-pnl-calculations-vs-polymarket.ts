#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

/**
 * P&L CALCULATION TEST
 *
 * Compare our P&L calculations to Polymarket's official numbers
 * for multiple wallets to identify the calculation difference
 */

const wallets = [
  { address: '0x1489046ca0f9980fc2d9a950d103d3bec02c1307', pm_pnl: 137663, pm_gains: 145976, pm_losses: 8313 },
  { address: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4', pm_pnl: 360492, pm_gains: 366546, pm_losses: 6054 },
  { address: '0x4ce73141dbfce41e65db3723e31059a730f0abad', pm_pnl: 332563, pm_gains: 333508, pm_losses: 945 },
  { address: '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144', pm_pnl: 114087, pm_gains: 118922, pm_losses: 4835 },
];

async function testPnLCalculations() {
  console.log('P&L CALCULATION COMPARISON TEST');
  console.log('═'.repeat(100));
  console.log();

  for (const wallet of wallets) {
    console.log('Wallet:', wallet.address.slice(0, 10) + '...' + wallet.address.slice(-8));
    console.log('─'.repeat(100));
    console.log();

    // Calculate P&L using our formula
    const pnl = await client.query({
      query: `
        WITH position_pnl AS (
          SELECT
            t.condition_id_norm,
            t.market_id_norm,
            sum(CASE WHEN t.trade_direction = 'BUY' THEN t.shares ELSE -t.shares END) as net_shares,
            sum(CASE WHEN t.trade_direction = 'BUY' THEN t.usd_value ELSE -t.usd_value END) as cost_basis,
            any(t.outcome_index) as outcome_index
          FROM default.vw_trades_canonical t
          WHERE lower(t.wallet_address_norm) = lower('${wallet.address}')
            AND t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          GROUP BY t.condition_id_norm, t.market_id_norm
        ),
        resolved_pnl AS (
          SELECT
            p.condition_id_norm,
            p.market_id_norm,
            toFloat64(p.net_shares) as net_shares,
            toFloat64(p.cost_basis) as cost_basis,
            p.outcome_index,
            r.winning_index,
            r.payout_numerators,
            r.payout_denominator,
            -- Our P&L calculation
            (toFloat64(p.net_shares) * toFloat64(arrayElement(r.payout_numerators, p.outcome_index + 1)) / toFloat64(r.payout_denominator)) - toFloat64(p.cost_basis) as pnl_usd
          FROM position_pnl p
          INNER JOIN cascadian_clean.vw_resolutions_unified r
            ON lower(p.condition_id_norm) = r.cid_hex
          WHERE r.payout_denominator > 0
        )
        SELECT
          count() as num_positions,
          sum(CASE WHEN pnl_usd > 0 THEN pnl_usd ELSE 0 END) as total_gains,
          sum(CASE WHEN pnl_usd < 0 THEN pnl_usd ELSE 0 END) as total_losses,
          sum(pnl_usd) as net_pnl
        FROM resolved_pnl
      `,
      format: 'JSONEachRow',
    });

    const result = (await pnl.json<any[]>())[0];

    const ourGains = parseFloat(result.total_gains);
    const ourLosses = Math.abs(parseFloat(result.total_losses));
    const ourNet = parseFloat(result.net_pnl);

    console.log('Polymarket Official:');
    console.log(`  Gains:  $${wallet.pm_gains.toLocaleString()}`);
    console.log(`  Losses: $${wallet.pm_losses.toLocaleString()}`);
    console.log(`  Net:    $${wallet.pm_pnl.toLocaleString()}`);
    console.log();

    console.log('Our Calculation:');
    console.log(`  Gains:  $${ourGains.toLocaleString('en-US', {maximumFractionDigits: 0})}`);
    console.log(`  Losses: $${ourLosses.toLocaleString('en-US', {maximumFractionDigits: 0})}`);
    console.log(`  Net:    $${ourNet.toLocaleString('en-US', {maximumFractionDigits: 0})}`);
    console.log();

    const gainsRatio = (ourGains / wallet.pm_gains).toFixed(2);
    const lossesRatio = (ourLosses / wallet.pm_losses).toFixed(2);
    const netRatio = (ourNet / wallet.pm_pnl).toFixed(2);

    console.log('Ratio (Our / PM):');
    console.log(`  Gains:  ${gainsRatio}x`);
    console.log(`  Losses: ${lossesRatio}x`);
    console.log(`  Net:    ${netRatio}x`);
    console.log();

    if (parseFloat(netRatio) >= 0.95 && parseFloat(netRatio) <= 1.05) {
      console.log('✅ MATCH! P&L within 5%');
    } else if (parseFloat(netRatio) >= 0.8 && parseFloat(netRatio) <= 1.2) {
      console.log('⚠️  CLOSE - P&L within 20%');
    } else {
      console.log('❌ MISMATCH - Significant difference');
    }

    console.log();
    console.log('═'.repeat(100));
    console.log();
  }

  console.log('PATTERN ANALYSIS');
  console.log('═'.repeat(100));
  console.log();
  console.log('Looking for consistent ratios across wallets...');
  console.log('If all wallets show similar ratio (e.g., all 10x), it indicates systematic methodology difference');
  console.log('If ratios vary wildly, it indicates data quality issues or random errors');
  console.log();

  await client.close();
}

testPnLCalculations().catch(console.error);
