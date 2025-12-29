#!/usr/bin/env npx tsx
/**
 * Calculate full PnL including settlements for resolved markets
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function main() {
  const wallet = '0xf70acdab62c5d2fcf3f411ae6b4ebd459d19a191';

  const tokens = [
    { id: '53782513412037113891565975315878012286410354645975625651014216257121815034754', name: '53782', resolved: 0 as number | null },
    { id: '54466142099908655946578781902372844681276422218073504805969905585911399871042', name: '54466', resolved: 1 as number | null },
    { id: '109612312495067640558838633989701459337742301251106810966580588890274721616442', name: '10961', resolved: null as number | null },
    { id: '57904639948532778002248435788724940210404315989659385112544649656833850984460', name: '57904', resolved: null as number | null }
  ];

  console.log('=== FULL PNL WITH SETTLEMENTS ===\n');

  let resolvedPnl = 0;
  let unresolvedCash = 0;

  for (const token of tokens) {
    const q = await clickhouse.query({
      query: `
        SELECT
          sum(CASE WHEN side = 'buy' THEN usdc_amount ELSE 0 END) / 1e6 as buy_usdc,
          sum(CASE WHEN side = 'sell' THEN usdc_amount ELSE 0 END) / 1e6 as sell_usdc,
          sum(CASE WHEN side = 'buy' THEN token_amount ELSE 0 END) / 1e6 as bought,
          sum(CASE WHEN side = 'sell' THEN token_amount ELSE 0 END) / 1e6 as sold
        FROM pm_trader_fills_dedup_v1
        WHERE trader_wallet = '${wallet}' AND token_id = '${token.id}'
      `,
      format: 'JSONEachRow'
    });
    const data = (await q.json() as any[])[0];

    const netShares = data.bought - data.sold;
    const netCash = data.sell_usdc - data.buy_usdc;

    if (token.resolved !== null) {
      const settlement = netShares * token.resolved;
      const pnl = netCash + settlement;
      resolvedPnl += pnl;
      console.log(`${token.name} (RESOLVED @ ${token.resolved}): cash=$${netCash.toFixed(2)}, settle=$${settlement.toFixed(2)}, PnL=$${pnl.toFixed(2)}`);
    } else {
      unresolvedCash += netCash;
      console.log(`${token.name} (UNRESOLVED): net_shares=${netShares.toFixed(2)}, net_cash=$${netCash.toFixed(2)}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Resolved markets:    $${resolvedPnl.toFixed(2)}`);
  console.log(`Unresolved cash:     $${unresolvedCash.toFixed(2)}`);
  console.log(`Total:               $${(resolvedPnl + unresolvedCash).toFixed(2)}`);
  console.log(`UI Target:           $40.42`);
  console.log(`Delta (resolved only): $${(resolvedPnl - 40.42).toFixed(2)}`);
  console.log(`Delta (with unresolved): $${(resolvedPnl + unresolvedCash - 40.42).toFixed(2)}`);

  await clickhouse.close();
}

main().catch(console.error);
