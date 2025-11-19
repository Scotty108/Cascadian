#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0x7f3c8979d0afa00007bae4747d5347122af05613';

async function main() {
  console.log(`Checking USD value scale and precision...\n`);

  // Sample some trades
  const result = await clickhouse.query({
    query: `
      SELECT
        timestamp,
        trade_direction,
        shares,
        price,
        usd_value,
        toFloat64(shares) * toFloat64(price) AS calculated_value
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = lower('${WALLET}')
      ORDER BY timestamp DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });

  const trades = await result.json<Array<any>>();

  console.log('Sample Trades (most recent 20):');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Timestamp           | Dir  | Shares      | Price  | USD Value  | Calculated');
  console.log('─────────────────────────────────────────────────────────────────');

  trades.forEach((t, i) => {
    const ts = new Date(t.timestamp).toISOString().substring(0, 19);
    const dir = t.trade_direction.substring(0, 4);
    const shares = parseFloat(t.shares);
    const price = parseFloat(t.price);
    const usdValue = parseFloat(t.usd_value);
    const calculated = parseFloat(t.calculated_value);

    console.log(`${ts} | ${dir} | ${shares.toFixed(2).padStart(11)} | ${price.toFixed(4)} | $${usdValue.toFixed(2).padStart(9)} | $${calculated.toFixed(2).padStart(9)}`);
  });

  console.log();

  // Check total scale
  const totals = await clickhouse.query({
    query: `
      SELECT
        sum(toFloat64(usd_value)) AS total_usd_value,
        count() AS trade_count,
        sum(toFloat64(usd_value)) / count() AS avg_trade_size
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = lower('${WALLET}')
    `,
    format: 'JSONEachRow'
  });

  const t = (await totals.json<Array<any>>())[0];

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Total USD Value Analysis:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total USD Value:    $${parseFloat(t.total_usd_value).toLocaleString()}`);
  console.log(`  Trade Count:        ${parseInt(t.trade_count).toLocaleString()}`);
  console.log(`  Avg Trade Size:     $${parseFloat(t.avg_trade_size).toFixed(2)}`);
  console.log();

  const totalValue = parseFloat(t.total_usd_value);
  const expected = 1946260 + 4090984; // Buy + Sell from previous diagnostic

  console.log(`  Expected (buy+sell): $${expected.toLocaleString()}`);
  console.log(`  Actual total:        $${totalValue.toLocaleString()}`);
  console.log(`  Match:               ${Math.abs(totalValue - expected) < 1000 ? '✅' : '❌'}`);

  console.log();
  console.log('💡 Checking if Polymarket API uses different scale...');
  console.log('   Polymarket total: ~$185k realized P&L');
  console.log(`   Our trade P&L:    $${(4090984 - 1946260).toLocaleString()}`);
  console.log(`   Ratio:            ${((4090984 - 1946260) / 185000).toFixed(2)}x`);
}

main().catch(console.error);
