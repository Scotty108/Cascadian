import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const wallet = '0xbf4f05a8b1d08f82d57697bb0bbfda19b0df5b24';

async function investigate() {
  console.log('INVESTIGATING TAKER WALLET TRADING PATTERN');
  console.log('='.repeat(100));

  // Get raw trades with full details
  const q = `
    SELECT
      event_id,
      side,
      usdc_amount / 1e6 as usdc,
      token_amount / 1e6 as tokens,
      token_id,
      trade_time,
      lower(hex(transaction_hash)) as tx_hash
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${wallet}'
      AND is_deleted = 0
    ORDER BY trade_time, event_id
    LIMIT 50
  `;

  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const rows = (await r.json()) as any[];

  console.log('\nFirst 50 raw trades (before dedup):');
  console.log('-'.repeat(100));

  for (const row of rows) {
    const suffix = row.event_id?.slice(-4) || '';
    const txShort = row.tx_hash?.slice(0, 8) || '';
    const tokenShort = row.token_id?.slice(0, 12) || '';
    console.log(
      `[${suffix}] ${row.side.padEnd(4)} $${Number(row.usdc).toFixed(4).padStart(8)} | ` +
      `${Number(row.tokens).toFixed(2).padStart(8)} tok | token:${tokenShort}... | tx:${txShort}...`
    );
  }

  // Check if same tx has both buy and sell for different tokens
  console.log('\n\nGrouped by transaction:');
  console.log('-'.repeat(100));

  const byTx = new Map<string, any[]>();
  for (const row of rows) {
    const tx = row.tx_hash;
    const existing = byTx.get(tx) || [];
    existing.push(row);
    byTx.set(tx, existing);
  }

  let multiTokenTxCount = 0;
  for (const [tx, trades] of Array.from(byTx.entries()).slice(0, 10)) {
    const uniqueTokens = new Set(trades.map(t => t.token_id));
    const uniqueSides = new Set(trades.map(t => t.side));
    console.log(`\nTX ${tx.slice(0, 16)}... (${uniqueTokens.size} tokens, ${uniqueSides.size} sides):`);
    for (const t of trades) {
      const tokenShort = t.token_id?.slice(0, 12) || '';
      const suffix = t.event_id?.slice(-4) || '';
      console.log(`  [${suffix}] ${t.side.padEnd(4)} $${Number(t.usdc).toFixed(4)} | ${Number(t.tokens).toFixed(2)} tok | token:${tokenShort}...`);
    }
    if (uniqueTokens.size > 1) multiTokenTxCount++;
  }

  console.log(`\n\nTransactions with multiple tokens: ${multiTokenTxCount}/10 sampled`);
}

investigate();
