import { createClient } from '@clickhouse/client';

const client = createClient({
  host: 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: '8miOkWI~OhsDb',
});

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('=== Investigating Resolution Data Sources ===\n');

  // 1. Check a specific condition ID in market_resolutions_final
  console.log('1. Checking market_resolutions_final for xcnstrategy conditions...');
  const checkResolutions = await client.query({
    query: `
      SELECT
        r.condition_id_norm,
        r.payout_numerators,
        r.payout_denominator,
        r.winning_index,
        r.winning_outcome,
        r.source
      FROM default.market_resolutions_final r
      WHERE r.condition_id_norm IN (
        SELECT condition_id_norm
        FROM default.pm_wallet_market_pnl_v2
        WHERE wallet_address = '${WALLET}'
          AND is_resolved = 1
        LIMIT 5
      )
    `,
    format: 'JSONEachRow',
  });
  const resolutions = await checkResolutions.json();
  console.log('Resolution records found:', resolutions.length);
  console.log(JSON.stringify(resolutions, null, 2));
  console.log('');

  // 2. Check gamma_resolved table
  console.log('2. Checking gamma_resolved table...');
  const gammaSchema = await client.query({
    query: `DESCRIBE TABLE default.gamma_resolved`,
    format: 'JSONEachRow',
  });
  const cols = await gammaSchema.json();
  console.log('gamma_resolved columns:', cols.map((c: any) => c.name).join(', '));
  console.log('');

  const gammaSample = await client.query({
    query: `SELECT * FROM default.gamma_resolved LIMIT 3`,
    format: 'JSONEachRow',
  });
  const gSample = await gammaSample.json();
  console.log('gamma_resolved sample:');
  console.log(JSON.stringify(gSample, null, 2));
  console.log('');

  // 3. Check why outcome_index = -1
  console.log('3. Investigating outcome_index = -1 positions...');
  const outcomeCheck = await client.query({
    query: `
      SELECT
        outcome_index,
        count(*) AS count,
        sum(final_position_size) AS total_shares
      FROM default.pm_wallet_market_pnl_v2
      WHERE wallet_address = '${WALLET}'
      GROUP BY outcome_index
      ORDER BY outcome_index
    `,
    format: 'JSONEachRow',
  });
  const outcomes = await outcomeCheck.json();
  console.log('Outcome index distribution:');
  console.log(JSON.stringify(outcomes, null, 2));
  console.log('');

  await client.close();
}

main().catch(console.error);
