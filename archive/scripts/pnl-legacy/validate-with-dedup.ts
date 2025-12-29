/**
 * Validate PnL Formula WITH Deduplication
 *
 * Tests the CORRECT formula (with event_id deduplication) against 9 test wallets.
 *
 * Terminal: Claude 1
 * Date: 2025-11-26
 */

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || 'Lbr.jYtw5ikf3',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

// Test wallets - FRESH VALUES from Polymarket UI (2025-11-26)
const TEST_WALLETS = [
  { label: 'W2', address: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838', uiPnl: 4404.92, inScope: true },
  { label: 'W1', address: '0x9d36c904930a7d06c5403f9e16996e919f586486', uiPnl: -6138.90, inScope: true },
  { label: 'W3', address: '0x418db17eaa8f25eaf2085657d0becd82462c6786', uiPnl: 5.44, inScope: true },
  { label: 'W4', address: '0x4974d02a2e6ca79b33f6e915e98f5a8cc5237fdb', uiPnl: -1.13, inScope: true },  // Updated from -294.61
  { label: 'W5', address: '0xeab03de44f98ad31ecc19cd597bcdef1c9fe42c2', uiPnl: 146.90, inScope: true },
  { label: 'W6', address: '0x7dca4d9f31ceba9d2d5b7a723eccd5e2e7ccc48d', uiPnl: 319.42, inScope: true },  // Updated from 470.40
  { label: 'EGG', address: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', uiPnl: 96397.49, inScope: false },  // Updated
  { label: 'WHALE', address: '0x56687bf447db6ffa42ffe2204a05edaa20f55839', uiPnl: 22053933.75, inScope: false },
  { label: 'NEW', address: '0xf29bb8e0712075041e87e8605b69833ef738dd4c', uiPnl: -10021171.72, inScope: false },
];

async function calculatePnLWithDedup(wallet: string): Promise<number | null> {
  try {
    const result = await client.query({
      query: `
        WITH deduped AS (
          SELECT
            event_id,
            any(side) as side,
            any(usdc_amount)/1e6 as usdc,
            any(token_amount)/1e6 as tokens,
            any(t.token_id) as token_id
          FROM pm_trader_events_v2 t
          WHERE trader_wallet = {wallet:String} AND is_deleted = 0
          GROUP BY event_id
        ),
        with_condition AS (
          SELECT
            d.*,
            m.condition_id,
            m.outcome_index
          FROM deduped d
          JOIN pm_token_to_condition_map_v3 m ON toString(d.token_id) = toString(m.token_id_dec)
        ),
        aggregated AS (
          SELECT
            condition_id,
            outcome_index,
            SUM(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as cash_delta,
            SUM(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as final_shares
          FROM with_condition
          GROUP BY condition_id, outcome_index
        ),
        with_resolution AS (
          SELECT
            a.*,
            r.payout_numerators
          FROM aggregated a
          LEFT JOIN pm_condition_resolutions r ON lower(a.condition_id) = lower(r.condition_id) AND r.is_deleted = 0
        )
        SELECT
          SUM(
            cash_delta +
            final_shares * (
              CASE
                WHEN payout_numerators LIKE '[0,%' AND outcome_index = 0 THEN 0.0
                WHEN payout_numerators LIKE '[0,%' AND outcome_index = 1 THEN 1.0
                WHEN payout_numerators LIKE '[1,%' AND outcome_index = 0 THEN 1.0
                WHEN payout_numerators LIKE '[1,%' AND outcome_index = 1 THEN 0.0
                ELSE 0.0
              END
            )
          ) as realized_pnl
        FROM with_resolution
        WHERE payout_numerators IS NOT NULL
      `,
      query_params: { wallet },
      format: 'JSONEachRow'
    });

    const rows = await result.json() as any[];
    return rows[0]?.realized_pnl ?? null;
  } catch (e) {
    console.error(`Error for ${wallet}:`, e);
    return null;
  }
}

function formatCurrency(value: number | null): string {
  if (value === null) return 'N/A';
  const abs = Math.abs(value);
  const sign = value >= 0 ? '+' : '-';
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(2)}M`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

async function main() {
  console.log('');
  console.log('='.repeat(100));
  console.log('PHASE 0: SQL FORMULA VALIDATION (WITH DEDUPLICATION)');
  console.log('='.repeat(100));
  console.log('');
  console.log('Testing CORRECTED formula with event_id deduplication');
  console.log('');

  console.log('Label  | Scope    | UI PnL       | Our PnL      | Error     | Status');
  console.log('-'.repeat(80));

  let inScopePassed = 0;
  let inScopeFailed = 0;

  for (const w of TEST_WALLETS) {
    const ourPnl = await calculatePnLWithDedup(w.address);

    let percentError: number | null = null;
    let passed: boolean | null = null;

    if (ourPnl !== null && w.uiPnl !== 0) {
      percentError = Math.abs((ourPnl - w.uiPnl) / w.uiPnl);
      if (w.inScope) {
        passed = percentError <= 0.05;
        if (passed) inScopePassed++;
        else inScopeFailed++;
      }
    } else if (w.inScope) {
      inScopeFailed++;
    }

    const scopeStr = w.inScope ? 'IN-SCOPE' : 'OUT';
    const statusStr = w.inScope
      ? (passed === true ? 'PASS' : passed === false ? 'FAIL' : 'ERROR')
      : 'N/A';
    const errorStr = percentError !== null ? `${(percentError * 100).toFixed(1)}%` : 'N/A';

    console.log(
      `${w.label.padEnd(7)}| ${scopeStr.padEnd(9)}| ${formatCurrency(w.uiPnl).padStart(12)} | ${formatCurrency(ourPnl).padStart(12)} | ${errorStr.padStart(9)} | ${statusStr}`
    );
  }

  console.log('-'.repeat(80));
  console.log('');
  console.log('=== SUMMARY ===');
  console.log(`In-scope passed (<5% error): ${inScopePassed}/6`);
  console.log(`In-scope failed: ${inScopeFailed}`);
  console.log('');

  if (inScopeFailed === 0 && inScopePassed === 6) {
    console.log('PHASE 0 PASSED - Formula is validated!');
    console.log('Proceeding to create V1 views.');
  } else {
    console.log('PHASE 0 FAILED - Need to investigate further.');
  }

  await client.close();
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
