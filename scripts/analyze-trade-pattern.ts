import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const wallet = '0xf918977ef9d3f101385eda508621d5f835fa9052';

async function analyzeTradePattern() {
  console.log('ANALYZING TRADE PATTERN FOR:', wallet);
  console.log('='.repeat(100));

  // Get all raw trades with event_id
  const q = `
    SELECT
      event_id,
      side,
      usdc_amount / 1e6 as usdc,
      token_amount / 1e6 as tokens,
      token_id,
      trade_time,
      lower(concat('0x', hex(transaction_hash))) as tx_hash
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${wallet}' AND is_deleted = 0
    ORDER BY trade_time, event_id
  `;

  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const rows = (await r.json()) as any[];

  console.log('Raw trades (' + rows.length + ' rows):\n');

  // Group by transaction_hash to see pattern
  const byTx = new Map<string, any[]>();
  for (const row of rows) {
    const tx = row.tx_hash?.substring(0, 20) || 'unknown';
    const existing = byTx.get(tx) || [];
    existing.push(row);
    byTx.set(tx, existing);
  }

  console.log('Grouped by transaction:\n');
  for (const [tx, trades] of byTx) {
    console.log('TX: ' + tx + '...');
    for (const t of trades) {
      const eventSuffix = t.event_id?.slice(-3) || '';
      console.log(`  [${eventSuffix}] ${t.side.padEnd(4)} $${Number(t.usdc).toFixed(6).padStart(12)} | ${Number(t.tokens).toFixed(6)} tokens | token:${t.token_id?.substring(0, 15)}...`);
    }
    console.log('');
  }

  // Analyze the -m and -t suffixes
  console.log('\n' + '='.repeat(100));
  console.log('EVENT ID SUFFIX ANALYSIS:');
  let mCount = 0, tCount = 0, noneCount = 0;
  for (const row of rows) {
    if (row.event_id?.endsWith('-m')) mCount++;
    else if (row.event_id?.endsWith('-t')) tCount++;
    else noneCount++;
  }
  console.log('  -m (maker): ' + mCount);
  console.log('  -t (taker): ' + tCount);
  console.log('  none: ' + noneCount);

  // Check what the ledger shows vs what we have
  console.log('\n' + '='.repeat(100));
  console.log('LEDGER COMPARISON:');
  console.log('\nLedger has 17 trades (excluding deposits):');
  console.log('  11 buys totaling ~$20.62');
  console.log('  3 sells totaling ~$6.56');
  console.log('  3 redemptions totaling ~$10.40');
  console.log('\nClickHouse has ' + rows.length + ' rows');

  const buys = rows.filter(r => r.side === 'buy');
  const sells = rows.filter(r => r.side === 'sell');
  const buyTotal = buys.reduce((s, r) => s + Number(r.usdc), 0);
  const sellTotal = sells.reduce((s, r) => s + Number(r.usdc), 0);

  console.log(`  ${buys.length} buys totaling $${buyTotal.toFixed(2)}`);
  console.log(`  ${sells.length} sells totaling $${sellTotal.toFixed(2)}`);

  // The issue: ledger shows 3 sells for $6.56, but ClickHouse shows more sells
  // Let's see what the "real" sells are (>$1)
  console.log('\n"Real" sells (>$0.50):');
  const realSells = sells.filter(s => Number(s.usdc) > 0.5);
  for (const s of realSells) {
    console.log(`  $${Number(s.usdc).toFixed(2)} for ${Number(s.tokens).toFixed(4)} tokens`);
  }

  console.log('\n"Spurious" sells (<$0.50):');
  const spuriousSells = sells.filter(s => Number(s.usdc) <= 0.5);
  console.log(`  ${spuriousSells.length} small sells totaling $${spuriousSells.reduce((s, r) => s + Number(r.usdc), 0).toFixed(2)}`);
}

analyzeTradePattern();
