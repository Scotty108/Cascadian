/**
 * Test: PnL = Trade Cash Flow + Redemption Cash
 *
 * Hypothesis: Polymarket UI shows ONLY actual cash received,
 * not including unredeemed winning positions.
 *
 * Terminal: Claude 1
 */

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || 'Lbr.jYtw5ikf3',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

// FRESH UI values (2025-11-26)
const TEST_WALLETS = [
  { label: 'W2', address: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838', uiPnl: 4404.92, inScope: true },
  { label: 'W1', address: '0x9d36c904930a7d06c5403f9e16996e919f586486', uiPnl: -6138.90, inScope: true },
  { label: 'W3', address: '0x418db17eaa8f25eaf2085657d0becd82462c6786', uiPnl: 5.44, inScope: true },
  { label: 'W4', address: '0x4974d02a2e6ca79b33f6e915e98f5a8cc5237fdb', uiPnl: -1.13, inScope: true },
  { label: 'W5', address: '0xeab03de44f98ad31ecc19cd597bcdef1c9fe42c2', uiPnl: 146.90, inScope: true },
  { label: 'W6', address: '0x7dca4d9f31ceba9d2d5b7a723eccd5e2e7ccc48d', uiPnl: 319.42, inScope: true },
];

async function calculatePnL(wallet: string): Promise<{ tradeCash: number; redemptionCash: number; total: number } | null> {
  try {
    // 1. Trade cash flow (deduplicated)
    const tradesResult = await client.query({
      query: `
        WITH deduped AS (
          SELECT
            event_id,
            any(side) as side,
            any(usdc_amount)/1e6 as usdc
          FROM pm_trader_events_v2
          WHERE trader_wallet = {wallet:String} AND is_deleted = 0
          GROUP BY event_id
        )
        SELECT
          SUM(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as trade_cash_flow
        FROM deduped
      `,
      query_params: { wallet },
      format: 'JSONEachRow'
    });
    const tradeRows = await tradesResult.json() as any[];
    const tradeCash = tradeRows[0]?.trade_cash_flow ?? 0;

    // 2. Redemption cash from CTF events
    const redemptionsResult = await client.query({
      query: `
        SELECT
          SUM(toFloat64OrNull(amount_or_payout))/1e6 as redemption_cash
        FROM pm_ctf_events
        WHERE lower(user_address) = {wallet:String}
          AND is_deleted = 0
          AND event_type = 'PayoutRedemption'
      `,
      query_params: { wallet: wallet.toLowerCase() },
      format: 'JSONEachRow'
    });
    const redemptionRows = await redemptionsResult.json() as any[];
    const redemptionCash = redemptionRows[0]?.redemption_cash ?? 0;

    return {
      tradeCash,
      redemptionCash,
      total: tradeCash + redemptionCash
    };
  } catch (e) {
    console.error(`Error for ${wallet}:`, e);
    return null;
  }
}

function formatCurrency(value: number): string {
  const abs = Math.abs(value);
  const sign = value >= 0 ? '+' : '-';
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

async function main() {
  console.log('');
  console.log('='.repeat(100));
  console.log('HYPOTHESIS: PnL = Trade Cash Flow + Redemption Cash');
  console.log('(Excludes unredeemed winning positions)');
  console.log('='.repeat(100));
  console.log('');

  console.log('Label  | Trade Cash   | Redemptions  | Our Total    | UI PnL       | Error     | Status');
  console.log('-'.repeat(100));

  let passed = 0;
  let failed = 0;

  for (const w of TEST_WALLETS) {
    const result = await calculatePnL(w.address);

    if (!result) {
      console.log(`${w.label.padEnd(7)}| ERROR`);
      failed++;
      continue;
    }

    const percentError = w.uiPnl !== 0 ? Math.abs((result.total - w.uiPnl) / w.uiPnl) : 0;
    const status = percentError <= 0.05 ? 'PASS' : 'FAIL';

    if (status === 'PASS') passed++;
    else failed++;

    console.log(
      `${w.label.padEnd(7)}| ${formatCurrency(result.tradeCash).padStart(12)} | ${formatCurrency(result.redemptionCash).padStart(12)} | ${formatCurrency(result.total).padStart(12)} | ${formatCurrency(w.uiPnl).padStart(12)} | ${(percentError * 100).toFixed(1).padStart(8)}% | ${status}`
    );
  }

  console.log('-'.repeat(100));
  console.log('');
  console.log('=== SUMMARY ===');
  console.log(`Passed: ${passed}/6`);
  console.log(`Failed: ${failed}`);

  if (passed === 6) {
    console.log('');
    console.log('HYPOTHESIS CONFIRMED: PnL = Trade Cash + Redemptions');
  }

  await client.close();
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
