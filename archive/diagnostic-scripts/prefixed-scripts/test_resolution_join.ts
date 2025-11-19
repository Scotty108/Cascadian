import { createClient } from '@clickhouse/client';

const client = createClient({
  host: 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: '8miOkWI~OhsDb',
});

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('Testing resolution data join to calculate correct settlement P&L...\n');

  // Check market_resolutions_final schema
  console.log('1. Checking market_resolutions_final schema...');
  const schema = await client.query({
    query: `DESCRIBE TABLE default.market_resolutions_final`,
    format: 'JSONEachRow',
  });
  const cols = await schema.json();
  console.log('Key columns:', cols.filter((c: any) =>
    c.name.includes('condition') || c.name.includes('market') || c.name.includes('outcome') || c.name.includes('payout')
  ).map((c: any) => c.name).join(', '));
  console.log('');

  // Try to join resolution data
  console.log('2. Attempting to calculate settlement P&L with resolution data...');
  const withResolution = await client.query({
    query: `
      SELECT
        p.condition_id_norm,
        p.market_id_norm,
        p.outcome_index,
        p.final_position_size,
        p.realized_pnl_usd,
        p.settlement_pnl_usd AS current_settlement,
        r.winning_index,
        r.payout_numerators,
        r.payout_denominator,
        arrayElement(r.payout_numerators, p.outcome_index + 1) / r.payout_denominator AS payout_per_share,
        CASE
          WHEN p.final_position_size > 0
          THEN p.final_position_size * (arrayElement(r.payout_numerators, p.outcome_index + 1) / r.payout_denominator)
          ELSE 0
        END AS correct_settlement_pnl,
        p.realized_pnl_usd + CASE
          WHEN p.final_position_size > 0
          THEN p.final_position_size * (arrayElement(r.payout_numerators, p.outcome_index + 1) / r.payout_denominator)
          ELSE 0
        END AS correct_combined_pnl
      FROM default.pm_wallet_market_pnl_v2 p
      LEFT JOIN default.market_resolutions_final r
        ON lower(p.condition_id_norm) = lower(r.condition_id_norm)
      WHERE p.wallet_address = '${WALLET}'
        AND p.is_resolved = 1
        AND p.final_position_size > 1000
      ORDER BY abs(p.realized_pnl_usd) DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const withRes = await withResolution.json();
  console.log('Sample positions with resolution data:');
  console.log(JSON.stringify(withRes, null, 2));
  console.log('');

  // Calculate total corrected P&L
  console.log('3. Calculating TOTAL corrected P&L for xcnstrategy...');
  const totalCorrected = await client.query({
    query: `
      SELECT
        sum(p.realized_pnl_usd) AS current_realized_pnl,
        sum(
          CASE
            WHEN p.final_position_size > 0 AND r.payout_numerators IS NOT NULL
            THEN p.final_position_size * (arrayElement(r.payout_numerators, p.outcome_index + 1) / r.payout_denominator)
            ELSE 0
          END
        ) AS correct_settlement_pnl,
        sum(p.realized_pnl_usd) + sum(
          CASE
            WHEN p.final_position_size > 0 AND r.payout_numerators IS NOT NULL
            THEN p.final_position_size * (arrayElement(r.payout_numerators, p.outcome_index + 1) / r.payout_denominator)
            ELSE 0
          END
        ) AS correct_combined_pnl,
        countIf(r.condition_id_norm IS NOT NULL) AS positions_with_resolution_data,
        count(*) AS total_positions
      FROM default.pm_wallet_market_pnl_v2 p
      LEFT JOIN default.market_resolutions_final r
        ON lower(p.condition_id_norm) = lower(r.condition_id_norm)
      WHERE p.wallet_address = '${WALLET}'
        AND p.is_resolved = 1
    `,
    format: 'JSONEachRow',
  });
  const total = (await totalCorrected.json())[0];
  console.log('CORRECTED TOTAL P&L:');
  console.log(JSON.stringify(total, null, 2));
  console.log('');

  await client.close();

  const correctedPnl = parseFloat(total.correct_combined_pnl);
  const settlement = parseFloat(total.correct_settlement_pnl);
  const difference = correctedPnl - (-206256.59);

  console.log('=== BREAKTHROUGH ===');
  console.log('Current (broken) P&L: -$206,256.59');
  console.log('Corrected P&L with settlement: $' + correctedPnl.toFixed(2));
  console.log('Settlement component: $' + settlement.toFixed(2));
  console.log('Difference: $' + difference.toFixed(2));
  console.log('');
  console.log('Sign correction: ' + (correctedPnl > 0 ? 'NEGATIVE → POSITIVE ✓' : 'Still negative'));
}

main().catch(console.error);
