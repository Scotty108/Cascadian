import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('TRADE COVERAGE ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Total trades
  const tradesQuery = await clickhouse.query({
    query: `
      SELECT
        count() AS total_trades,
        countIf(side = 'BUY') AS buy_trades,
        countIf(side = 'SELL') AS sell_trades,
        sum(toFloat64(size) / 1e6) AS total_volume,
        sum(toFloat64(size * price) / 1e6) AS total_notional
      FROM clob_fills
      WHERE lower(user_eoa) = lower('${wallet}')
        AND asset_id NOT IN ('asset','')
    `,
    format: 'JSONEachRow'
  });
  const trades = await tradesQuery.json();

  console.log('Trade Summary:');
  console.log(`   Total trades: ${trades[0].total_trades}`);
  console.log(`   Buy trades: ${trades[0].buy_trades}`);
  console.log(`   Sell trades: ${trades[0].sell_trades}`);
  console.log(`   Total volume: ${Number(trades[0].total_volume).toLocaleString()} shares`);
  console.log(`   Total notional: $${Number(trades[0].total_notional).toLocaleString()}\n`);

  // Unique markets
  const marketsQuery = await clickhouse.query({
    query: `
      SELECT count(DISTINCT condition_id) AS unique_markets
      FROM clob_fills
      WHERE lower(user_eoa) = lower('${wallet}')
        AND asset_id NOT IN ('asset','')
    `,
    format: 'JSONEachRow'
  });
  const markets = await marketsQuery.json();

  console.log(`   Unique markets traded: ${markets[0].unique_markets}\n`);

  // Date range
  const dateQuery = await clickhouse.query({
    query: `
      SELECT
        min(timestamp) AS first_trade,
        max(timestamp) AS last_trade,
        dateDiff('day', first_trade, last_trade) AS days_active
      FROM clob_fills
      WHERE lower(user_eoa) = lower('${wallet}')
        AND asset_id NOT IN ('asset','')
    `,
    format: 'JSONEachRow'
  });
  const dates = await dateQuery.json();

  console.log(`   First trade: ${dates[0].first_trade}`);
  console.log(`   Last trade: ${dates[0].last_trade}`);
  console.log(`   Days active: ${dates[0].days_active}\n`);

  // Check biggest winning positions
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('TOP 10 POSITIONS BY |P&L|');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const topPnlQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_ctf,
        gross_cf,
        realized_payout,
        pnl_net
      FROM wallet_condition_pnl
      WHERE lower(wallet) = lower('${wallet}')
      ORDER BY abs(pnl_net) DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const topPnl: any[] = await topPnlQuery.json();

  topPnl.forEach((p, i) => {
    console.log(`${(i + 1).toString().padStart(2)}. ${p.condition_id_ctf.substring(0, 12)}...`);
    console.log(`    cf=$${Number(p.gross_cf).toFixed(2)}, payout=$${Number(p.realized_payout).toFixed(2)}, pnl=$${Number(p.pnl_net).toFixed(2)}`);
  });

  const totalPnl = topPnl.reduce((sum, p) => sum + Number(p.pnl_net), 0);
  console.log(`\n   Top 10 total: $${totalPnl.toFixed(2)}`);

  // Compare to DOME baseline
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('COMPARISON TO DOME');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const dbPnlQuery = await clickhouse.query({
    query: `
      SELECT pnl_net
      FROM wallet_realized_pnl
      WHERE lower(wallet) = lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });
  const dbPnl = await dbPnlQuery.json();

  console.log(`   Our P&L: $${Number(dbPnl[0].pnl_net).toLocaleString()}`);
  console.log(`   DOME P&L: $87,030.51`);
  console.log(`   Gap: $${(87030.51 - Number(dbPnl[0].pnl_net)).toLocaleString()}`);
  console.log(`   Ratio: ${(Number(dbPnl[0].pnl_net) / 87030.51 * 100).toFixed(1)}% of DOME\n`);

  console.log('Hypotheses for $72K gap:');
  console.log('   1. Missing trades in clob_fills (data coverage <100%)');
  console.log('   2. DOME includes other data sources (ERC1155 transfers?)');
  console.log('   3. Different time windows');
  console.log('   4. DOME counts unredeemed value differently');
  console.log('   5. Fee accounting differences\n');

  // Check if there are ERC1155 transfers we're not counting
  console.log('Checking ERC1155 transfer coverage...');

  const erc1155Query = await clickhouse.query({
    query: `
      SELECT count() AS transfer_count
      FROM erc1155_transfers
      WHERE lower(to_address) = lower('${wallet}')
         OR lower(from_address) = lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });
  const erc1155 = await erc1155Query.json();

  console.log(`   ERC1155 transfers involving this wallet: ${erc1155[0].transfer_count}`);
  console.log(`   CLOB fills: ${trades[0].total_trades}`);

  if (erc1155[0].transfer_count > trades[0].total_trades) {
    console.log(`\n   ⚠️  There are ${erc1155[0].transfer_count - trades[0].total_trades} more ERC1155 transfers than CLOB fills!`);
    console.log(`   This could be:`)
    console.log(`      • Redemptions (claiming winnings)`);
    console.log(`      • Direct transfers (not trades)`);
    console.log(`      • OTC trades not on CLOB`);
    console.log(`\n   We should investigate if these contribute to P&L.\n`);
  }
}

main().catch(console.error);
