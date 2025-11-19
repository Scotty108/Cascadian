#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  // Check overall progress
  const countResult = await clickhouse.query({
    query: `SELECT count(DISTINCT wallet) AS wallet_count, count() AS position_count FROM wallet_pnl_fifo`,
    format: 'JSONEachRow'
  });
  const countData = await countResult.json<any[]>();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('FIFO P&L TABLE - CURRENT PROGRESS');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Wallets processed:  ${parseInt(countData[0].wallet_count).toLocaleString()}`);
  console.log(`Positions created:  ${parseInt(countData[0].position_count).toLocaleString()}`);
  console.log('');

  // Check our test wallet
  const testWalletResult = await clickhouse.query({
    query: `
      SELECT
        wallet,
        sum(realized_pnl) AS total_realized_pnl,
        sum(volume) AS total_volume,
        sum(fills) AS total_fills,
        count() AS total_positions
      FROM wallet_pnl_fifo
      WHERE wallet = '0x7f3c8979d0afa00007bae4747d5347122af05613'
      GROUP BY wallet
    `,
    format: 'JSONEachRow'
  });

  const testData = await testWalletResult.json<any[]>();

  if (testData.length > 0) {
    const w = testData[0];
    console.log('Test Wallet (0x7f3c...) FIFO P&L:');
    console.log(`  Realized P&L: $${parseFloat(w.total_realized_pnl).toLocaleString()}`);
    console.log(`  Volume:       $${parseFloat(w.total_volume).toLocaleString()}`);
    console.log(`  Fills:        ${parseInt(w.total_fills).toLocaleString()}`);
    console.log(`  Positions:    ${parseInt(w.total_positions).toLocaleString()}`);
    console.log('');
    console.log('Expected (from earlier script 101 run):');
    console.log('  P&L:          $158,529.85');
    console.log('  Volume:       $6,037,244.08');
    console.log('  Fills:        2,795');
    console.log('');

    const diff = parseFloat(w.total_realized_pnl) - 158529.85;
    const diffPct = (diff / 158529.85) * 100;
    console.log(`Difference:     $${diff.toFixed(2)} (${diffPct.toFixed(2)}%)`);
  } else {
    console.log('Test wallet not yet processed');
  }

  console.log('');
  console.log('Top 5 Wallets by Absolute P&L:');
  console.log('─────────────────────────────────────────────────────────────');

  const topResult = await clickhouse.query({
    query: `
      SELECT
        wallet,
        sum(realized_pnl) AS total_pnl,
        sum(volume) AS total_volume,
        count() AS positions
      FROM wallet_pnl_fifo
      GROUP BY wallet
      ORDER BY abs(total_pnl) DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const topData = await topResult.json<any[]>();
  topData.forEach((w, i) => {
    console.log(`${i + 1}. ${w.wallet.substring(0, 12)}...`);
    console.log(`   P&L:    $${parseFloat(w.total_pnl).toLocaleString()}`);
    console.log(`   Volume: $${parseFloat(w.total_volume).toLocaleString()}`);
    console.log(`   Positions: ${parseInt(w.positions)}`);
  });

  await clickhouse.close();
}

main().catch(console.error);
