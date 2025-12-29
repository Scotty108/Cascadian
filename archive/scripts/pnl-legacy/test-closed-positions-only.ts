/**
 * Test: PnL = Only positions that were fully closed through trading
 *
 * Hypothesis: UI shows PnL only for positions where user:
 * 1. Bought tokens
 * 2. Then SOLD those tokens (traded out)
 * NOT including positions held to resolution
 *
 * Terminal: Claude 1
 */

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || 'Lbr.jYtw5ikf3',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 120000,
});

const TEST_WALLETS = [
  { label: 'W2', address: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838', uiPnl: 4404.92 },
  { label: 'W3', address: '0x418db17eaa8f25eaf2085657d0becd82462c6786', uiPnl: 5.44 },
  { label: 'W1', address: '0x9d36c904930a7d06c5403f9e16996e919f586486', uiPnl: -6138.90 },
  { label: 'W4', address: '0x4974d02a2e6ca79b33f6e915e98f5a8cc5237fdb', uiPnl: -1.13 },
  { label: 'W5', address: '0xeab03de44f98ad31ecc19cd597bcdef1c9fe42c2', uiPnl: 146.90 },
  { label: 'W6', address: '0x7dca4d9f31ceba9d2d5b7a723eccd5e2e7ccc48d', uiPnl: 319.42 },
];

async function calculateClosedPositionsPnL(wallet: string): Promise<number | null> {
  try {
    // Calculate PnL only from positions where there were BOTH buys AND sells
    // (i.e., positions that were traded out, at least partially)
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
        position_activity AS (
          SELECT
            condition_id,
            outcome_index,
            SUM(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as cash_flow,
            SUM(CASE WHEN side = 'buy' THEN 1 ELSE 0 END) as buy_count,
            SUM(CASE WHEN side = 'sell' THEN 1 ELSE 0 END) as sell_count,
            SUM(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as final_position
          FROM with_condition
          GROUP BY condition_id, outcome_index
        )
        -- Only include positions where there were sells (closed/exited positions)
        SELECT
          SUM(cash_flow) as closed_pnl
        FROM position_activity
        WHERE sell_count > 0
      `,
      query_params: { wallet },
      format: 'JSONEachRow'
    });

    const rows = await result.json() as any[];
    return rows[0]?.closed_pnl ?? null;
  } catch (e) {
    console.error(`Error for ${wallet}:`, e);
    return null;
  }
}

async function main() {
  console.log('');
  console.log('='.repeat(80));
  console.log('HYPOTHESIS: PnL = Cash flow from positions with SELLS (closed/exited)');
  console.log('='.repeat(80));
  console.log('');

  console.log('Label  | Our PnL      | UI PnL       | Error     | Status');
  console.log('-'.repeat(60));

  let passed = 0;

  for (const w of TEST_WALLETS) {
    const ourPnl = await calculateClosedPositionsPnL(w.address);

    const error = ourPnl !== null && w.uiPnl !== 0
      ? Math.abs((ourPnl - w.uiPnl) / w.uiPnl)
      : null;

    const status = error !== null && error <= 0.05 ? 'PASS' : 'FAIL';
    if (status === 'PASS') passed++;

    const ourStr = ourPnl !== null
      ? (ourPnl >= 0 ? '+$' : '-$') + Math.abs(ourPnl).toFixed(2)
      : 'N/A';
    const uiStr = (w.uiPnl >= 0 ? '+$' : '-$') + Math.abs(w.uiPnl).toFixed(2);
    const errStr = error !== null ? (error * 100).toFixed(1) + '%' : 'N/A';

    console.log(
      `${w.label.padEnd(7)}| ${ourStr.padStart(12)} | ${uiStr.padStart(12)} | ${errStr.padStart(9)} | ${status}`
    );
  }

  console.log('-'.repeat(60));
  console.log(`Passed: ${passed}/6`);

  await client.close();
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
