/**
 * Analyze auto-settlement breakdown by winner/loser status
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function main() {
  const wallet = '0xb744f56635b537e859152d14b022af5afe485210';

  console.log('=== Open Position Analysis for wasianiverson ===\n');

  // Get positions with resolution status
  const res = await client.query({
    query: `
      WITH wallet_positions AS (
        SELECT
          token_id,
          sum(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as net_tokens,
          sumIf(usdc, side = 'buy') as total_buy_usdc,
          sumIf(tokens, side = 'buy') as total_buy_tokens,
          sumIf(usdc, side = 'buy') / nullIf(sumIf(tokens, side = 'buy'), 0) as avg_buy_price
        FROM (
          SELECT event_id, any(token_id) as token_id, any(side) as side,
            any(usdc_amount)/1e6 as usdc, any(token_amount)/1e6 as tokens
          FROM pm_trader_events_dedup_v2_tbl
          WHERE lower(trader_wallet) = lower('${wallet}')
          GROUP BY event_id
        )
        GROUP BY token_id
        HAVING net_tokens > 100
      )
      SELECT
        CASE
          WHEN r.payout_numerators IS NULL OR r.payout_numerators = '' THEN 'UNRESOLVED'
          WHEN JSONExtractArrayRaw(r.payout_numerators)[toUInt32(m.outcome_index + 1)] != '0' THEN 'WINNER'
          ELSE 'LOSER'
        END as status,
        count() as position_count,
        sum(wp.net_tokens) as total_tokens,
        sum(wp.net_tokens * wp.avg_buy_price) as total_cost_basis,
        sum(
          CASE
            WHEN r.payout_numerators IS NULL OR r.payout_numerators = '' THEN 0
            WHEN JSONExtractArrayRaw(r.payout_numerators)[toUInt32(m.outcome_index + 1)] != '0'
              THEN wp.net_tokens * 1.0 - wp.net_tokens * wp.avg_buy_price
            ELSE 0 - wp.net_tokens * wp.avg_buy_price
          END
        ) as auto_settle_pnl
      FROM wallet_positions wp
      LEFT JOIN pm_token_to_condition_map_current m ON wp.token_id = m.token_id_dec
      LEFT JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
      GROUP BY status
    `,
    format: 'JSONEachRow'
  });
  const data = await res.json() as Array<{
    status: string;
    position_count: number;
    total_tokens: number;
    total_cost_basis: number;
    auto_settle_pnl: number;
  }>;

  console.log('Status     | Positions | Tokens          | Cost Basis     | Auto-Settle PnL');
  console.log('-'.repeat(85));

  let totalAutoSettle = 0;
  let totalCostBasis = 0;
  for (const row of data) {
    console.log(`${row.status.padEnd(10)} | ${String(row.position_count).padStart(9)} | ${Number(row.total_tokens).toLocaleString().padStart(15)} | $${Number(row.total_cost_basis).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(13)} | $${Number(row.auto_settle_pnl).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    if (row.status !== 'UNRESOLVED') {
      totalAutoSettle += Number(row.auto_settle_pnl);
    }
    totalCostBasis += Number(row.total_cost_basis);
  }
  console.log('-'.repeat(85));
  console.log('Total Auto-Settle PnL: $' + totalAutoSettle.toLocaleString());
  console.log('Total Cost Basis: $' + totalCostBasis.toLocaleString());
  console.log('');
  console.log('Expected from engine: $-27,360,221');
  console.log('UI PnL: $2,860,257');
  console.log('');

  // Check if there are large WINNER positions that should offset the losses
  console.log('=== WINNER Position Details ===');
  const winners = await client.query({
    query: `
      WITH wallet_positions AS (
        SELECT
          token_id,
          sum(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as net_tokens,
          sumIf(usdc, side = 'buy') / nullIf(sumIf(tokens, side = 'buy'), 0) as avg_buy_price
        FROM (
          SELECT event_id, any(token_id) as token_id, any(side) as side,
            any(usdc_amount)/1e6 as usdc, any(token_amount)/1e6 as tokens
          FROM pm_trader_events_dedup_v2_tbl
          WHERE lower(trader_wallet) = lower('${wallet}')
          GROUP BY event_id
        )
        GROUP BY token_id
        HAVING net_tokens > 1000
      )
      SELECT
        wp.token_id,
        wp.net_tokens,
        wp.avg_buy_price,
        wp.net_tokens * wp.avg_buy_price as cost_basis,
        wp.net_tokens * 1.0 - wp.net_tokens * wp.avg_buy_price as settlement_pnl,
        m.question
      FROM wallet_positions wp
      JOIN pm_token_to_condition_map_current m ON wp.token_id = m.token_id_dec
      JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
      WHERE JSONExtractArrayRaw(r.payout_numerators)[toUInt32(m.outcome_index + 1)] != '0'
      ORDER BY settlement_pnl DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const winnerData = await winners.json() as Array<{
    token_id: string;
    net_tokens: number;
    avg_buy_price: number;
    cost_basis: number;
    settlement_pnl: number;
    question: string;
  }>;

  console.log('Top 10 WINNER positions:');
  let totalWinnerPnl = 0;
  for (const w of winnerData) {
    console.log(`  ${(w.question || 'Unknown').substring(0, 40)}...`);
    console.log(`    Tokens: ${Number(w.net_tokens).toLocaleString()} @ $${w.avg_buy_price.toFixed(3)} → PnL: $${Number(w.settlement_pnl).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    totalWinnerPnl += w.settlement_pnl;
  }
  console.log(`  Total top 10 winner PnL: $${totalWinnerPnl.toLocaleString()}`);

  await client.close();
}

main().catch(console.error);
