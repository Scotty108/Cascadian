import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

const wallet = '0xda5fff24aa9d889d6366da205029c73093102e9b'; // @Kangtamqf - sign flip

async function investigate() {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`INVESTIGATING: ${wallet}`);
  console.log(`CCR-v1: +$10,563 | UI: -$3,452 | GAP: SIGN FLIP`);
  console.log(`${'='.repeat(70)}\n`);

  // 1. Count raw trades (before any dedup)
  const rawCountQ = `
    SELECT count() as cnt
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
  `;
  const rawCount = await clickhouse.query({ query: rawCountQ, format: 'JSONEachRow' });
  const rawCountData = (await rawCount.json()) as any[];
  console.log(`1. Raw trades in pm_trader_events_v2: ${rawCountData[0]?.cnt}`);

  // 2. Count after event_id dedup
  const dedupCountQ = `
    SELECT count() as cnt FROM (
      SELECT event_id FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
      GROUP BY event_id
    )
  `;
  const dedupCount = await clickhouse.query({ query: dedupCountQ, format: 'JSONEachRow' });
  const dedupCountData = (await dedupCount.json()) as any[];
  console.log(`2. After event_id dedup: ${dedupCountData[0]?.cnt}`);

  // 3. Count in dedup_v2 table
  const dedup2CountQ = `
    SELECT count() as cnt FROM (
      SELECT event_id FROM pm_trader_events_dedup_v2_tbl
      WHERE lower(trader_wallet) = lower('${wallet}')
      GROUP BY event_id
    )
  `;
  const dedup2Count = await clickhouse.query({ query: dedup2CountQ, format: 'JSONEachRow' });
  const dedup2CountData = (await dedup2Count.json()) as any[];
  console.log(`3. In dedup_v2 table: ${dedup2CountData[0]?.cnt}`);

  // 4. Get buy/sell breakdown
  const sideBreakdownQ = `
    SELECT
      side,
      count() as cnt,
      sum(usdc_amount) / 1e6 as total_usdc,
      sum(token_amount) / 1e6 as total_tokens
    FROM (
      SELECT event_id, any(side) as side, any(usdc_amount) as usdc_amount, any(token_amount) as token_amount
      FROM pm_trader_events_dedup_v2_tbl
      WHERE lower(trader_wallet) = lower('${wallet}')
      GROUP BY event_id
    )
    GROUP BY side
  `;
  const sideBreakdown = await clickhouse.query({ query: sideBreakdownQ, format: 'JSONEachRow' });
  const sideData = (await sideBreakdown.json()) as any[];
  console.log(`\n4. Buy/Sell breakdown:`);
  for (const row of sideData) {
    console.log(`   ${row.side}: ${row.cnt} trades, $${Number(row.total_usdc).toFixed(2)} USDC, ${Number(row.total_tokens).toFixed(2)} tokens`);
  }

  // 5. Check resolution status of their positions
  const resolutionQ = `
    SELECT
      countIf(r.payout_numerators IS NOT NULL) as resolved_tokens,
      countIf(r.payout_numerators IS NULL) as unresolved_tokens,
      count(DISTINCT t.token_id) as unique_tokens
    FROM (
      SELECT DISTINCT token_id FROM pm_trader_events_dedup_v2_tbl
      WHERE lower(trader_wallet) = lower('${wallet}')
    ) t
    LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    LEFT JOIN pm_condition_resolutions r ON lower(m.condition_id) = lower(r.condition_id)
  `;
  const resolution = await clickhouse.query({ query: resolutionQ, format: 'JSONEachRow' });
  const resData = (await resolution.json()) as any[];
  console.log(`\n5. Resolution status:`);
  console.log(`   Unique tokens traded: ${resData[0]?.unique_tokens}`);
  console.log(`   Resolved: ${resData[0]?.resolved_tokens}`);
  console.log(`   Unresolved: ${resData[0]?.unresolved_tokens}`);

  // 6. Simple cash flow analysis (subgraph style)
  const cashFlowQ = `
    SELECT
      sum(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as net_cash_flow,
      sum(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as net_tokens
    FROM (
      SELECT
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens
      FROM pm_trader_events_dedup_v2_tbl
      WHERE lower(trader_wallet) = lower('${wallet}')
      GROUP BY event_id
    )
  `;
  const cashFlow = await clickhouse.query({ query: cashFlowQ, format: 'JSONEachRow' });
  const cfData = (await cashFlow.json()) as any[];
  console.log(`\n6. Simple cash flow (buy=-cash, sell=+cash):`);
  console.log(`   Net cash flow: $${Number(cfData[0]?.net_cash_flow).toFixed(2)}`);
  console.log(`   Net tokens: ${Number(cfData[0]?.net_tokens).toFixed(2)}`);

  // 7. Check a sample of their trades
  const sampleQ = `
    SELECT
      any(side) as side,
      any(token_id) as token_id,
      any(usdc_amount) / 1e6 as usdc,
      any(token_amount) / 1e6 as tokens,
      any(trade_time) as trade_time
    FROM pm_trader_events_dedup_v2_tbl
    WHERE lower(trader_wallet) = lower('${wallet}')
    GROUP BY event_id
    ORDER BY trade_time DESC
    LIMIT 10
  `;
  const sample = await clickhouse.query({ query: sampleQ, format: 'JSONEachRow' });
  const sampleData = (await sample.json()) as any[];
  console.log(`\n7. Recent 10 trades:`);
  for (const t of sampleData) {
    const price = Number(t.tokens) > 0 ? (Number(t.usdc) / Number(t.tokens)).toFixed(3) : '?';
    console.log(`   ${t.side.padEnd(4)} | ${Number(t.usdc).toFixed(2).padStart(10)} USDC | ${Number(t.tokens).toFixed(2).padStart(12)} tokens | price: ${price}`);
  }

  // 8. Check token resolutions for this wallet's positions
  const tokenResQ = `
    SELECT
      t.token_id,
      m.condition_id,
      m.outcome_index,
      r.payout_numerators,
      sum(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as net_tokens
    FROM (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(token_amount) / 1e6 as tokens
      FROM pm_trader_events_dedup_v2_tbl
      WHERE lower(trader_wallet) = lower('${wallet}')
      GROUP BY event_id
    ) t
    LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    LEFT JOIN pm_condition_resolutions r ON lower(m.condition_id) = lower(r.condition_id)
    GROUP BY t.token_id, m.condition_id, m.outcome_index, r.payout_numerators
    HAVING abs(net_tokens) > 100
    ORDER BY abs(net_tokens) DESC
    LIMIT 15
  `;
  const tokenRes = await clickhouse.query({ query: tokenResQ, format: 'JSONEachRow' });
  const tokenResData = (await tokenRes.json()) as any[];
  console.log(`\n8. Top 15 positions by size (net tokens > 100):`);
  console.log(`   Token ID         | Net Tokens | Outcome | Resolved | Payout`);
  for (const t of tokenResData) {
    const resolved = t.payout_numerators ? 'YES' : 'NO';
    let payout = 'N/A';
    if (t.payout_numerators) {
      try {
        const payouts = JSON.parse(t.payout_numerators.replace(/'/g, '"'));
        payout = payouts[Number(t.outcome_index)] > 0 ? '1.0' : '0.0';
      } catch {}
    }
    console.log(`   ${String(t.token_id).slice(0,15).padEnd(15)} | ${Number(t.net_tokens).toFixed(0).padStart(10)} | ${String(t.outcome_index).padStart(7)} | ${resolved.padStart(8)} | ${payout}`);
  }

  // 9. Calculate PnL breakdown by resolution status
  const pnlBreakdownQ = `
    SELECT
      CASE WHEN r.payout_numerators IS NOT NULL THEN 'resolved' ELSE 'unresolved' END as status,
      sum(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as cash_flow,
      sum(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as net_tokens
    FROM (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens
      FROM pm_trader_events_dedup_v2_tbl
      WHERE lower(trader_wallet) = lower('${wallet}')
      GROUP BY event_id
    ) t
    LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    LEFT JOIN pm_condition_resolutions r ON lower(m.condition_id) = lower(r.condition_id)
    GROUP BY status
  `;
  const pnlBreakdown = await clickhouse.query({ query: pnlBreakdownQ, format: 'JSONEachRow' });
  const pnlData = (await pnlBreakdown.json()) as any[];
  console.log(`\n9. PnL breakdown by resolution status:`);
  for (const row of pnlData) {
    console.log(`   ${row.status}: cash_flow=$${Number(row.cash_flow).toFixed(2)}, net_tokens=${Number(row.net_tokens).toFixed(2)}`);
  }
}

investigate().catch(console.error);
