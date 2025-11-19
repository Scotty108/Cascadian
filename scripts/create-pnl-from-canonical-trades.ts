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
  console.log('Creating PnL View from vw_trades_canonical + vw_resolutions_all');
  console.log('═'.repeat(80));
  console.log();

  console.log('Creating cascadian_clean.vw_trade_pnl (per-trade PnL)...');
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
        ON lower(concat('0x', t.condition_id_norm)) = r.cid_hex
    `,
  });
  console.log('✅ vw_trade_pnl created');
  console.log();

  console.log('Creating cascadian_clean.vw_wallet_pnl_fast (aggregated by wallet)...');
  await client.exec({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_wallet_pnl_fast AS
      SELECT
        wallet_address_norm AS wallet,
        condition_id_norm,
        lower(concat('0x', condition_id_norm)) AS cid_hex,
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
  console.log('✅ vw_wallet_pnl_fast created');
  console.log();

  // Test the new view
  console.log('Testing vw_wallet_pnl_fast...');
  const test = await client.query({
    query: `
      SELECT
        count(DISTINCT wallet) AS total_wallets,
        count() AS total_positions,
        countIf(is_resolved = 1) AS resolved_positions,
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
  console.log(`  Resolved:           ${result.resolved_positions.toLocaleString()}`);
  console.log(`  Total PnL:          $${result.grand_total_pnl?.toLocaleString() || 'NULL'}`);
  console.log(`  Total Profit:       $${result.total_profit?.toLocaleString() || 'NULL'}`);
  console.log(`  Total Loss:         $${result.total_loss?.toLocaleString() || 'NULL'}`);
  console.log();

  if (result.resolved_positions > 0) {
    console.log('✅ SUCCESS! PnL calculations working with vw_trades_canonical approach');
    console.log();
    console.log('Benefits:');
    console.log('  - Uses pre-existing vw_trades_canonical (already has normalized IDs)');
    console.log('  - Per-trade PnL calculation (easier to debug)');
    console.log('  - Aggregation only at view query time (not materialized)');
    console.log('  - Should be much faster than fact_trades_clean aggregation');
  }

  await client.close();
}

main().catch(console.error);
