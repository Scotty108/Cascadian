import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 120000,
});

async function test() {
  // Test with the EXACT first wallet from batch that fails
  const wallets = ['0x1521b47bf0c41f6b7fd3ad41cdec566812c8f23e'];
  const walletList = wallets.map(w => `'${w}'`).join(',');
  console.log('Testing with wallet:', walletList);

  // Test with 60-day filter (should work)
  const query60d = `
    WITH
      resolutions AS (
        SELECT condition_id, outcome_index, any(resolved_price) AS resolution_price
        FROM vw_pm_resolution_prices
        GROUP BY condition_id, outcome_index
      ),
      positions AS (
        SELECT
          lower(wallet_address) AS wallet,
          condition_id,
          outcome_index,
          sum(usdc_delta) AS cash_flow,
          sum(token_delta) AS final_tokens
        FROM pm_unified_ledger_v6
        WHERE lower(wallet_address) IN (${walletList})
          AND event_time >= now() - INTERVAL 60 DAY
          AND source_type = 'CLOB'
          AND condition_id IS NOT NULL AND condition_id != ''
        GROUP BY wallet, condition_id, outcome_index
      ),
      position_pnl AS (
        SELECT p.*, r.resolution_price,
          CASE WHEN r.resolution_price IS NOT NULL
            THEN p.cash_flow + (p.final_tokens * r.resolution_price)
            ELSE NULL
          END AS realized_pnl,
          r.resolution_price IS NOT NULL AS is_resolved
        FROM positions p
        LEFT JOIN resolutions r ON p.condition_id = r.condition_id AND p.outcome_index = r.outcome_index
      )
    SELECT wallet,
      round(sumIf(realized_pnl, is_resolved), 2) AS pnl_60d
    FROM position_pnl GROUP BY wallet
  `;

  // Test without 60-day filter
  const queryAllTime = `
    WITH
      resolutions AS (
        SELECT condition_id, outcome_index, any(resolved_price) AS resolution_price
        FROM vw_pm_resolution_prices
        GROUP BY condition_id, outcome_index
      ),
      positions AS (
        SELECT
          lower(wallet_address) AS wallet,
          condition_id,
          outcome_index,
          sum(usdc_delta) AS cash_flow,
          sum(token_delta) AS final_tokens
        FROM pm_unified_ledger_v6
        WHERE lower(wallet_address) IN (${walletList})
          AND source_type = 'CLOB'
          AND condition_id IS NOT NULL AND condition_id != ''
        GROUP BY wallet, condition_id, outcome_index
      ),
      position_pnl AS (
        SELECT p.*, r.resolution_price,
          CASE WHEN r.resolution_price IS NOT NULL
            THEN p.cash_flow + (p.final_tokens * r.resolution_price)
            ELSE NULL
          END AS realized_pnl,
          r.resolution_price IS NOT NULL AS is_resolved
        FROM positions p
        LEFT JOIN resolutions r ON p.condition_id = r.condition_id AND p.outcome_index = r.outcome_index
      )
    SELECT wallet,
      round(sumIf(realized_pnl, is_resolved), 2) AS pnl_alltime
    FROM position_pnl GROUP BY wallet
  `;

  console.log('Testing 60-day query...');
  try {
    const r1 = await ch.query({ query: query60d, format: 'JSONEachRow' });
    const d1 = await r1.json();
    console.log('60-day result:', JSON.stringify(d1));
  } catch (e) {
    console.log('60-day ERROR:', (e as Error).message);
  }

  console.log('\nTesting all-time query...');
  try {
    const r2 = await ch.query({ query: queryAllTime, format: 'JSONEachRow' });
    const d2 = await r2.json();
    console.log('All-time result:', JSON.stringify(d2));
  } catch (e) {
    console.log('All-time ERROR:', (e as Error).message);
  }

  await ch.close();
}

test().catch(console.error);
