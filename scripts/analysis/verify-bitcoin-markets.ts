#!/usr/bin/env npx tsx
/**
 * Verify Bitcoin market identification
 * Check what markets this wallet actually traded
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0x94a428cfa4f84b264e01f70d93d02bc96cb36356';

async function verifyBitcoinMarkets() {
  console.log(`=== Verifying Markets for ${WALLET} ===\n`);

  // Get all markets this wallet traded
  const marketsResult = await clickhouse.query({
    query: `
      SELECT
        f.condition_id,
        any(m.question) as question,
        count() as trades,
        sum(f.pnl_usd) as total_pnl
      FROM pm_trade_fifo_roi_v3 f
      LEFT JOIN (
        SELECT condition_id, any(question) as question
        FROM pm_market_metadata
        GROUP BY condition_id
      ) m ON f.condition_id = m.condition_id
      WHERE f.wallet = '${WALLET}'
      GROUP BY f.condition_id
      ORDER BY total_pnl DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });

  const markets = (await marketsResult.json()) as any[];

  console.log(`\n📊 Top 20 Markets by PnL:\n`);
  markets.forEach((m, i) => {
    const question = m.question || 'NO QUESTION FOUND';
    const pnl = parseFloat(m.total_pnl);
    const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(0)}` : `-$${Math.abs(pnl).toFixed(0)}`;

    console.log(`${i + 1}. ${pnlStr} (${m.trades} trades)`);
    console.log(`   ${question.slice(0, 100)}`);
    console.log(`   Condition: ${m.condition_id.slice(0, 32)}...`);
    console.log();
  });

  // Check if any are actually Bitcoin markets
  console.log('\n🔍 Checking for Bitcoin keywords in questions:\n');

  const bitcoinCount = markets.filter(m => {
    const q = (m.question || '').toLowerCase();
    return q.includes('bitcoin') || q.includes('btc');
  }).length;

  console.log(`Markets with "bitcoin" or "btc" in question: ${bitcoinCount}/${markets.length}`);
}

verifyBitcoinMarkets().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
