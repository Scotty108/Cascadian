/**
 * 39: VERIFY BRIDGE SAMPLE
 *
 * Sanity check: Prove clob_fills -> ctf_token_map -> gamma_markets -> market_resolutions_final
 * is really consistent for real markets
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('39: VERIFY BRIDGE SAMPLE');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('Mission: Prove the bridge is real for 20 random recent fills\n');

  const query = await clickhouse.query({
    query: `
      WITH random_fills AS (
        SELECT
          fill_id,
          user_eoa AS wallet,
          asset_id,
          side,
          size,
          price,
          timestamp AS fill_timestamp
        FROM clob_fills
        WHERE timestamp >= '2025-08-01'
        ORDER BY rand()
        LIMIT 20
      )
      SELECT
        rf.fill_id,
        rf.wallet,
        substring(rf.asset_id, 1, 20) AS asset_id_short,
        ctm.condition_id_norm,
        substring(ctm.condition_id_norm, 1, 20) AS condition_id_short,
        ctm.question,
        ctm.outcome AS outcome_label,
        mr.winning_outcome,
        mr.payout_numerators,
        mr.winning_index,
        -- Parse outcome index from ctf_token_map outcome
        CASE
          WHEN ctm.outcome = 'Yes' THEN 0
          WHEN ctm.outcome = 'No' THEN 1
          WHEN ctm.outcome = 'Up' THEN 0
          WHEN ctm.outcome = 'Down' THEN 1
          ELSE 0
        END AS outcome_index,
        CASE
          WHEN (
            (ctm.outcome = 'Yes' AND mr.winning_outcome = 'Yes' AND mr.winning_index = 0)
            OR (ctm.outcome = 'No' AND mr.winning_outcome = 'No' AND mr.winning_index = 1)
            OR (ctm.outcome = 'Up' AND mr.winning_outcome = 'Up' AND mr.winning_index = 0)
            OR (ctm.outcome = 'Down' AND mr.winning_outcome = 'Down' AND mr.winning_index = 1)
            OR (ctm.outcome = mr.winning_outcome)
          ) THEN 1
          ELSE 0
        END AS is_winning_outcome
      FROM random_fills rf
      LEFT JOIN ctf_token_map ctm ON ctm.token_id = rf.asset_id
      LEFT JOIN market_resolutions_final mr ON mr.condition_id_norm = ctm.condition_id_norm
    `,
    format: 'JSONEachRow'
  });

  const samples: any[] = await query.json();

  console.log(`Retrieved ${samples.length} sample fills\n`);

  // Display compact table
  console.log('Bridge verification sample:');
  console.table(samples.map(s => ({
    asset_id: s.asset_id_short + '...',
    condition_id: s.condition_id_short + '...',
    question: s.question ? s.question.substring(0, 40) + '...' : 'null',
    outcome: s.outcome_label || 'null',
    winning: s.winning_outcome || 'null',
    payout: s.payout_numerators ? `[${s.payout_numerators.join(',')}]` : 'null',
    is_win: s.is_winning_outcome
  })));

  // Statistics
  const withCondition = samples.filter(s => s.condition_id_norm && s.condition_id_norm !== '');
  const withResolution = samples.filter(s => s.winning_outcome && s.winning_outcome !== 'null');
  const winners = samples.filter(s => s.is_winning_outcome === 1 && s.winning_outcome && s.winning_outcome !== 'null');
  const losers = samples.filter(s => s.is_winning_outcome === 0 && s.winning_outcome && s.winning_outcome !== 'null');

  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('STATISTICS:');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log(`Total samples: ${samples.length}`);
  console.log(`With condition_id (via ctf_token_map): ${withCondition.length}`);
  console.log(`With resolution (via market_resolutions_final): ${withResolution.length}`);
  console.log(`Winners: ${winners.length}`);
  console.log(`Losers: ${losers.length}`);
  console.log('');

  const bridgeSuccess = withCondition.length / samples.length * 100;
  const resolutionSuccess = withResolution.length / samples.length * 100;

  console.log(`Bridge success rate: ${bridgeSuccess.toFixed(1)}%`);
  console.log(`Resolution success rate: ${resolutionSuccess.toFixed(1)}%`);
  console.log('');

  if (bridgeSuccess >= 90 && resolutionSuccess >= 90) {
    console.log('✅ VERIFIED: Bridge is working correctly!');
  } else if (bridgeSuccess >= 70 && resolutionSuccess >= 70) {
    console.log('⚠️  WARNING: Bridge has some gaps but mostly working');
  } else {
    console.log('❌ FAILED: Bridge is not working correctly');
  }

  console.log('');
}

main().catch(console.error);
