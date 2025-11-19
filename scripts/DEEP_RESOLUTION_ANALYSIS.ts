#!/usr/bin/env tsx

/**
 * DEEP RESOLUTION DATA ANALYSIS
 *
 * Based on audit findings, drilling into specific high-value targets:
 * - market_resolutions_final: 218k with payout vectors (PRIMARY SOURCE)
 * - staging_resolutions_union: 544k records (POTENTIAL GOLDMINE)
 * - resolution_candidates: 424k records
 * - gamma_resolved: 123k records
 * - resolutions_src_api: 130k records
 */

import * as dotenv from 'dotenv'
import { getClickHouseClient } from './lib/clickhouse/client'

dotenv.config({ path: '.env.local' })

const client = getClickHouseClient()

async function run() {
  console.log('='.repeat(100))
  console.log('DEEP RESOLUTION DATA ANALYSIS - BREAKTHROUGH INSIGHTS')
  console.log('='.repeat(100))
  console.log()

  // ==================================================================================
  // PART 1: UNDERSTAND CURRENT STATE
  // ==================================================================================
  console.log('PART 1: CURRENT RESOLUTION DATA STATE')
  console.log('-'.repeat(100))

  // Total markets
  const totalMarketsResult = await client.query({
    query: `SELECT count(DISTINCT condition_id_32b) as total FROM cascadian_clean.token_condition_market_map`,
    format: 'JSONEachRow'
  })
  const totalMarkets = await totalMarketsResult.json<{total: string}>()
  console.log(`\n📊 Total markets in system: ${totalMarkets[0].total}`)

  // Markets with payouts in market_resolutions_final
  const withPayoutsResult = await client.query({
    query: `
      SELECT
        count(DISTINCT condition_id_norm) as markets_with_payouts,
        count() as total_records
      FROM market_resolutions_final
      WHERE payout_denominator > 0
        AND length(payout_numerators) > 0
    `,
    format: 'JSONEachRow'
  })
  const withPayouts = await withPayoutsResult.json<{markets_with_payouts: string, total_records: string}>()
  console.log(`\n🔥 market_resolutions_final:`)
  console.log(`   ${withPayouts[0].markets_with_payouts} unique markets with payouts`)
  console.log(`   ${withPayouts[0].total_records} total records`)

  const coveragePct = (parseInt(withPayouts[0].markets_with_payouts) / parseInt(totalMarkets[0].total)) * 100
  console.log(`\n   Coverage: ${coveragePct.toFixed(2)}%`)

  // ==================================================================================
  // PART 2: STAGING_RESOLUTIONS_UNION GOLDMINE
  // ==================================================================================
  console.log('\n\n' + '='.repeat(100))
  console.log('PART 2: STAGING_RESOLUTIONS_UNION (544K RECORDS - POTENTIAL GOLDMINE)')
  console.log('-'.repeat(100))

  const stagingStatsResult = await client.query({
    query: `
      SELECT
        count(DISTINCT cid) as unique_markets,
        count() as total_records,
        countDistinct(source) as num_sources,
        groupArray(DISTINCT source) as sources
      FROM staging_resolutions_union
    `,
    format: 'JSONEachRow'
  })
  const stagingStats = await stagingStatsResult.json<any>()
  console.log(`\n📊 Overview:`)
  console.log(`   ${stagingStats[0].unique_markets} unique markets`)
  console.log(`   ${stagingStats[0].total_records} total records`)
  console.log(`   ${stagingStats[0].num_sources} sources: ${stagingStats[0].sources.join(', ')}`)

  // Check overlap with market_resolutions_final
  const overlapResult = await client.query({
    query: `
      WITH staging_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as cid_norm
        FROM staging_resolutions_union
      ),
      final_markets AS (
        SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm
        FROM market_resolutions_final
        WHERE payout_denominator > 0
      )
      SELECT
        (SELECT count() FROM staging_markets) as in_staging,
        (SELECT count() FROM final_markets) as in_final,
        count() as overlap,
        (SELECT count() FROM staging_markets) - count() as staging_only,
        (SELECT count() FROM final_markets) - count() as final_only
      FROM staging_markets
      INNER JOIN final_markets USING (cid_norm)
    `,
    format: 'JSONEachRow'
  })
  const overlap = await overlapResult.json<any>()
  console.log(`\n📊 Overlap analysis:`)
  console.log(`   In staging_resolutions_union: ${overlap[0].in_staging}`)
  console.log(`   In market_resolutions_final: ${overlap[0].in_final}`)
  console.log(`   Overlap: ${overlap[0].overlap}`)
  console.log(`   🔥 IN STAGING ONLY: ${overlap[0].staging_only}`)
  console.log(`   In final only: ${overlap[0].final_only}`)

  if (parseInt(overlap[0].staging_only) > 0) {
    console.log(`\n   ⚡ BREAKTHROUGH: ${overlap[0].staging_only} markets in staging that aren't in final table!`)
  }

  // ==================================================================================
  // PART 3: RESOLUTION_CANDIDATES ANALYSIS
  // ==================================================================================
  console.log('\n\n' + '='.repeat(100))
  console.log('PART 3: RESOLUTION_CANDIDATES (424K RECORDS)')
  console.log('-'.repeat(100))

  const candidatesStatsResult = await client.query({
    query: `
      SELECT
        count(DISTINCT condition_id_norm) as unique_markets,
        count() as total_records,
        countDistinct(source) as num_sources,
        groupArray(DISTINCT source) as sources
      FROM resolution_candidates
    `,
    format: 'JSONEachRow'
  })
  const candidatesStats = await candidatesStatsResult.json<any>()
  console.log(`\n📊 Overview:`)
  console.log(`   ${candidatesStats[0].unique_markets} unique markets`)
  console.log(`   ${candidatesStats[0].total_records} total records`)
  console.log(`   ${candidatesStats[0].num_sources} sources: ${candidatesStats[0].sources.join(', ')}`)

  // Check what's NOT in market_resolutions_final
  const candidatesOnlyResult = await client.query({
    query: `
      WITH candidates_markets AS (
        SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm
        FROM resolution_candidates
      ),
      final_markets AS (
        SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm
        FROM market_resolutions_final
        WHERE payout_denominator > 0
      )
      SELECT count() as candidates_not_in_final
      FROM candidates_markets
      WHERE cid_norm NOT IN (SELECT cid_norm FROM final_markets)
    `,
    format: 'JSONEachRow'
  })
  const candidatesOnly = await candidatesOnlyResult.json<{candidates_not_in_final: string}>()
  console.log(`\n   🔥 Markets in candidates but NOT in final: ${candidatesOnly[0].candidates_not_in_final}`)

  // ==================================================================================
  // PART 4: GAMMA_RESOLVED ANALYSIS
  // ==================================================================================
  console.log('\n\n' + '='.repeat(100))
  console.log('PART 4: GAMMA_RESOLVED (123K RECORDS - GAMMA API DATA)')
  console.log('-'.repeat(100))

  const gammaStatsResult = await client.query({
    query: `
      SELECT
        count(DISTINCT cid) as unique_markets,
        count() as total_records,
        countIf(closed = 1) as closed_markets,
        countIf(length(winning_outcome) > 0) as with_winner
      FROM gamma_resolved
    `,
    format: 'JSONEachRow'
  })
  const gammaStats = await gammaStatsResult.json<any>()
  console.log(`\n📊 Overview:`)
  console.log(`   ${gammaStats[0].unique_markets} unique markets`)
  console.log(`   ${gammaStats[0].total_records} total records`)
  console.log(`   ${gammaStats[0].closed_markets} closed markets`)
  console.log(`   ${gammaStats[0].with_winner} with winner declared`)

  // Check what's NOT in market_resolutions_final
  const gammaOnlyResult = await client.query({
    query: `
      WITH gamma_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as cid_norm
        FROM gamma_resolved
        WHERE closed = 1 AND length(winning_outcome) > 0
      ),
      final_markets AS (
        SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm
        FROM market_resolutions_final
        WHERE payout_denominator > 0
      )
      SELECT count() as gamma_not_in_final
      FROM gamma_markets
      WHERE cid_norm NOT IN (SELECT cid_norm FROM final_markets)
    `,
    format: 'JSONEachRow'
  })
  const gammaOnly = await gammaOnlyResult.json<{gamma_not_in_final: string}>()
  console.log(`\n   🔥 Markets in gamma_resolved but NOT in final: ${gammaOnly[0].gamma_not_in_final}`)

  // ==================================================================================
  // PART 5: RESOLUTIONS_SRC_API ANALYSIS
  // ==================================================================================
  console.log('\n\n' + '='.repeat(100))
  console.log('PART 5: RESOLUTIONS_SRC_API (130K RECORDS - CASCADIAN_CLEAN DB)')
  console.log('-'.repeat(100))

  const apiStatsResult = await client.query({
    query: `
      SELECT
        count(DISTINCT cid_hex) as unique_markets,
        count() as total_records,
        countIf(resolved = 1) as resolved_count,
        countIf(payout_numerators IS NOT NULL AND length(payout_numerators) > 0) as with_payout_vectors
      FROM cascadian_clean.resolutions_src_api
    `,
    format: 'JSONEachRow'
  })
  const apiStats = await apiStatsResult.json<any>()
  console.log(`\n📊 Overview:`)
  console.log(`   ${apiStats[0].unique_markets} unique markets`)
  console.log(`   ${apiStats[0].total_records} total records`)
  console.log(`   ${apiStats[0].resolved_count} marked as resolved`)
  console.log(`   ${apiStats[0].with_payout_vectors} with payout vectors`)

  // Check what's NOT in market_resolutions_final
  const apiOnlyResult = await client.query({
    query: `
      WITH api_markets AS (
        SELECT DISTINCT lower(replaceAll(cid_hex, '0x', '')) as cid_norm
        FROM cascadian_clean.resolutions_src_api
        WHERE resolved = 1
          AND payout_numerators IS NOT NULL
          AND length(payout_numerators) > 0
      ),
      final_markets AS (
        SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm
        FROM default.market_resolutions_final
        WHERE payout_denominator > 0
      )
      SELECT count() as api_not_in_final
      FROM api_markets
      WHERE cid_norm NOT IN (SELECT cid_norm FROM final_markets)
    `,
    format: 'JSONEachRow'
  })
  const apiOnly = await apiOnlyResult.json<{api_not_in_final: string}>()
  console.log(`\n   🔥 Markets in resolutions_src_api but NOT in final: ${apiOnly[0].api_not_in_final}`)

  // ==================================================================================
  // PART 6: COMBINED COVERAGE POTENTIAL
  // ==================================================================================
  console.log('\n\n' + '='.repeat(100))
  console.log('PART 6: COMBINED COVERAGE POTENTIAL (UNION ALL SOURCES)')
  console.log('-'.repeat(100))

  const combinedResult = await client.query({
    query: `
      WITH all_resolved AS (
        -- From market_resolutions_final
        SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm, 'market_resolutions_final' as source
        FROM market_resolutions_final
        WHERE payout_denominator > 0

        UNION DISTINCT

        -- From staging_resolutions_union (with winner)
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as cid_norm, 'staging_resolutions_union' as source
        FROM staging_resolutions_union
        WHERE winning_outcome IS NOT NULL AND winning_outcome != ''

        UNION DISTINCT

        -- From gamma_resolved
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as cid_norm, 'gamma_resolved' as source
        FROM gamma_resolved
        WHERE closed = 1 AND length(winning_outcome) > 0

        UNION DISTINCT

        -- From resolutions_src_api
        SELECT DISTINCT lower(replaceAll(cid_hex, '0x', '')) as cid_norm, 'resolutions_src_api' as source
        FROM cascadian_clean.resolutions_src_api
        WHERE resolved = 1 AND payout_numerators IS NOT NULL AND length(payout_numerators) > 0
      )
      SELECT
        count(DISTINCT cid_norm) as total_unique_markets,
        count() as total_records,
        groupArray(source) as all_sources
      FROM all_resolved
    `,
    format: 'JSONEachRow'
  })
  const combined = await combinedResult.json<any>()

  console.log(`\n📊 Combined from ALL sources:`)
  console.log(`   ${combined[0].total_unique_markets} unique markets with resolution data`)

  const potentialCoverage = (parseInt(combined[0].total_unique_markets) / parseInt(totalMarkets[0].total)) * 100
  console.log(`\n   🚀 POTENTIAL COVERAGE: ${potentialCoverage.toFixed(2)}%`)

  const improvement = potentialCoverage - coveragePct
  console.log(`   📈 Improvement over current: +${improvement.toFixed(2)}% (${(improvement/coveragePct * 100).toFixed(1)}x better)`)

  // ==================================================================================
  // PART 7: SAMPLE HIGH-COVERAGE WALLETS
  // ==================================================================================
  console.log('\n\n' + '='.repeat(100))
  console.log('PART 7: WALLET COVERAGE ANALYSIS (LEADERBOARD READY?)')
  console.log('-'.repeat(100))

  const walletCoverageResult = await client.query({
    query: `
      WITH wallet_positions AS (
        SELECT
          lower(wallet_address_norm) as wallet,
          lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm,
          count() as trade_count
        FROM default.vw_trades_canonical
        WHERE wallet_address_norm IS NOT NULL
          AND condition_id_norm IS NOT NULL
          AND condition_id_norm != ''
        GROUP BY wallet, cid_norm
      ),
      wallet_stats AS (
        SELECT
          wp.wallet,
          count(DISTINCT wp.cid_norm) as total_markets,
          countIf(mrf.condition_id_norm IS NOT NULL) as resolved_markets,
          round(countIf(mrf.condition_id_norm IS NOT NULL) * 100.0 / count(DISTINCT wp.cid_norm), 2) as coverage_pct
        FROM wallet_positions wp
        LEFT JOIN market_resolutions_final mrf
          ON lower(replaceAll(mrf.condition_id_norm, '0x', '')) = wp.cid_norm
          AND mrf.payout_denominator > 0
        GROUP BY wp.wallet
        HAVING total_markets >= 10  -- At least 10 markets
      )
      SELECT
        wallet,
        total_markets,
        resolved_markets,
        coverage_pct
      FROM wallet_stats
      WHERE coverage_pct >= 80
      ORDER BY resolved_markets DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  })
  const walletCoverage = await walletCoverageResult.json<any>()

  if (walletCoverage.length > 0) {
    console.log(`\n🎯 Found ${walletCoverage.length} wallets with 80%+ coverage (min 10 markets):`)
    console.log('\n   Wallet                                        Total Markets    Resolved    Coverage')
    console.log('   ' + '-'.repeat(85))
    for (const wallet of walletCoverage.slice(0, 10)) {
      console.log(`   ${wallet.wallet.padEnd(42)} ${wallet.total_markets.toString().padStart(13)} ${wallet.resolved_markets.toString().padStart(11)} ${wallet.coverage_pct.toString().padStart(9)}%`)
    }
  } else {
    console.log(`\n⚠️  No wallets found with 80%+ coverage`)
  }

  // ==================================================================================
  // PART 8: ACTIONABLE RECOMMENDATIONS
  // ==================================================================================
  console.log('\n\n' + '='.repeat(100))
  console.log('🎯 ACTIONABLE RECOMMENDATIONS')
  console.log('='.repeat(100))

  console.log(`\n1. IMMEDIATE WINS:`)
  if (parseInt(overlap[0].staging_only) > 0) {
    console.log(`   ✅ Import ${overlap[0].staging_only} markets from staging_resolutions_union`)
  }
  if (parseInt(gammaOnly[0].gamma_not_in_final) > 0) {
    console.log(`   ✅ Import ${gammaOnly[0].gamma_not_in_final} markets from gamma_resolved`)
  }
  if (parseInt(apiOnly[0].api_not_in_final) > 0) {
    console.log(`   ✅ Import ${apiOnly[0].api_not_in_final} markets from resolutions_src_api`)
  }

  console.log(`\n2. COVERAGE BOOST:`)
  console.log(`   Current: ${coveragePct.toFixed(2)}%`)
  console.log(`   Potential: ${potentialCoverage.toFixed(2)}%`)
  console.log(`   Gain: +${improvement.toFixed(2)}%`)

  console.log(`\n3. WALLET LEADERBOARDS:`)
  if (walletCoverage.length > 0) {
    console.log(`   ✅ ${walletCoverage.length} wallets ready for leaderboards (80%+ coverage)`)
  } else {
    console.log(`   ⚠️  Need to boost coverage before launching leaderboards`)
  }

  await client.close()
}

run().catch(console.error)
