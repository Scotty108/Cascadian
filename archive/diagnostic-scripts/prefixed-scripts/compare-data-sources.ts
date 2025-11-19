import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('COMPARE DATA SOURCES: CLOB_FILLS VS TRADES_RAW');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Check date ranges
  console.log('Step 1: Compare date ranges...\n');

  const clobRange = await clickhouse.query({
    query: `
      SELECT
        count() AS trades,
        min(timestamp) AS first,
        max(timestamp) AS last
      FROM default.clob_fills
      WHERE lower(proxy_wallet) = lower('${WALLET}') OR lower(user_eoa) = lower('${WALLET}')
    `,
    format: 'JSONEachRow'
  });

  const clobData: any[] = await clobRange.json();
  const c = clobData[0];

  console.log(`clob_fills:`);
  console.log(`   Trades: ${c.trades}`);
  console.log(`   First: ${c.first}`);
  console.log(`   Last: ${c.last}\n`);

  const tradesRange = await clickhouse.query({
    query: `
      SELECT
        count() AS trades,
        min(block_time) AS first,
        max(block_time) AS last
      FROM default.trades_raw
      WHERE lower(wallet) = lower('${WALLET}')
    `,
    format: 'JSONEachRow'
  });

  const tradesData: any[] = await tradesRange.json();
  const t = tradesData[0];

  console.log(`trades_raw:`);
  console.log(`   Trades: ${t.trades}`);
  console.log(`   First: ${t.first}`);
  console.log(`   Last: ${t.last}\n`);

  // Check if trades_raw includes earlier history
  if (new Date(t.first) < new Date(c.first)) {
    const daysDiff = Math.floor(
      (new Date(c.first).getTime() - new Date(t.first).getTime()) / (1000 * 60 * 60 * 24)
    );
    console.log(`✅ trades_raw has ${daysDiff} days MORE history before clob_fills starts\n`);
  } else {
    console.log(`❌ clob_fills starts BEFORE or SAME as trades_raw\n`);
  }

  // Check BUY/SELL distribution in clob_fills
  console.log('Step 2: Check BUY/SELL in clob_fills...\n');

  const clobSides = await clickhouse.query({
    query: `
      SELECT
        side,
        count() AS count,
        sum(abs(size * price)) AS notional
      FROM default.clob_fills
      WHERE lower(proxy_wallet) = lower('${WALLET}') OR lower(user_eoa) = lower('${WALLET}')
      GROUP BY side
      ORDER BY count DESC
    `,
    format: 'JSONEachRow'
  });

  const clobSidesData: any[] = await clobSides.json();

  console.log('clob_fills side distribution:');
  clobSidesData.forEach(s => {
    console.log(`   ${s.side}: ${s.count} trades, $${parseFloat(s.notional).toLocaleString('en-US', { minimumFractionDigits: 2 })} notional\n`);
  });

  // Calculate net from clob_fills
  const buyNotional = clobSidesData.find(s => s.side === 'BUY')?.notional || 0;
  const sellNotional = clobSidesData.find(s => s.side === 'SELL')?.notional || 0;
  const buyCount = clobSidesData.find(s => s.side === 'BUY')?.count || 0;
  const sellCount = clobSidesData.find(s => s.side === 'SELL')?.count || 0;

  console.log(`Net cashflow (simple): $${(parseFloat(sellNotional) - parseFloat(buyNotional)).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`BUY/SELL ratio: ${buyCount}/${sellCount}\n`);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('CONCLUSION');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('trades_raw (674 trades):');
  console.log('   - 167 BUY: $173K spent');
  console.log('   - 501 SELL: $37K received');
  console.log('   - Net: -$136K (holding positions)\n');

  console.log('clob_fills (194 trades):');
  console.log(`   - ${buyCount} BUY: $${parseFloat(buyNotional).toLocaleString('en-US', { minimumFractionDigits: 0 })} spent`);
  console.log(`   - ${sellCount} SELL: $${parseFloat(sellNotional).toLocaleString('en-US', { minimumFractionDigits: 0 })} received`);
  console.log(`   - Net: $${(parseFloat(sellNotional) - parseFloat(buyNotional)).toLocaleString('en-US', { minimumFractionDigits: 0 })}\n`);

  console.log('Average cost P&L from clob_fills (194 fills): $3.51');
  console.log('   - Only 2 closed positions');
  console.log('   - 43 open positions worth $47K\n');

  console.log('Problem: Dune shows ~$80K realized P&L, but our calculations show:');
  console.log('   - trades_raw: -$136K net cashflow (not P&L)');
  console.log('   - clob_fills average cost: $3.51 realized P&L');
  console.log('   - clob_fills simple net: variable\n');

  console.log('Hypothesis: We\'re missing trades from BEFORE clob_fills starts (2024-08-22)');
  console.log('   - trades_raw goes back to 2024-08-21 (1 day earlier)');
  console.log('   - Dune might include ALL historical trades');
  console.log('   - Need to find complete historical fill data\n');

  console.log('Next step: Search for other fill/trade tables with earlier history\n');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
