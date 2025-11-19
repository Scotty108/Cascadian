import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('DEBUG: WHY AREN\'T SELL TRADES BEING PROCESSED?');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Get sample BUY and SELL trades
  const tradesQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        outcome_index,
        timestamp,
        trade_direction,
        toFloat64(shares) as shares,
        toFloat64(entry_price) as entry_price,
        toFloat64(usd_value) as usd_value
      FROM default.vw_trades_canonical
      WHERE wallet_address_norm = lower('${WALLET}')
        AND trade_direction IN ('BUY', 'SELL')
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      ORDER BY timestamp ASC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });

  const trades: any[] = await tradesQuery.json();

  console.log('First 20 trades:\n');

  trades.forEach((t, i) => {
    const key = `${t.condition_id_norm}_${t.outcome_index}`;
    console.log(`${i + 1}. ${t.trade_direction.padEnd(4)} | ${t.timestamp} | ${key.substring(0, 30)}... | ${t.shares} shares @ $${t.entry_price}`);
  });

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('PATTERN ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Check if any BUYs come before SELLs in chronological order
  const buyTrades = trades.filter(t => t.trade_direction === 'BUY');
  const sellTrades = trades.filter(t => t.trade_direction === 'SELL');

  console.log(`   BUYs in first 20: ${buyTrades.length}`);
  console.log(`   SELLs in first 20: ${sellTrades.length}\n`);

  if (buyTrades.length === 0 && sellTrades.length > 0) {
    console.log('🚨 PROBLEM FOUND:');
    console.log('   All early trades are SELLs (shorting or data issue)');
    console.log('   Agent\'s code only processes SELLs IF there are prior BUYs');
    console.log('   This is why $0 sold value despite 501 SELL trades!\n');
  }

  // Check first occurrence of each direction
  const firstBuy = trades.find(t => t.trade_direction === 'BUY');
  const firstSell = trades.find(t => t.trade_direction === 'SELL');

  console.log('First BUY:', firstBuy ? firstBuy.timestamp : 'NONE');
  console.log('First SELL:', firstSell ? firstSell.timestamp : 'NONE');

  if (firstSell && (!firstBuy || new Date(firstSell.timestamp) < new Date(firstBuy.timestamp))) {
    console.log('\n⚠️  SELLs come BEFORE BUYs chronologically!');
    console.log('   This could be:');
    console.log('   1. Short selling (opening short positions)');
    console.log('   2. Data ordering issue');
    console.log('   3. Trades from positions opened before data collection\n');
  }

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
