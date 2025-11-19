import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('P&L WITH RESOLUTION VALUE (Your Method)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Method:');
  console.log('   - Shares SOLD = count as realized at sale price');
  console.log('   - Shares HELD = will resolve to $1 (win) or $0 (lose)\n');

  // Get all trades
  const tradesQuery = await clickhouse.query({
    query: `
      SELECT
        trade_direction,
        count() as trade_count,
        sum(toFloat64(shares)) as total_shares,
        sum(toFloat64(usd_value)) as total_usd
      FROM default.vw_trades_canonical
      WHERE wallet_address_norm = lower('${WALLET}')
        AND trade_direction IN ('BUY', 'SELL')
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      GROUP BY trade_direction
    `,
    format: 'JSONEachRow'
  });

  const summary: any[] = await tradesQuery.json();

  let buyShares = 0, buyValue = 0, buyTrades = 0;
  let sellShares = 0, sellValue = 0, sellTrades = 0;

  summary.forEach(s => {
    if (s.trade_direction === 'BUY') {
      buyShares = parseFloat(s.total_shares);
      buyValue = parseFloat(s.total_usd);
      buyTrades = parseInt(s.trade_count);
    } else {
      sellShares = parseFloat(s.total_shares);
      sellValue = parseFloat(s.total_usd);
      sellTrades = parseInt(s.trade_count);
    }
  });

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('TRADE SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`BUY trades: ${buyTrades}`);
  console.log(`   Shares acquired: ${buyShares.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
  console.log(`   Money spent: $${buyValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`   Avg price: $${(buyValue / buyShares).toFixed(4)}\n`);

  console.log(`SELL trades: ${sellTrades}`);
  console.log(`   Shares sold: ${sellShares.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
  console.log(`   Money received: $${sellValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`   Avg price: $${(sellValue / sellShares).toFixed(4)}\n`);

  const netShares = buyShares - sellShares;
  const netCash = sellValue - buyValue;

  console.log(`NET POSITION:`);
  console.log(`   Shares held: ${netShares.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
  console.log(`   Net cash flow: $${netCash.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('RESOLUTION VALUE CALCULATION');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Components:\n');

  console.log('1. REALIZED (from sold shares):');
  console.log(`   You received: $${sellValue.toLocaleString('en-US', { minimumFractionDigits: 2 })} for selling ${sellShares.toLocaleString()} shares`);
  console.log(`   Cost unknown (positions opened before data)`);
  console.log(`   Realized P&L: UNKNOWN (need cost basis)\n`);

  console.log('2. UNREALIZED (from held shares):');
  console.log(`   You hold: ${netShares.toLocaleString('en-US', { maximumFractionDigits: 2 })} shares`);
  console.log(`   Cost basis: $${buyValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);

  console.log('   Scenario A - ALL POSITIONS WIN (resolve to $1):');
  console.log(`      Resolution payout: ${netShares.toLocaleString('en-US', { maximumFractionDigits: 2 })} shares × $1 = $${netShares.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`      Cost: $${buyValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`      Unrealized P&L: $${(netShares - buyValue).toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);

  console.log('   Scenario B - ALL POSITIONS LOSE (resolve to $0):');
  console.log(`      Resolution payout: $0`);
  console.log(`      Cost: $${buyValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`      Unrealized P&L: -$${buyValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);

  console.log('   Scenario C - 50/50 MIX:');
  const halfPayout = netShares * 0.5;
  console.log(`      Resolution payout: ~$${halfPayout.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`      Cost: $${buyValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`      Unrealized P&L: ~$${(halfPayout - buyValue).toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('TOTAL P&L RANGE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Assuming the SOLD shares had ZERO cost basis (best case):');
  console.log(`   Realized from sales: +$${sellValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`   Unrealized (if all win): +$${(netShares - buyValue).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`   TOTAL (all win): +$${(sellValue + netShares - buyValue).toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);

  console.log(`   Realized from sales: +$${sellValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`   Unrealized (if all lose): -$${buyValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`   TOTAL (all lose): -$${(buyValue - sellValue).toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);

  const totalBestCase = sellValue + netShares - buyValue;
  const totalWorstCase = -(buyValue - sellValue);
  const total50Case = sellValue + halfPayout - buyValue;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('COMPARISON TO DUNE ($80K)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Dune reported: ~$80,000\n`);

  console.log('Our calculation (assuming sold shares = pure profit):');
  console.log(`   Best case (all win):  +$${Math.round(totalBestCase).toLocaleString()}`);
  console.log(`   50/50 scenario:       ${total50Case > 0 ? '+' : ''}$${Math.round(total50Case).toLocaleString()}`);
  console.log(`   Worst case (all lose): $${Math.round(totalWorstCase).toLocaleString()}\n`);

  if (Math.abs(total50Case - 80000) < 20000) {
    console.log(`✅ 50/50 scenario ($${Math.round(total50Case).toLocaleString()}) is CLOSE to Dune's $80K!`);
    console.log('   This suggests Dune uses resolution value methodology!\n');
  } else if (Math.abs(totalBestCase - 80000) < 20000) {
    console.log(`✅ Best case ($${Math.round(totalBestCase).toLocaleString()}) is CLOSE to Dune's $80K!`);
    console.log('   This suggests most positions are winning!\n');
  } else {
    console.log('⚠️  Still not matching Dune. Possible reasons:');
    console.log('   1. Need actual cost basis for sold shares (not zero)');
    console.log('   2. Dune uses different resolution assumptions');
    console.log('   3. Still missing historical data\n');
  }

  const winRateNeeded = ((80000 + buyValue - sellValue) / netShares) * 100;
  console.log(`To reach $80K, need ${winRateNeeded.toFixed(1)}% of held positions to WIN\n`);

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
