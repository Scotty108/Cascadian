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
  console.log('Debugging PnL Calculations\n');

  // Check sample resolved trades
  console.log('Sample resolved trades with PnL:');
  console.log('─'.repeat(80));
  const sample = await client.query({
    query: `
      SELECT
        trade_id,
        left(wallet_address_norm, 10) AS wallet,
        left(condition_id_norm, 10) AS cid,
        outcome_index,
        shares,
        cost_basis,
        winning_index,
        payout_numerators,
        payout_denominator,
        trade_pnl,
        is_resolved
      FROM cascadian_clean.vw_trade_pnl
      WHERE is_resolved = 1
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });

  const trades = await sample.json();
  trades.forEach((t: any) => {
    const won = t.outcome_index === t.winning_index;
    const payout = won ? t.payout_numerators[t.outcome_index] : 0;
    console.log(`${won ? '✅ WIN' : '❌ LOSS'} | outcome=${t.outcome_index} winner=${t.winning_index} | shares=${t.shares} cost=$${t.cost_basis} | payout=${payout}/${t.payout_denominator} | PnL=$${t.trade_pnl?.toFixed(2) || 'NULL'}`);
  });
  console.log();

  // Check resolution coverage
  console.log('Resolution Coverage:');
  console.log('─'.repeat(80));
  const coverage = await client.query({
    query: `
      SELECT
        count() AS total_trades,
        countIf(is_resolved = 1) AS resolved_trades,
        round(100.0 * countIf(is_resolved = 1) / count(), 2) AS resolved_pct,
        count(DISTINCT condition_id_norm) AS unique_markets,
        countIf(is_resolved = 1, DISTINCT condition_id_norm) AS resolved_markets
      FROM cascadian_clean.vw_trade_pnl
    `,
    format: 'JSONEachRow',
  });

  const cov = (await coverage.json<Array<any>>())[0];
  console.log(`  Total trades:        ${cov.total_trades.toLocaleString()}`);
  console.log(`  Resolved trades:     ${cov.resolved_trades.toLocaleString()} (${cov.resolved_pct}%)`);
  console.log(`  Unique markets:      ${cov.unique_markets.toLocaleString()}`);
  console.log(`  Resolved markets:    ${cov.resolved_markets.toLocaleString()}`);
  console.log();

  // Check for the -$28B issue
  console.log('Checking for outliers:');
  console.log('─'.repeat(80));
  const outliers = await client.query({
    query: `
      SELECT
        count() AS trades_with_huge_loss,
        sum(trade_pnl) AS total_huge_loss
      FROM cascadian_clean.vw_trade_pnl
      WHERE trade_pnl < -1000000
    `,
    format: 'JSONEachRow',
  });

  const out = (await outliers.json<Array<any>>())[0];
  console.log(`  Trades with PnL < -$1M: ${out.trades_with_huge_loss.toLocaleString()}`);
  console.log(`  Total loss from these: $${out.total_huge_loss?.toLocaleString()}`);
  console.log();

  if (out.trades_with_huge_loss > 0) {
    console.log('Sample huge loss trades:');
    const hugeLosses = await client.query({
      query: `
        SELECT
          left(condition_id_norm, 10) AS cid,
          shares,
          cost_basis,
          winning_index,
          outcome_index,
          payout_numerators,
          trade_pnl
        FROM cascadian_clean.vw_trade_pnl
        WHERE trade_pnl < -1000000
        LIMIT 5
      `,
      format: 'JSONEachRow',
    });

    const losses = await hugeLosses.json();
    losses.forEach((l: any) => {
      console.log(`  CID=${l.cid} | shares=${l.shares} cost=$${l.cost_basis} | outcome=${l.outcome_index} winner=${l.winning_index} | PnL=$${l.trade_pnl?.toLocaleString()}`);
    });
  }

  await client.close();
}

main().catch(console.error);
