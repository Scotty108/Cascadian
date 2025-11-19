import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

interface TokenAnalysis {
  token_ids: number;
  market_ids: number;
  sample_same_market: Array<{
    condition_id_norm: string;
    last_2_chars: string;
    wallet: string;
    amount: number;
  }>;
  backfill_targets_old: number;
  backfill_targets_new: number;
  gamma_test_result: any;
}

async function diagnoseTokenVsMarketID(): Promise<TokenAnalysis> {
  console.log('=== DIAGNOSING TOKEN ID vs MARKET ID CONFUSION ===\n');

  // 1. Count token IDs vs market IDs
  console.log('1. Counting unique token IDs vs market IDs...');
  const countResult = await clickhouse.query({
    query: `
      SELECT
        count(DISTINCT condition_id_norm) as token_ids,
        count(DISTINCT concat(left(replaceAll(condition_id_norm, '0x', ''), 62), '00')) as market_ids
      FROM default.vw_trades_canonical
      WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND condition_id_norm != ''
    `,
    format: 'JSONEachRow'
  });

  const counts = await countResult.json() as any[];
  const tokenCount = parseInt(counts[0].token_ids);
  const marketCount = parseInt(counts[0].market_ids);

  console.log(`   Token IDs: ${tokenCount.toLocaleString()}`);
  console.log(`   Market IDs: ${marketCount.toLocaleString()}`);
  console.log(`   Ratio: ${(tokenCount / marketCount).toFixed(2)}x\n`);

  // 2. Sample trades from what should be the same market
  console.log('2. Sampling trades from a single market to check suffix variation...');
  const sampleResult = await clickhouse.query({
    query: `
      WITH market_sample AS (
        SELECT concat(left(replaceAll(condition_id_norm, '0x', ''), 62), '00') as market_base
        FROM default.vw_trades_canonical
        WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        LIMIT 1
      )
      SELECT
        t.condition_id_norm,
        right(replaceAll(t.condition_id_norm, '0x', ''), 2) as last_2_chars,
        t.wallet_address_norm,
        t.usd_value
      FROM default.vw_trades_canonical t
      WHERE concat(left(replaceAll(t.condition_id_norm, '0x', ''), 62), '00') = (SELECT market_base FROM market_sample)
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });

  const sample = await sampleResult.json() as any[];
  console.log(`   Sampled ${sample.length} trades from same market:`);

  const suffixes = new Set(sample.map(s => s.last_2_chars));
  console.log(`   Unique suffixes: ${Array.from(suffixes).join(', ')}`);
  console.log(`   Suffix variation: ${suffixes.size > 1 ? 'YES - CONFIRMS TOKEN ID STORAGE' : 'NO'}\n`);

  if (sample.length > 0) {
    console.log('   Sample trades:');
    sample.slice(0, 5).forEach((s, i) => {
      console.log(`     ${i+1}. ...${s.condition_id_norm.slice(-8)} (suffix: ${s.last_2_chars})`);
    });
    console.log();
  }

  // 3. Count old vs new backfill targets
  console.log('3. Comparing backfill target counts...');

  const oldTargetsResult = await clickhouse.query({
    query: `
      SELECT count(*) as cnt
      FROM (
        SELECT DISTINCT condition_id_norm
        FROM default.vw_trades_canonical
        WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          AND condition_id_norm != ''
      ) t
      LEFT JOIN default.market_resolutions_final r
        ON lower(r.condition_id_norm) = lower(replaceAll(t.condition_id_norm, '0x', ''))
      WHERE r.condition_id_norm IS NULL
    `,
    format: 'JSONEachRow'
  });

  const oldTargets = await oldTargetsResult.json() as any[];
  const oldCount = parseInt(oldTargets[0].cnt);

  const newTargetsResult = await clickhouse.query({
    query: `
      SELECT count(*) as cnt
      FROM (
        SELECT DISTINCT concat(left(replaceAll(condition_id_norm, '0x', ''), 62), '00') as market_cid
        FROM default.vw_trades_canonical
        WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          AND condition_id_norm != ''
      ) m
      LEFT JOIN default.market_resolutions_final r
        ON lower(r.condition_id_norm) = lower(m.market_cid)
      WHERE r.condition_id_norm IS NULL
    `,
    format: 'JSONEachRow'
  });

  const newTargets = await newTargetsResult.json() as any[];
  const newCount = parseInt(newTargets[0].cnt);

  console.log(`   OLD (token-level): ${oldCount.toLocaleString()} targets`);
  console.log(`   NEW (market-level): ${newCount.toLocaleString()} targets`);
  console.log(`   Reduction: ${((1 - newCount/oldCount) * 100).toFixed(1)}%\n`);

  // 4. Test Gamma API with known resolved market
  console.log('4. Testing Gamma API with known resolved market...');
  const knownMarketResult = await clickhouse.query({
    query: `
      SELECT condition_id_norm
      FROM default.market_resolutions_final
      WHERE winning_index >= 0
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });

  const knownMarkets = await knownMarketResult.json() as any[];

  let gammaTest = null;
  if (knownMarkets.length > 0) {
    const testConditionId = knownMarkets[0].condition_id_norm;
    console.log(`   Testing with: ${testConditionId}`);

    try {
      const response = await fetch(`https://gamma-api.polymarket.com/markets?condition_id=${testConditionId}`);
      if (response.ok) {
        gammaTest = await response.json();
        console.log(`   Response: ${gammaTest.length || 0} markets found`);
        if (gammaTest.length > 0) {
          console.log(`   Resolution status: ${gammaTest[0].resolved ? 'RESOLVED' : 'UNRESOLVED'}`);
          console.log(`   Winning outcome: ${gammaTest[0].winning_outcome || 'N/A'}\n`);
        }
      } else {
        console.log(`   API Error: ${response.status} ${response.statusText}\n`);
      }
    } catch (error) {
      console.log(`   Fetch Error: ${error}\n`);
    }
  }

  return {
    token_ids: tokenCount,
    market_ids: marketCount,
    sample_same_market: sample.slice(0, 5),
    backfill_targets_old: oldCount,
    backfill_targets_new: newCount,
    gamma_test_result: gammaTest
  };
}

async function createFixedViews() {
  console.log('=== CREATING FIXED VIEWS ===\n');

  // Create token-to-market mapping view
  console.log('Creating vw_token_to_market...');
  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_token_to_market AS
      SELECT
        lower(condition_id_norm) AS token_cid,
        concat(left(replaceAll(condition_id_norm, '0x', ''), 62), '00') AS market_cid
      FROM default.vw_trades_canonical
      WHERE condition_id_norm != ''
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      GROUP BY token_cid, market_cid
    `
  });
  console.log('   ✓ Created\n');

  // Create fixed backfill targets view
  console.log('Creating vw_backfill_targets_fixed...');
  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_backfill_targets_fixed AS
      WITH market_ids AS (
        SELECT DISTINCT
          concat(left(replaceAll(condition_id_norm, '0x', ''), 62), '00') AS market_cid
        FROM default.vw_trades_canonical
        WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          AND condition_id_norm != ''
      )
      SELECT m.market_cid
      FROM market_ids m
      LEFT JOIN default.market_resolutions_final r
        ON lower(r.condition_id_norm) = lower(m.market_cid)
      WHERE r.condition_id_norm IS NULL
    `
  });
  console.log('   ✓ Created\n');

  // Verify views
  console.log('Verifying views...');
  const mappingCount = await clickhouse.query({
    query: 'SELECT count(*) as cnt FROM cascadian_clean.vw_token_to_market',
    format: 'JSONEachRow'
  });
  const mappingResult = await mappingCount.json() as any[];
  console.log(`   vw_token_to_market: ${parseInt(mappingResult[0].cnt).toLocaleString()} mappings`);

  const targetsCount = await clickhouse.query({
    query: 'SELECT count(*) as cnt FROM cascadian_clean.vw_backfill_targets_fixed',
    format: 'JSONEachRow'
  });
  const targetsResult = await targetsCount.json() as any[];
  console.log(`   vw_backfill_targets_fixed: ${parseInt(targetsResult[0].cnt).toLocaleString()} targets\n`);
}

async function main() {
  try {
    const analysis = await diagnoseTokenVsMarketID();
    await createFixedViews();

    console.log('=== DIAGNOSIS SUMMARY ===\n');
    console.log(`✓ Token IDs: ${analysis.token_ids.toLocaleString()}`);
    console.log(`✓ Market IDs: ${analysis.market_ids.toLocaleString()}`);
    console.log(`✓ OLD backfill targets: ${analysis.backfill_targets_old.toLocaleString()}`);
    console.log(`✓ NEW backfill targets: ${analysis.backfill_targets_new.toLocaleString()}`);
    console.log(`✓ Gamma API test: ${analysis.gamma_test_result ? 'SUCCESS' : 'NEEDS VERIFICATION'}`);
    console.log(`\n✓ Views created in cascadian_clean schema`);

  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}

main();
