import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: '8miOkWI~OhsDb',
  database: 'default'
});

async function investigate() {
  const walletAddress = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';

  // Check what realized_pnl_usd, pnl_net, and other P&L fields contain
  const query = `
    SELECT
      side,
      toFloat64(shares) as shares,
      toFloat64(entry_price) as entry_price,
      toFloat64(exit_price) as exit_price,
      toFloat64(usd_value) as usd_value,
      toFloat64(pnl) as pnl,
      toFloat64(pnl_gross) as pnl_gross,
      toFloat64(pnl_net) as pnl_net,
      toFloat64(realized_pnl_usd) as realized_pnl_usd,
      is_closed,
      is_resolved,
      outcome_index,
      resolved_outcome
    FROM trades_raw
    WHERE wallet_address = '${walletAddress}'
    LIMIT 20
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const data = await result.json();

  console.log('Sample trades_raw data:');
  console.log('='.repeat(140));
  data.forEach((row, idx) => {
    console.log(`\nRow ${idx + 1}:`);
    console.log(`  Side: ${row.side}, Shares: ${parseFloat(row.shares).toFixed(4)}`);
    console.log(`  Entry: $${parseFloat(row.entry_price).toFixed(4)}, Exit: ${row.exit_price ? '$' + parseFloat(row.exit_price).toFixed(4) : 'null'}`);
    console.log(`  USD Value: $${parseFloat(row.usd_value).toFixed(2)}`);
    console.log(`  PnL: ${row.pnl ? '$' + parseFloat(row.pnl).toFixed(2) : 'null'}, PnL Gross: $${parseFloat(row.pnl_gross).toFixed(2)}, PnL Net: $${parseFloat(row.pnl_net).toFixed(2)}`);
    console.log(`  Realized P&L USD: $${parseFloat(row.realized_pnl_usd).toFixed(2)}`);
    console.log(`  Is Closed: ${row.is_closed}, Is Resolved: ${row.is_resolved}`);
    console.log(`  Outcome Index: ${row.outcome_index}, Resolved Outcome: ${row.resolved_outcome}`);
  });

  // Check aggregated realized_pnl_usd
  const aggregateQuery = `
    SELECT
      sum(toFloat64(realized_pnl_usd)) as total_realized_pnl
    FROM trades_raw
    WHERE wallet_address = '${walletAddress}'
  `;

  const aggResult = await client.query({ query: aggregateQuery, format: 'JSONEachRow' });
  const aggData = await aggResult.json();
  console.log(`\n${'='.repeat(140)}`);
  console.log(`\nTotal Realized P&L USD (from trades_raw): $${parseFloat(aggData[0].total_realized_pnl).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);

  await client.close();
}

investigate();
