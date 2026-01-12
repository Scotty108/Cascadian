import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const wallet = '0x4bdb41f924986cabd96e8526b5f4fd08a3fc338d';

async function investigate() {
  // Check the self-fill keys
  const selfFillQuery = `
    SELECT
      concat(t.transaction_hash, '_', t.token_id, '_', toString(t.usdc_amount), '_', toString(t.token_amount)) as sf_key,
      count() as trade_count,
      countIf(role = 'maker') as maker_count,
      countIf(role = 'taker') as taker_count
    FROM pm_trader_events_v3 t
    JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    WHERE lower(t.trader_wallet) = '${wallet}'
      AND m.condition_id != ''
    GROUP BY sf_key
    HAVING countIf(role = 'maker') > 0 AND countIf(role = 'taker') > 0
  `;

  console.log('=== TRUE SELF-FILL KEYS ===');
  const sf = await clickhouse.query({ query: selfFillQuery, format: 'JSONEachRow' });
  const sfRows = (await sf.json()) as any[];
  console.table(sfRows.map((r: any) => ({
    sf_key: r.sf_key?.substring(0, 60) + '...',
    trades: r.trade_count,
    makers: r.maker_count,
    takers: r.taker_count
  })));

  // Check how many taker trades match vs don't match
  const takerMatchQuery = `
    WITH true_self_fills AS (
      SELECT
        concat(t.transaction_hash, '_', t.token_id, '_', toString(t.usdc_amount), '_', toString(t.token_amount)) as sf_key
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${wallet}'
        AND m.condition_id != ''
      GROUP BY t.transaction_hash, t.token_id, t.usdc_amount, t.token_amount
      HAVING countIf(role = 'maker') > 0 AND countIf(role = 'taker') > 0
    ),
    all_taker_trades AS (
      SELECT
        concat(t.transaction_hash, '_', t.token_id, '_', toString(t.usdc_amount), '_', toString(t.token_amount)) as trade_key,
        t.side,
        t.usdc_amount / 1e6 as usdc
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${wallet}'
        AND m.condition_id != ''
        AND t.role = 'taker'
    )
    SELECT
      countIf(s.sf_key IS NOT NULL) as matching_takers,
      countIf(s.sf_key IS NULL) as non_matching_takers,
      sumIf(usdc, s.sf_key IS NOT NULL) as matching_usdc,
      sumIf(usdc, s.sf_key IS NULL) as non_matching_usdc
    FROM all_taker_trades t
    LEFT JOIN true_self_fills s ON t.trade_key = s.sf_key
  `;

  console.log('\n=== TAKER TRADES MATCH STATUS ===');
  const tm = await clickhouse.query({ query: takerMatchQuery, format: 'JSONEachRow' });
  const tmRows = (await tm.json()) as any[];
  console.table(tmRows);

  // Show some examples of non-matching taker trades
  const exampleQuery = `
    WITH true_self_fills AS (
      SELECT
        concat(t.transaction_hash, '_', t.token_id, '_', toString(t.usdc_amount), '_', toString(t.token_amount)) as sf_key
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${wallet}'
        AND m.condition_id != ''
      GROUP BY t.transaction_hash, t.token_id, t.usdc_amount, t.token_amount
      HAVING countIf(role = 'maker') > 0 AND countIf(role = 'taker') > 0
    )
    SELECT
      t.event_id,
      concat(t.transaction_hash, '_', t.token_id, '_', toString(t.usdc_amount), '_', toString(t.token_amount)) as trade_key,
      t.side,
      t.role,
      t.usdc_amount / 1e6 as usdc,
      s.sf_key IS NOT NULL as is_self_fill
    FROM pm_trader_events_v3 t
    JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    LEFT JOIN true_self_fills s ON
      concat(t.transaction_hash, '_', t.token_id, '_', toString(t.usdc_amount), '_', toString(t.token_amount)) = s.sf_key
    WHERE lower(t.trader_wallet) = '${wallet}'
      AND m.condition_id != ''
      AND t.role = 'taker'
    LIMIT 10
  `;

  console.log('\n=== SAMPLE TAKER TRADES ===');
  const ex = await clickhouse.query({ query: exampleQuery, format: 'JSONEachRow' });
  const exRows = (await ex.json()) as any[];
  console.table(exRows.map((r: any) => ({
    event_id: r.event_id?.substring(0, 20) + '...',
    side: r.side,
    usdc: Number(r.usdc).toFixed(2),
    is_self_fill: r.is_self_fill
  })));

  process.exit(0);
}

investigate().catch(console.error);
