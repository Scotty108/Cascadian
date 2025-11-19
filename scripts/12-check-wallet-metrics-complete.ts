import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function checkWalletMetricsComplete() {
  console.log('=== Checking wallet_metrics_complete ===\n');
  console.log('This table shows 1,385 trades for xcnstrategy');
  console.log('vs pm_wallet_market_pnl_v2 which only shows 173 trades');
  console.log('');

  // Get the full data
  const query = `
    SELECT *
    FROM wallet_metrics_complete
    WHERE lower(wallet_address) = lower('${EOA}')
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await result.json<any[]>();

  if (data.length > 0) {
    console.log('Found wallet metrics:\n');
    data.forEach(row => {
      console.log(`Window: ${row.window}`);
      console.log(`Category: ${row.category}`);
      console.log(`Trades Analyzed: ${row.trades_analyzed}`);
      console.log(`Resolved Trades: ${row.resolved_trades}`);
      console.log(`Track Record Days: ${row.track_record_days}`);
      console.log('');

      // Show all metrics
      console.log('All metrics:');
      Object.keys(row).forEach(key => {
        if (key.startsWith('metric_')) {
          console.log(`  ${key}: ${row[key]}`);
        }
      });
      console.log('');
      console.log('─'.repeat(60));
      console.log('');
    });

    // Check if there's an Omega score
    const lifetimeRow = data.find(r => r.window === 'lifetime' && r.category === 'All');
    if (lifetimeRow && lifetimeRow.metric_2_omega_net !== undefined) {
      console.log('Omega Net (metric_2): ', lifetimeRow.metric_2_omega_net);
      console.log('');

      // Omega can be used to back-calculate approximate PnL if we know the formula
      console.log('Note: Omega score can indicate profitability but doesnt directly give PnL.');
    }
  } else {
    console.log('No data found.');
  }

  console.log('');
  console.log('Key Question: Where does this table get its 1,385 trades from?');
  console.log('');

  // Try to find the source data
  console.log('Searching for the source of the 1,385 trades...\n');

  // Check if there's a different trades table
  const tradesCountQuery = `
    SELECT
      count() AS total_trades,
      min(timestamp) AS first_trade,
      max(timestamp) AS last_trade
    FROM vw_trades_canonical_current
    WHERE lower(wallet_address) = lower('${EOA}')
  `;

  const tradesResult = await clickhouse.query({ query: tradesCountQuery, format: 'JSONEachRow' });
  const tradesData = await tradesResult.json<any[]>();

  console.log('vw_trades_canonical_current:');
  console.log(`  Total trades: ${tradesData[0].total_trades}`);
  console.log(`  First trade: ${tradesData[0].first_trade}`);
  console.log(`  Last trade: ${tradesData[0].last_trade}`);
  console.log('');

  console.log('Hypothesis: wallet_metrics_complete might be using a different');
  console.log('trade source or including something we are not.');
  console.log('');

  // Check the calculated_at date
  if (data.length > 0 && data[0].calculated_at) {
    console.log(`Metrics calculated at: ${data[0].calculated_at}`);
    console.log('This might be stale data from before our database was updated.');
  }
}

checkWalletMetricsComplete().catch(console.error);
