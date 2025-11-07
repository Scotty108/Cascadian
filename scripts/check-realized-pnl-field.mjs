import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: '8miOkWI~OhsDb',
  database: 'default'
});

async function check() {
  const walletAddress = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';

  // Check if there are rows with resolved data
  const query = `
    SELECT
      count(*) as total_rows,
      sum(CASE WHEN is_resolved = 1 THEN 1 ELSE 0 END) as resolved_count,
      sum(CASE WHEN realized_pnl_usd != 0 THEN 1 ELSE 0 END) as nonzero_realized_pnl_count,
      sum(toFloat64(realized_pnl_usd)) as total_realized_pnl
    FROM trades_raw
    WHERE wallet_address = '${walletAddress}'
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const data = await result.json();

  console.log('Trades Raw Statistics:');
  console.log('='.repeat(80));
  console.log(`Total Rows: ${data[0].total_rows}`);
  console.log(`Resolved Count (is_resolved=1): ${data[0].resolved_count}`);
  console.log(`Non-zero realized_pnl_usd Count: ${data[0].nonzero_realized_pnl_count}`);
  console.log(`Total Realized P&L: $${parseFloat(data[0].total_realized_pnl).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);

  // Check a few resolved rows if they exist
  if (parseInt(data[0].resolved_count) > 0) {
    const resolvedQuery = `
      SELECT
        side,
        toFloat64(shares) as shares,
        toFloat64(entry_price) as entry_price,
        toFloat64(usd_value) as usd_value,
        toFloat64(realized_pnl_usd) as realized_pnl_usd,
        outcome_index,
        resolved_outcome
      FROM trades_raw
      WHERE wallet_address = '${walletAddress}'
        AND is_resolved = 1
      LIMIT 10
    `;

    const resolvedResult = await client.query({ query: resolvedQuery, format: 'JSONEachRow' });
    const resolvedData = await resolvedResult.json();

    console.log('\nSample Resolved Rows:');
    console.log('='.repeat(80));
    resolvedData.forEach((row, idx) => {
      console.log(`\nRow ${idx + 1}:`);
      console.log(`  Side: ${row.side}, Outcome: ${row.outcome_index}, Resolved: ${row.resolved_outcome}`);
      console.log(`  Shares: ${parseFloat(row.shares).toFixed(4)}, Entry: $${parseFloat(row.entry_price).toFixed(4)}`);
      console.log(`  USD Value: $${parseFloat(row.usd_value).toFixed(2)}`);
      console.log(`  Realized P&L: $${parseFloat(row.realized_pnl_usd).toFixed(2)}`);
    });
  }

  await client.close();
}

check();
