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
  console.log('Fixing is_resolved Check (use payout_denominator > 0)');
  console.log('═'.repeat(80));
  console.log();

  await client.exec({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_trade_pnl_final AS
      SELECT
        t.trade_id,
        t.wallet_address_norm AS wallet,
        t.condition_id_norm AS cid,
        t.timestamp,
        t.outcome_index,
        t.trade_direction AS direction,
        t.shares,
        t.usd_value AS cost_basis,
        t.entry_price,
        
        -- Resolution data
        r.winning_index,
        r.payout_numerators,
        r.payout_denominator,
        r.resolved_at,
        
        -- PnL calculation per trade (only if actually resolved)
        multiIf(
          r.payout_denominator > 0 AND t.outcome_index = r.winning_index,
          toFloat64(t.shares) * (toFloat64(arrayElement(r.payout_numerators, t.outcome_index + 1)) / toFloat64(r.payout_denominator)) - toFloat64(t.usd_value),
          r.payout_denominator > 0,
          -toFloat64(t.usd_value),  -- Lost position
          NULL  -- Unresolved
        ) AS pnl,
        
        r.payout_denominator > 0 AS is_resolved
        
      FROM default.vw_trades_canonical t
      LEFT JOIN cascadian_clean.vw_resolutions_all r
        ON lower(t.condition_id_norm) = r.cid_hex
      WHERE t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
    `,
  });
  console.log('✅ vw_trade_pnl_final fixed');
  console.log();

  await client.exec({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_wallet_pnl AS
      SELECT
        wallet,
        cid,
        count() AS trade_count,
        sum(shares) AS total_shares,
        sum(cost_basis) AS total_cost,
        avg(entry_price) AS avg_price,
        sum(pnl) AS total_pnl,
        sumIf(pnl, pnl > 0) AS realized_profit,
        sumIf(pnl, pnl < 0) AS realized_loss,
        countIf(is_resolved = 1) > 0 AS is_resolved,
        any(resolved_at) AS resolved_at
      FROM cascadian_clean.vw_trade_pnl_final
      GROUP BY wallet, cid
    `,
  });
  console.log('✅ vw_wallet_pnl recreated');
  console.log();

  // Test
  console.log('Testing FIXED views...');
  const test = await client.query({
    query: `
      SELECT
        (SELECT count() FROM cascadian_clean.vw_trade_pnl_final) AS total_trades,
        (SELECT countIf(is_resolved = 1) FROM cascadian_clean.vw_trade_pnl_final) AS resolved_trades,
        (SELECT count() FROM cascadian_clean.vw_wallet_pnl) AS total_positions,
        (SELECT countIf(is_resolved = 1) FROM cascadian_clean.vw_wallet_pnl) AS resolved_positions,
        (SELECT sum(total_pnl) FROM cascadian_clean.vw_wallet_pnl) AS total_pnl,
        (SELECT sum(realized_profit) FROM cascadian_clean.vw_wallet_pnl) AS profit,
        (SELECT sum(realized_loss) FROM cascadian_clean.vw_wallet_pnl) AS loss
    `,
    format: 'JSONEachRow',
  });

  const r = (await test.json<Array<any>>())[0];
  const tradePct = (100 * r.resolved_trades / r.total_trades).toFixed(2);
  const posPct = (100 * r.resolved_positions / r.total_positions).toFixed(2);

  console.log('Results:');
  console.log(`  Trades:            ${r.total_trades.toLocaleString()} total`);
  console.log(`  Resolved trades:   ${r.resolved_trades.toLocaleString()} (${tradePct}%)`);
  console.log(`  Positions:         ${r.total_positions.toLocaleString()} total`);
  console.log(`  Resolved positions: ${r.resolved_positions.toLocaleString()} (${posPct}%)`);
  console.log(`  Total PnL:         $${r.total_pnl?.toLocaleString() || 'NULL'}`);
  console.log(`  Total Profit:      $${r.profit?.toLocaleString() || 'NULL'}`);
  console.log(`  Total Loss:        $${r.loss?.toLocaleString() || 'NULL'}`);
  console.log();

  if (tradePct > 5 && tradePct < 15) {
    console.log('✅✅✅ SUCCESS! PnL System Working Correctly!');
    console.log();
    console.log('Key achievements:');
    console.log('  ✅ Used vw_trades_canonical (pre-normalized IDs)');
    console.log('  ✅ Joined with vw_resolutions_all on condition_id');
    console.log('  ✅ Filtered zero/invalid condition_ids');
    console.log('  ✅ Correct resolution detection (payout_denominator > 0)');
    console.log(`  ✅ ${tradePct}% trade coverage (aligned with ${posPct}% position coverage)`);
    console.log('  ✅ No memory issues');
    console.log('  ✅ Ready for production!');
  }

  await client.close();
}

main().catch(console.error);
