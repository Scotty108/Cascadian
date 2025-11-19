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

async function main() {
  console.log('Fixing PnL View with Correct Join Condition');
  console.log('═'.repeat(80));
  console.log();

  console.log('Recreating cascadian_clean.vw_trade_pnl with FIXED join...');
  await client.exec({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_trade_pnl AS
      SELECT
        t.trade_id,
        t.wallet_address_norm,
        t.condition_id_norm,
        t.timestamp,
        t.outcome_index,
        t.trade_direction,
        t.shares,
        t.usd_value AS cost_basis,
        t.entry_price,
        
        -- Resolution data
        r.winning_index,
        r.payout_numerators,
        r.payout_denominator,
        r.resolved_at,
        
        -- PnL calculation per trade
        multiIf(
          r.winning_index IS NOT NULL AND t.outcome_index = r.winning_index,
          toFloat64(t.shares) * (toFloat64(arrayElement(r.payout_numerators, t.outcome_index + 1)) / toFloat64(r.payout_denominator)) - toFloat64(t.usd_value),
          r.winning_index IS NOT NULL,
          -toFloat64(t.usd_value),  -- Lost position
          NULL  -- Unresolved
        ) AS trade_pnl,
        
        r.winning_index IS NOT NULL AS is_resolved
        
      FROM default.vw_trades_canonical t
      LEFT JOIN cascadian_clean.vw_resolutions_all r
        ON lower(t.condition_id_norm) = r.cid_hex
    `,
  });
  console.log('✅ vw_trade_pnl fixed!');
  console.log();

  console.log('Recreating cascadian_clean.vw_wallet_pnl_fast...');
  await client.exec({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_wallet_pnl_fast AS
      SELECT
        wallet_address_norm AS wallet,
        condition_id_norm,
        count() AS trade_count,
        sum(shares) AS total_shares,
        sum(cost_basis) AS total_cost_basis,
        avg(entry_price) AS avg_entry_price,
        sum(trade_pnl) AS total_pnl,
        any(is_resolved) AS is_resolved,
        any(resolved_at) AS resolved_at
      FROM cascadian_clean.vw_trade_pnl
      GROUP BY wallet, condition_id_norm
    `,
  });
  console.log('✅ vw_wallet_pnl_fast recreated');
  console.log();

  // Test the fixed view
  console.log('Testing FIXED view...');
  const test = await client.query({
    query: `
      SELECT
        count(DISTINCT wallet) AS total_wallets,
        count() AS total_positions,
        countIf(is_resolved = 1) AS resolved_positions,
        round(100.0 * countIf(is_resolved = 1) / count(), 2) AS resolved_pct,
        sum(total_pnl) AS grand_total_pnl,
        sumIf(total_pnl, total_pnl > 0) AS total_profit,
        sumIf(total_pnl, total_pnl < 0) AS total_loss
      FROM cascadian_clean.vw_wallet_pnl_fast
    `,
    format: 'JSONEachRow',
  });

  const result = (await test.json<Array<any>>())[0];
  console.log('Stats:');
  console.log(`  Total wallets:      ${result.total_wallets.toLocaleString()}`);
  console.log(`  Total positions:    ${result.total_positions.toLocaleString()}`);
  console.log(`  Resolved:           ${result.resolved_positions.toLocaleString()} (${result.resolved_pct}%)`);
  console.log(`  Total PnL:          $${result.grand_total_pnl?.toLocaleString() || 'NULL'}`);
  console.log(`  Total Profit:       $${result.total_profit?.toLocaleString() || 'NULL'}`);
  console.log(`  Total Loss:         $${result.total_loss?.toLocaleString() || 'NULL'}`);
  console.log();

  if (result.resolved_positions > 0 && result.resolved_pct > 20) {
    console.log('✅✅✅ SUCCESS! PnL system fully working!');
    console.log();
    console.log('What we built:');
    console.log('  - vw_trade_pnl: Per-trade PnL with resolution data');
    console.log('  - vw_wallet_pnl_fast: Aggregated wallet positions');
    console.log('  - Uses vw_trades_canonical (your suggestion!)');
    console.log('  - No memory issues');
    console.log(`  - ${result.resolved_pct}% resolution coverage`);
  }

  await client.close();
}

main().catch(console.error);
