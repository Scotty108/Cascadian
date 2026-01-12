import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const wallet = '0x4bdb41f924986cabd96e8526b5f4fd08a3fc338d';

async function trace() {
  // Run the exact V1.5 query but stop at deduped_trades to see what it gets
  const query = `
    WITH trades_with_self_fill_flag AS (
      SELECT
        m.condition_id,
        m.outcome_index,
        m.question,
        t.side,
        t.role,
        t.usdc_amount / 1e6 as usdc,
        t.token_amount / 1e6 as tokens,
        t.fee_amount / 1e6 as fee,
        countIf(role = 'maker') OVER (
          PARTITION BY lower(t.trader_wallet), t.transaction_hash, t.token_id, t.usdc_amount, t.token_amount
        ) as has_maker,
        countIf(role = 'taker') OVER (
          PARTITION BY lower(t.trader_wallet), t.transaction_hash, t.token_id, t.usdc_amount, t.token_amount
        ) as has_taker
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${wallet}'
        AND m.condition_id IS NOT NULL
        AND m.condition_id != ''
    ),
    deduped_trades AS (
      SELECT condition_id, outcome_index, question, side, role, usdc, tokens, fee
      FROM trades_with_self_fill_flag
      WHERE NOT (role = 'taker' AND has_maker > 0 AND has_taker > 0)
    )
    SELECT
      role,
      side,
      count() as cnt,
      sum(usdc) as total_usdc,
      sum(fee) as total_fee
    FROM deduped_trades
    GROUP BY role, side
    ORDER BY role, side
  `;

  console.log('=== V1.5 DEDUPED TRADES ===');
  const r = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await r.json()) as any[];
  console.table(rows);

  // Compare to what the working debug script gets
  const debugQuery = `
    SELECT
      role,
      side,
      count() as cnt,
      sum(usdc) as usdc
    FROM (
      SELECT
        t.role,
        t.side,
        t.usdc_amount / 1e6 as usdc,
        countIf(role = 'maker') OVER (PARTITION BY t.transaction_hash, t.token_id, t.usdc_amount, t.token_amount) as has_maker,
        countIf(role = 'taker') OVER (PARTITION BY t.transaction_hash, t.token_id, t.usdc_amount, t.token_amount) as has_taker
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${wallet}'
        AND m.condition_id != ''
    )
    WHERE NOT (role = 'taker' AND has_maker > 0 AND has_taker > 0)
    GROUP BY role, side
    ORDER BY role, side
  `;

  console.log('\n=== DEBUG SCRIPT APPROACH (no wallet in partition) ===');
  const r2 = await clickhouse.query({ query: debugQuery, format: 'JSONEachRow' });
  const rows2 = (await r2.json()) as any[];
  console.table(rows2);

  // Check what the has_maker/has_taker values look like
  const sampleQuery = `
    WITH trades_with_flags AS (
      SELECT
        t.role,
        t.side,
        t.usdc_amount / 1e6 as usdc,
        countIf(role = 'maker') OVER (
          PARTITION BY lower(t.trader_wallet), t.transaction_hash, t.token_id, t.usdc_amount, t.token_amount
        ) as has_maker,
        countIf(role = 'taker') OVER (
          PARTITION BY lower(t.trader_wallet), t.transaction_hash, t.token_id, t.usdc_amount, t.token_amount
        ) as has_taker
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${wallet}'
        AND m.condition_id IS NOT NULL
        AND m.condition_id != ''
    )
    SELECT role, side, has_maker, has_taker, count() as cnt
    FROM trades_with_flags
    GROUP BY role, side, has_maker, has_taker
    ORDER BY role, side, has_maker, has_taker
  `;

  console.log('\n=== WINDOW FUNCTION FLAG DISTRIBUTION (V1.5 with wallet partition) ===');
  const r3 = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
  const rows3 = (await r3.json()) as any[];
  console.table(rows3);

  process.exit(0);
}

trace().catch(console.error);
