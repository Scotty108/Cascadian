#!/usr/bin/env tsx
import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const xcnWallet = 'cce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('Testing xcnstrategy P&L with ghost markets:\n');
  console.log('='.repeat(80));
  console.log('');

  const query = await clickhouse.query({
    query: `
      SELECT
        wallet_address,
        condition_id,
        question,
        total_trades,
        total_bought,
        total_sold,
        net_shares,
        pnl_gross,
        pnl_net,
        data_sources
      FROM pm_wallet_market_pnl_resolved
      WHERE wallet_address = '${xcnWallet}'
      ORDER BY abs(pnl_net) DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });

  const results = await query.json<any>();

  if (results.length === 0) {
    console.log('❌ No P&L results found for xcnstrategy');
    console.log('');
    console.log('Debugging: Check if wallet exists in pm_trades_complete...');

    const tradeCheck = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as trade_count,
          COUNT(DISTINCT condition_id) as market_count,
          data_source
        FROM pm_trades_complete
        WHERE canonical_wallet_address = '${xcnWallet}'
        GROUP BY data_source
      `,
      format: 'JSONEachRow'
    });

    console.log('Checking pm_trades_complete for xcnstrategy trades:');
    console.log('');

    const tradeStats = await tradeCheck.json();
    console.table(tradeStats);

    return;
  }

  console.log(`✅ Found ${results.length} markets with P&L for xcnstrategy\n`);

  // Separate ghost markets vs CLOB markets
  const ghostMarkets = results.filter((r: any) =>
    r.data_sources && r.data_sources.includes('polymarket_data_api')
  );

  const clobMarkets = results.filter((r: any) =>
    r.data_sources && !r.data_sources.includes('polymarket_data_api')
  );

  console.log('Ghost Markets (external-only):');
  console.log('='.repeat(80));
  for (const row of ghostMarkets) {
    console.log(`\n${row.question.substring(0, 60)}...`);
    console.log(`  Condition ID: ${row.condition_id.substring(0, 16)}...`);
    console.log(`  Trades: ${row.total_trades}`);
    console.log(`  Shares Bought: ${parseFloat(row.total_bought).toLocaleString()}`);
    console.log(`  Shares Sold: ${parseFloat(row.total_sold).toLocaleString()}`);
    console.log(`  Net Shares: ${parseFloat(row.net_shares).toLocaleString()}`);
    console.log(`  P&L Gross: $${parseFloat(row.pnl_gross).toFixed(2)}`);
    console.log(`  P&L Net: $${parseFloat(row.pnl_net).toFixed(2)}`);
    console.log(`  Data Sources: ${row.data_sources.join(', ')}`);
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('Summary:');
  console.log('='.repeat(80));

  const totalGhostPnL = ghostMarkets.reduce((sum: number, r: any) => sum + parseFloat(r.pnl_net), 0);
  const totalClobPnL = clobMarkets.reduce((sum: number, r: any) => sum + parseFloat(r.pnl_net), 0);
  const grandTotal = totalGhostPnL + totalClobPnL;

  console.log(`Ghost Markets: ${ghostMarkets.length} markets, $${totalGhostPnL.toFixed(2)} P&L`);
  console.log(`CLOB Markets: ${clobMarkets.length} markets, $${totalClobPnL.toFixed(2)} P&L`);
  console.log(`Total: ${results.length} markets, $${grandTotal.toFixed(2)} P&L`);
  console.log('');
}

main().catch(console.error);
