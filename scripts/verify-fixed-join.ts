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
  console.log('Verifying Fixed Join\n');

  // Check trade-level resolution coverage
  console.log('Trade-level coverage:');
  const tradeCov = await client.query({
    query: `
      SELECT
        count() AS total_trades,
        countIf(is_resolved = 1) AS resolved_trades,
        round(100.0 * countIf(is_resolved = 1) / count(), 2) AS pct
      FROM cascadian_clean.vw_trade_pnl
    `,
    format: 'JSONEachRow',
  });

  const tc = (await tradeCov.json<Array<any>>())[0];
  console.log(`  Total:    ${tc.total_trades.toLocaleString()}`);
  console.log(`  Resolved: ${tc.resolved_trades.toLocaleString()} (${tc.pct}%)`);
  console.log();

  // Sample winning trades
  console.log('Sample WINNING trades:');
  const winners = await client.query({
    query: `
      SELECT
        left(condition_id_norm, 10) AS cid,
        outcome_index,
        winning_index,
        shares,
        cost_basis,
        payout_numerators,
        payout_denominator,
        trade_pnl
      FROM cascadian_clean.vw_trade_pnl
      WHERE is_resolved = 1 AND outcome_index = winning_index
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });

  const w = await winners.json();
  w.forEach((t: any) => {
    const payout = t.payout_numerators[t.outcome_index];
    console.log(`  ✅ outcome=${t.outcome_index} winner=${t.winning_index} | shares=${t.shares} cost=$${t.cost_basis} | payout=${payout}/${t.payout_denominator} | PnL=$${t.trade_pnl?.toFixed(2)}`);
  });
  console.log();

  // Sample losing trades
  console.log('Sample LOSING trades:');
  const losers = await client.query({
    query: `
      SELECT
        left(condition_id_norm, 10) AS cid,
        outcome_index,
        winning_index,
        shares,
        cost_basis,
        payout_numerators,
        payout_denominator,
        trade_pnl
      FROM cascadian_clean.vw_trade_pnl
      WHERE is_resolved = 1 AND outcome_index != winning_index
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });

  const l = await losers.json();
  l.forEach((t: any) => {
    const payout = t.payout_numerators[t.outcome_index];
    console.log(`  ❌ outcome=${t.outcome_index} winner=${t.winning_index} | shares=${t.shares} cost=$${t.cost_basis} | payout=${payout}/${t.payout_denominator} | PnL=$${t.trade_pnl?.toFixed(2)}`);
  });
  console.log();

  // Check for huge losses
  console.log('Checking for outlier losses:');
  const outliers = await client.query({
    query: `
      SELECT
        left(condition_id_norm, 10) AS cid,
        outcome_index,
        winning_index,
        shares,
        cost_basis,
        trade_pnl
      FROM cascadian_clean.vw_trade_pnl
      WHERE trade_pnl < -100000
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });

  const out = await outliers.json();
  if (out.length > 0) {
    console.log('Found huge losses:');
    out.forEach((t: any) => {
      console.log(`  CID=${t.cid} | shares=${t.shares} cost=$${t.cost_basis} | PnL=$${t.trade_pnl?.toLocaleString()}`);
    });
  } else {
    console.log('  No outliers found (PnL < -$100K)');
  }

  await client.close();
}

main().catch(console.error);
