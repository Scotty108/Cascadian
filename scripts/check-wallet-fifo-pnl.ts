import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  const wallet = '0x7ed62b230d860eb69bf076450026ac382dc5eb26';

  console.log(`Checking FIFO PnL for ${wallet}\n`);

  const result = await clickhouse.query({
    query: `
      SELECT
        count() as position_count,
        round(sum(pnl_usd), 2) as total_pnl,
        round(sum(cost_usd), 2) as total_cost,
        countIf(pnl_usd > 0) as wins,
        countIf(pnl_usd <= 0) as losses
      FROM pm_trade_fifo_roi_v3
      WHERE wallet = '${wallet}'
    `,
    format: 'JSONEachRow'
  });

  const rows = await result.json();
  console.log('FIFO Table (pm_trade_fifo_roi_v3):');
  console.log(JSON.stringify(rows[0], null, 2));

  // Also check just January 2026
  const janResult = await clickhouse.query({
    query: `
      SELECT
        count() as position_count,
        round(sum(pnl_usd), 2) as total_pnl,
        countIf(pnl_usd > 0) as wins,
        countIf(pnl_usd <= 0) as losses
      FROM pm_trade_fifo_roi_v3
      WHERE wallet = '${wallet}'
        AND resolved_at >= toDateTime('2026-01-01 00:00:00')
        AND resolved_at < toDateTime('2026-01-28 00:00:00')
    `,
    format: 'JSONEachRow'
  });

  const janRows = await janResult.json();
  console.log('\nJanuary 2026 Only:');
  console.log(JSON.stringify(janRows[0], null, 2));

  // Check V55 formula calculation
  const v55Result = await clickhouse.query({
    query: `
      SELECT
        round(sumIf(cash_flow + net_tokens * payout_rate, is_resolved = 1), 2) as realized_pnl,
        round(sumIf(cash_flow + net_tokens * mark_price, is_resolved = 0 AND net_tokens > 0.001), 2) as unrealized_pnl
      FROM (
        SELECT
          f.condition_id,
          f.outcome_index,
          sum(f.usdc_delta) as cash_flow,
          sum(f.tokens_delta) as net_tokens,
          CASE WHEN any(r.resolved_at) > '1970-01-02' THEN 1 ELSE 0 END as is_resolved,
          coalesce(any(mp.mark_price), 0.5) as mark_price,
          CASE
            WHEN any(r.payout_numerators) = '[1,1]' THEN 0.5
            WHEN any(r.payout_numerators) = '[0,1]' AND f.outcome_index = 1 THEN 1.0
            WHEN any(r.payout_numerators) = '[1,0]' AND f.outcome_index = 0 THEN 1.0
            ELSE 0.0
          END as payout_rate
        FROM pm_canonical_fills_v4 f
        LEFT JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id AND r.is_deleted = 0
        LEFT JOIN pm_latest_mark_price_v1 mp ON f.condition_id = mp.condition_id AND f.outcome_index = mp.outcome_index
        WHERE f.wallet = '${wallet}'
          AND f.condition_id != ''
          AND NOT (f.is_self_fill = 1 AND f.is_maker = 1)
          AND f.source != 'negrisk'
        GROUP BY f.condition_id, f.outcome_index
      )
    `,
    format: 'JSONEachRow'
  });

  const v55Rows = await v55Result.json();
  console.log('\nV55 Formula (pm_canonical_fills_v4):');
  console.log(JSON.stringify(v55Rows[0], null, 2));
}

main().catch(console.error);
