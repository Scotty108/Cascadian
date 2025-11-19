#!/usr/bin/env npx tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  request_timeout: 300000,
});

const TEST_WALLETS = [
  '0x4ce73141dbfce41e65db3723e31059a730f0abad',
  '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144',
  '0x1f0a343513aa6060488fabe96960e6d1e177f7aa',
];

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('QUICK P&L CHECK');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  for (const wallet of TEST_WALLETS) {
    console.log(`Wallet: ${wallet}`);

    const result = await ch.query({
      query: `
        SELECT
          wallet,
          trading_realized_pnl,
          redemption_pnl,
          total_realized_pnl,
          unrealized_pnl,
          total_pnl,
          closed_positions,
          open_positions,
          redeemed_positions
        FROM cascadian_clean.vw_wallet_pnl_unified
        WHERE lower(wallet) = lower('${wallet}')
        LIMIT 1
      `,
      format: 'JSONEachRow',
    });

    const data = await result.json<any[]>();

    if (data.length === 0) {
      console.log('  ⚠️  No data found\n');
      continue;
    }

    const p = data[0];
    console.log(`  Trading P&L:    $${parseFloat(p.trading_realized_pnl).toFixed(2)}`);
    console.log(`  Redemption P&L: $${parseFloat(p.redemption_pnl).toFixed(2)}`);
    console.log(`  Total Realized: $${parseFloat(p.total_realized_pnl).toFixed(2)}`);
    console.log(`  Unrealized P&L: $${parseFloat(p.unrealized_pnl).toFixed(2)}`);
    console.log(`  ─────────────────────────────────────────`);
    console.log(`  TOTAL P&L:      $${parseFloat(p.total_pnl).toFixed(2)}`);
    console.log(`  `);
    console.log(`  Closed:    ${p.closed_positions}`);
    console.log(`  Open:      ${p.open_positions}`);
    console.log(`  Redeemed:  ${p.redeemed_positions}\n`);
  }

  await ch.close();
}

main().catch(console.error);
