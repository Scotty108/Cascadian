import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: '8miOkWI~OhsDb',
  database: 'default'
});

async function understand() {
  const walletAddress = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';

  const query = `
    SELECT
      side,
      toFloat64(shares) as shares,
      toFloat64(entry_price) as entry_price,
      toFloat64(usd_value) as usd_value,
      toFloat64(entry_price * shares) as calculated_cost
    FROM trades_raw
    WHERE wallet_address = '${walletAddress}'
    LIMIT 20
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const data = await result.json();

  console.log('Understanding USD Value vs Entry Price * Shares:');
  console.log('='.repeat(100));
  data.forEach((row, idx) => {
    const shares = parseFloat(row.shares);
    const entry = parseFloat(row.entry_price);
    const usdValue = parseFloat(row.usd_value);
    const calcCost = parseFloat(row.calculated_cost);

    console.log(`\nRow ${idx + 1}: Side=${row.side}`);
    console.log(`  Shares: ${shares.toFixed(4)}, Entry Price: $${entry.toFixed(4)}`);
    console.log(`  USD Value (from table): $${usdValue.toFixed(2)}`);
    console.log(`  Calculated (entry * shares): $${calcCost.toFixed(2)}`);
    console.log(`  Difference: $${(usdValue - calcCost).toFixed(2)}`);
  });

  await client.close();
}

understand();
