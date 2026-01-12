import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const wallet = '0x4bdb41f924986cabd96e8526b5f4fd08a3fc338d';

async function investigate() {
  // Get the actual self-fill keys
  const sfQuery = `
    SELECT
      concat(hex(t.transaction_hash), '_', t.token_id, '_', toString(t.usdc_amount), '_', toString(t.token_amount)) as sf_key,
      count() as cnt
    FROM pm_trader_events_v3 t
    JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    WHERE lower(t.trader_wallet) = '${wallet}'
      AND m.condition_id != ''
    GROUP BY t.transaction_hash, t.token_id, t.usdc_amount, t.token_amount
    HAVING countIf(role = 'maker') > 0 AND countIf(role = 'taker') > 0
  `;

  console.log('=== SELF-FILL KEYS ===');
  const sf = await clickhouse.query({ query: sfQuery, format: 'JSONEachRow' });
  const sfRows = (await sf.json()) as any[];
  for (const r of sfRows) {
    console.log(`Key: ${r.sf_key?.substring(0, 80)}... Count: ${r.cnt}`);
  }

  // Get some sample taker trade keys and check if they match
  const tkQuery = `
    SELECT
      t.event_id,
      concat(hex(t.transaction_hash), '_', t.token_id, '_', toString(t.usdc_amount), '_', toString(t.token_amount)) as trade_key,
      t.role,
      t.side
    FROM pm_trader_events_v3 t
    JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    WHERE lower(t.trader_wallet) = '${wallet}'
      AND m.condition_id != ''
      AND t.role = 'taker'
    LIMIT 5
  `;

  console.log('\n=== SAMPLE TAKER TRADE KEYS ===');
  const tk = await clickhouse.query({ query: tkQuery, format: 'JSONEachRow' });
  const tkRows = (await tk.json()) as any[];
  for (const r of tkRows) {
    console.log(`Event: ${r.event_id?.substring(0, 20)}... Key: ${r.trade_key?.substring(0, 80)}... Role: ${r.role} Side: ${r.side}`);
  }

  // Check if there's a weird matching issue - count matched vs unmatched
  const matchQuery = `
    WITH sf AS (
      SELECT DISTINCT
        concat(hex(t.transaction_hash), '_', t.token_id, '_', toString(t.usdc_amount), '_', toString(t.token_amount)) as sf_key
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${wallet}'
        AND m.condition_id != ''
      GROUP BY t.transaction_hash, t.token_id, t.usdc_amount, t.token_amount
      HAVING countIf(role = 'maker') > 0 AND countIf(role = 'taker') > 0
    )
    SELECT
      t.role,
      count() as total,
      countIf(sf.sf_key IS NOT NULL) as matched,
      countIf(sf.sf_key IS NULL) as not_matched
    FROM pm_trader_events_v3 t
    JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    LEFT JOIN sf ON
      concat(hex(t.transaction_hash), '_', t.token_id, '_', toString(t.usdc_amount), '_', toString(t.token_amount)) = sf.sf_key
    WHERE lower(t.trader_wallet) = '${wallet}'
      AND m.condition_id != ''
    GROUP BY t.role
  `;

  console.log('\n=== MATCH STATUS BY ROLE ===');
  const match = await clickhouse.query({ query: matchQuery, format: 'JSONEachRow' });
  const matchRows = (await match.json()) as any[];
  console.table(matchRows);

  // Now let me check the actual structure - are there multiple tokens with same amounts?
  const structQuery = `
    SELECT
      hex(t.transaction_hash) as tx,
      t.token_id,
      t.usdc_amount / 1e6 as usdc,
      t.token_amount / 1e6 as tokens,
      t.role,
      t.side,
      count() as rows_per_key
    FROM pm_trader_events_v3 t
    JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    WHERE lower(t.trader_wallet) = '${wallet}'
      AND m.condition_id != ''
    GROUP BY t.transaction_hash, t.token_id, t.usdc_amount, t.token_amount, t.role, t.side
    ORDER BY tx, t.token_id
    LIMIT 20
  `;

  console.log('\n=== TRADE KEY STRUCTURE (first 20) ===');
  const struct = await clickhouse.query({ query: structQuery, format: 'JSONEachRow' });
  const structRows = (await struct.json()) as any[];
  console.table(structRows.map((r: any) => ({
    tx: r.tx?.substring(0, 16) + '...',
    token_id: r.token_id?.substring(0, 20) + '...',
    usdc: r.usdc,
    tokens: r.tokens,
    role: r.role,
    side: r.side,
    rows: r.rows_per_key
  })));

  process.exit(0);
}

investigate().catch(console.error);
