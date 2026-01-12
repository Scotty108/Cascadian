import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const WALLETS = {
  spot_6: '0xf380061e3ef5fa4d46341b269f75d57d6dc6c8b0',
  spot_3: '0x0060a1843fe53a54e9fdc403005da0b1ead44cc4',
  spot_9: '0x61341f266a614cc511d2f606542b0774688998b0',
};

async function verifyWallet(name: string, wallet: string) {
  const v2Query = \`
    SELECT COUNT(*) as count, SUM(usdc) as total_usdc
    FROM (
      SELECT event_id, any(usdc_amount) / 1000000.0 as usdc
      FROM pm_trader_events_v2
      WHERE trader_wallet = '\${wallet}' AND is_deleted = 0
      GROUP BY event_id
    )
  \`;

  const v3Query = \`
    SELECT COUNT(*) as count, SUM(usdc_amount) / 1000000.0 as total_usdc
    FROM pm_trader_events_v3
    WHERE trader_wallet = '\${wallet}'
  \`;

  const [v2Result, v3Result] = await Promise.all([
    clickhouse.query({ query: v2Query, format: 'JSONEachRow' }),
    clickhouse.query({ query: v3Query, format: 'JSONEachRow' }),
  ]);

  const v2Data = (await v2Result.json()) as Array<{ count: number; total_usdc: number }>;
  const v3Data = (await v3Result.json()) as Array<{ count: number; total_usdc: number }>;

  const v2 = v2Data[0];
  const v3 = v3Data[0];

  const countMatch = v2.count === v3.count;
  const usdcMatch = Math.abs(v2.total_usdc - v3.total_usdc) < 0.01;

  return {
    wallet: name,
    v2_count: v2.count,
    v3_count: v3.count,
    v2_usdc: v2.total_usdc,
    v3_usdc: v3.total_usdc,
    count_match: countMatch,
    usdc_match: usdcMatch,
    perfect_match: countMatch && usdcMatch,
  };
}

async function main() {
  console.log('V2 vs V3 VERIFICATION - Using CORRECT deduplication patterns');
  console.log();

  const results = [];

  for (const [name, wallet] of Object.entries(WALLETS)) {
    const result = await verifyWallet(name, wallet);
    results.push(result);

    const match = result.perfect_match ? 'PERFECT MATCH' : 'MISMATCH';
    console.log(name + ': ' + result.v2_count + ' events, \$' + result.v2_usdc.toFixed(2) + ' -> ' + match);
  }

  console.log();
  console.table(
    results.map((r) => ({
      Wallet: r.wallet,
      V2_Events: r.v2_count,
      V3_Events: r.v3_count,
      V2_USDC: '\$' + r.v2_usdc.toFixed(2),
      V3_USDC: '\$' + r.v3_usdc.toFixed(2),
      Match: r.perfect_match ? 'YES' : 'NO',
    }))
  );

  const allMatch = results.every((r) => r.perfect_match);
  console.log();
  console.log(allMatch ? 'RESULT: ALL PERFECT MATCHES - No data gap exists' : 'RESULT: Discrepancies found');
}

main().catch(console.error);
