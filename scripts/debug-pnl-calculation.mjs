import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: '8miOkWI~OhsDb',
  database: 'default'
});

async function debug() {
  const walletAddress = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';
  const snapshot = '2025-10-31 23:59:59';

  // Check sample fills with resolutions
  const query = `
    WITH deduped_fills AS (
      SELECT DISTINCT
        transaction_hash,
        wallet_address,
        timestamp,
        side,
        shares,
        entry_price,
        usd_value,
        market_id,
        outcome_index,
        fee_usd,
        slippage_usd
      FROM trades_raw
      WHERE wallet_address = '${walletAddress}'
        AND timestamp <= '${snapshot}'
    ),

    fills_with_resolution AS (
      SELECT
        f.*,
        c.condition_id_norm,
        r.winning_index
      FROM deduped_fills f
      ANY LEFT JOIN canonical_condition c ON f.market_id = c.market_id
      ANY LEFT JOIN market_resolutions_final r ON c.condition_id_norm = r.condition_id_norm
    )

    SELECT
      side,
      outcome_index,
      winning_index,
      toFloat64(shares) as shares,
      toFloat64(entry_price) as entry_price,
      toFloat64(entry_price * shares) as cost,
      CASE WHEN outcome_index = winning_index THEN toFloat64(shares) ELSE 0 END as settlement,
      CASE WHEN outcome_index = winning_index THEN 'WIN' ELSE 'LOSE' END as result
    FROM fills_with_resolution
    WHERE winning_index IS NOT NULL
    LIMIT 20
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const data = await result.json();

  console.log('Sample fills with resolution data:');
  console.log('='.repeat(120));
  data.forEach((row, idx) => {
    console.log(`Row ${idx + 1}: Side=${row.side}, Outcome=${row.outcome_index}, Winning=${row.winning_index}, Result=${row.result}`);
    const shares = parseFloat(row.shares);
    const entry = parseFloat(row.entry_price);
    const cost = parseFloat(row.cost);
    const settlement = parseFloat(row.settlement);
    console.log(`   Shares=${shares.toFixed(4)}, Entry=$${entry.toFixed(4)}, Cost=$${cost.toFixed(2)}, Settlement=$${settlement.toFixed(2)}`);
    console.log(`   PnL=$${(settlement - cost).toFixed(2)}`);
    console.log('');
  });

  // Check empty market_id issue
  const emptyMarketQuery = `
    SELECT count(*) as cnt
    FROM trades_raw
    WHERE wallet_address = '${walletAddress}'
      AND market_id = ''
      AND timestamp <= '${snapshot}'
  `;

  const emptyResult = await client.query({ query: emptyMarketQuery, format: 'JSONEachRow' });
  const emptyData = await emptyResult.json();
  console.log(`Empty market_id count: ${emptyData[0].cnt}`);

  await client.close();
}

debug();
