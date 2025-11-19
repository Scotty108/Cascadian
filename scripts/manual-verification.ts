#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@clickhouse/client';

config({ path: resolve(__dirname, '../.env.local') });

const TARGET_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

async function main() {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('           MANUAL VERIFICATION OF P&L CALCULATION');
  console.log('══════════════════════════════════════════════════════════\n');

  // Get top winning position
  const topPosition = await clickhouse.query({
    query: `
      SELECT
        condition_id_ctf,
        index_set_mask,
        net_shares,
        gross_cf,
        realized_payout,
        pnl_gross
      FROM wallet_condition_pnl_token
      WHERE lower(wallet) = lower('${TARGET_WALLET}')
        AND realized_payout > 0
      ORDER BY realized_payout DESC
      LIMIT 1
    `,
    format: 'JSONEachRow',
  });
  const pos = (await topPosition.json())[0] as any;

  console.log('Top Winning Position:');
  console.log(`  Condition ID: ${pos.condition_id_ctf}`);
  console.log(`  Index Set Mask: ${pos.index_set_mask} (binary: ${(pos.index_set_mask as number).toString(2).padStart(8, '0')})`);
  console.log(`  Net Shares: ${pos.net_shares}`);
  console.log(`  Gross CF: $${pos.gross_cf}`);
  console.log(`  Realized Payout: $${pos.realized_payout}`);
  console.log(`  P&L Gross: $${pos.pnl_gross}`);

  // Get the payout structure
  const payoutInfo = await clickhouse.query({
    query: `
      SELECT pps
      FROM token_per_share_payout
      WHERE condition_id_ctf = '${pos.condition_id_ctf}'
    `,
    format: 'JSONEachRow',
  });
  const payout = (await payoutInfo.json())[0] as any;
  console.log(`\n  Payout Structure (pps): ${JSON.stringify(payout.pps)}`);

  // Manual calculation
  const mask = pos.index_set_mask as number;
  const shares = parseFloat(pos.net_shares);
  const grossCf = parseFloat(pos.gross_cf);
  const pps = payout.pps as number[];

  console.log('\n  Manual Calculation:');
  let totalPayout = 0;
  for (let j = 0; j < pps.length; j++) {
    const bitPosition = j;
    const isBitSet = (mask & (1 << bitPosition)) !== 0;
    const payoutValue = isBitSet ? pps[j] : 0;
    totalPayout += payoutValue;
    console.log(`    Bit ${bitPosition}: ${isBitSet ? 'SET' : 'NOT SET'} → payout = ${payoutValue}`);
  }
  
  const manualPayout = totalPayout * shares;
  const manualPnl = grossCf + manualPayout;

  console.log(`\n  Per-Share Payout: ${totalPayout}`);
  console.log(`  Total Payout: ${totalPayout} × ${shares} = $${manualPayout.toFixed(2)}`);
  console.log(`  P&L: ${grossCf} + ${manualPayout.toFixed(2)} = $${manualPnl.toFixed(2)}`);

  console.log('\n  Verification:');
  console.log(`    Database realized_payout: $${parseFloat(pos.realized_payout).toFixed(2)}`);
  console.log(`    Manual realized_payout:   $${manualPayout.toFixed(2)}`);
  console.log(`    Match: ${Math.abs(parseFloat(pos.realized_payout) - manualPayout) < 0.01 ? '✅ YES' : '❌ NO'}`);
  
  console.log(`\n    Database pnl_gross: $${parseFloat(pos.pnl_gross).toFixed(2)}`);
  console.log(`    Manual pnl_gross:   $${manualPnl.toFixed(2)}`);
  console.log(`    Match: ${Math.abs(parseFloat(pos.pnl_gross) - manualPnl) < 0.01 ? '✅ YES' : '❌ NO'}`);

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('                     CONCLUSION');
  console.log('══════════════════════════════════════════════════════════');
  
  if (Math.abs(parseFloat(pos.realized_payout) - manualPayout) < 0.01 &&
      Math.abs(parseFloat(pos.pnl_gross) - manualPnl) < 0.01) {
    console.log('\n✅ P&L CALCULATION IS MATHEMATICALLY CORRECT\n');
  } else {
    console.log('\n❌ P&L CALCULATION HAS ERRORS\n');
  }

  await clickhouse.close();
}

main();
