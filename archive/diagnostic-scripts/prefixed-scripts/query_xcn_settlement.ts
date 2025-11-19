import { createClient } from '@clickhouse/client';

const client = createClient({
  host: 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: '8miOkWI~OhsDb',
});

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('=== XCNStrategy Settlement PnL Prototype ===\n');

  // Summary so far
  console.log('CRITICAL FINDINGS:');
  console.log('- Current realized P&L: -$206,256.59');
  console.log('- Settlement P&L: $0.00 (NOT IMPLEMENTED)');
  console.log('- Resolved positions with holdings: 62 out of 90');
  console.log('- winning_outcome data: MISSING (empty strings)\n');

  // Check resolution data quality
  console.log('1. Checking resolution data quality...');
  const resolutionQuality = await client.query({
    query: `
      SELECT
        countIf(winning_outcome != '' AND winning_outcome IS NOT NULL) AS with_winning_outcome,
        countIf(winning_outcome = '' OR winning_outcome IS NULL) AS missing_winning_outcome,
        countIf(payout_per_share IS NOT NULL AND payout_per_share > 0) AS with_payout,
        countIf(payout_per_share IS NULL OR payout_per_share = 0) AS missing_payout,
        count(*) AS total
      FROM default.pm_wallet_market_pnl_v2
      WHERE wallet_address = '${WALLET}'
        AND is_resolved = 1
    `,
    format: 'JSONEachRow',
  });
  const quality = (await resolutionQuality.json())[0];
  console.log('Resolution Data Quality:');
  console.log(JSON.stringify(quality, null, 2));
  console.log('');

  // Check if there's a separate resolution source
  console.log('2. Searching for resolution data in other tables...');
  const tables = ['pm_gamma_markets_resolved', 'pm_market_resolutions_final', 'pm_markets_resolution_status'];
  
  for (const table of tables) {
    try {
      const checkTable = await client.query({
        query: `SELECT count(*) as count FROM default.${table} LIMIT 1`,
        format: 'JSONEachRow',
      });
      const result = (await checkTable.json())[0];
      console.log(`  ✓ ${table}: ${result.count} rows`);
    } catch (e: any) {
      console.log(`  ✗ ${table}: ${e.message}`);
    }
  }
  console.log('');

  // Calculate THEORETICAL settlement if we had resolution data
  console.log('3. Theoretical settlement calculation (if payout_per_share = $1.00 for wins)...');
  const theoretical = await client.query({
    query: `
      SELECT
        sum(final_position_size) AS total_shares_held,
        sum(CASE WHEN final_position_size > 0 THEN final_position_size ELSE 0 END) AS long_shares,
        sum(CASE WHEN final_position_size < 0 THEN final_position_size ELSE 0 END) AS short_shares,
        count(*) AS positions_with_holdings
      FROM default.pm_wallet_market_pnl_v2
      WHERE wallet_address = '${WALLET}'
        AND is_resolved = 1
        AND final_position_size != 0
    `,
    format: 'JSONEachRow',
  });
  const theo = (await theoretical.json())[0];
  console.log('Theoretical Settlement Potential:');
  console.log(JSON.stringify(theo, null, 2));
  console.log('');
  
  // If we assume 50% win rate at $1.00 payout
  const longShares = parseFloat(theo.long_shares);
  const estimatedSettlement = longShares * 0.5 * 1.0; // 50% win rate, $1 payout
  console.log(`Estimated settlement (50% win rate, $1 payout): $${estimatedSettlement.toFixed(2)}`);
  console.log(`Estimated combined P&L: $${(-206256.59 + estimatedSettlement).toFixed(2)}`);
  console.log('');

  // Look at outcome_index distribution
  console.log('4. Outcome index distribution...');
  const outcomesDist = await client.query({
    query: `
      SELECT
        outcome_index,
        count(*) AS positions,
        sum(final_position_size) AS total_shares,
        sum(realized_pnl_usd) AS realized_pnl
      FROM default.pm_wallet_market_pnl_v2
      WHERE wallet_address = '${WALLET}'
        AND is_resolved = 1
      GROUP BY outcome_index
      ORDER BY outcome_index
    `,
    format: 'JSONEachRow',
  });
  const outcomes = await outcomesDist.json();
  console.log('Outcome Index Distribution:');
  console.log(JSON.stringify(outcomes, null, 2));
  console.log('');

  // Sample specific conditions to check external resolution data
  console.log('5. Sample condition IDs for external lookup...');
  const sampleConditions = await client.query({
    query: `
      SELECT
        condition_id_norm,
        market_id_norm,
        final_position_size,
        realized_pnl_usd,
        outcome_index
      FROM default.pm_wallet_market_pnl_v2
      WHERE wallet_address = '${WALLET}'
        AND is_resolved = 1
        AND final_position_size > 1000
      ORDER BY abs(realized_pnl_usd) DESC
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const samples = await sampleConditions.json();
  console.log('Top 5 Conditions (for manual resolution lookup):');
  console.log(JSON.stringify(samples, null, 2));
  console.log('');

  await client.close();
  
  console.log('\n=== CONCLUSION ===');
  console.log('1. settlement_pnl_usd column EXISTS but is all zeros');
  console.log('2. winning_outcome and payout_per_share are NULL/empty');
  console.log('3. 62 resolved positions have final_position_size > 0');
  console.log('4. These positions SHOULD contribute settlement P&L');
  console.log('5. Current P&L of -$206k is MISSING settlement component');
  console.log('6. Need to populate resolution data to calculate correct settlement P&L\n');
}

main().catch(console.error);
