import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const wallet = '0x4bdb41f924986cabd96e8526b5f4fd08a3fc338d';

async function investigate() {
  // Try different join approaches to see what actually works

  // Approach 1: Use IN instead of LEFT JOIN
  const inApproach = `
    WITH sf_keys AS (
      SELECT
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
      countIf(
        concat(hex(t.transaction_hash), '_', t.token_id, '_', toString(t.usdc_amount), '_', toString(t.token_amount))
        IN (SELECT sf_key FROM sf_keys)
      ) as matched,
      countIf(
        concat(hex(t.transaction_hash), '_', t.token_id, '_', toString(t.usdc_amount), '_', toString(t.token_amount))
        NOT IN (SELECT sf_key FROM sf_keys)
      ) as not_matched
    FROM pm_trader_events_v3 t
    JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    WHERE lower(t.trader_wallet) = '${wallet}'
      AND m.condition_id != ''
    GROUP BY t.role
  `;

  console.log('=== APPROACH 1: IN CLAUSE ===');
  const r1 = await clickhouse.query({ query: inApproach, format: 'JSONEachRow' });
  const rows1 = (await r1.json()) as any[];
  console.table(rows1);

  // Approach 2: Simple filter with EXISTS
  const existsApproach = `
    SELECT
      t.role,
      t.side,
      count() as cnt,
      sum(t.usdc_amount) / 1e6 as usdc
    FROM pm_trader_events_v3 t
    JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    WHERE lower(t.trader_wallet) = '${wallet}'
      AND m.condition_id != ''
      AND NOT (
        t.role = 'taker'
        AND EXISTS (
          SELECT 1
          FROM pm_trader_events_v3 t2
          WHERE t2.transaction_hash = t.transaction_hash
            AND t2.token_id = t.token_id
            AND t2.usdc_amount = t.usdc_amount
            AND t2.token_amount = t.token_amount
            AND lower(t2.trader_wallet) = '${wallet}'
            AND t2.role = 'maker'
        )
      )
    GROUP BY t.role, t.side
    ORDER BY t.role, t.side
  `;

  console.log('\n=== APPROACH 2: EXISTS CLAUSE ===');
  const r2 = await clickhouse.query({ query: existsApproach, format: 'JSONEachRow' });
  const rows2 = (await r2.json()) as any[];
  console.table(rows2);

  // Approach 3: Window function to detect self-fills
  const windowApproach = `
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

  console.log('\n=== APPROACH 3: WINDOW FUNCTION ===');
  const r3 = await clickhouse.query({ query: windowApproach, format: 'JSONEachRow' });
  const rows3 = (await r3.json()) as any[];
  console.table(rows3);

  process.exit(0);
}

investigate().catch(console.error);
