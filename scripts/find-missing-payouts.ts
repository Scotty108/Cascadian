#!/usr/bin/env npx tsx
/**
 * Find Missing Payout Vectors - Comprehensive Source Check
 *
 * Problem: 148K traded markets have payout_denominator = 0
 * Solution: Check every known source systematically
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function main() {
  console.log('\n' + '═'.repeat(80));
  console.log('🔍 INVESTIGATING 148K MISSING PAYOUT VECTORS');
  console.log('═'.repeat(80) + '\n');

  // Step 1: Get sample of unresolved markets
  console.log('Step 1: Sampling unresolved markets...\n');

  const unresolved = await ch.query({
    query: `
      SELECT DISTINCT
        t.cid_hex as condition_id,
        COUNT(DISTINCT t.wallet_address) as wallet_count,
        COUNT(*) as trade_count,
        MIN(t.block_time) as first_trade,
        MAX(t.block_time) as last_trade,
        dateDiff('day', first_trade, now()) as days_since_first_trade
      FROM cascadian_clean.fact_trades_clean t
      LEFT JOIN default.market_resolutions_final r
        ON lower(replaceAll(t.cid_hex, '0x', '')) = lower(r.condition_id_norm)
      WHERE r.payout_denominator = 0 OR r.condition_id_norm IS NULL
      GROUP BY t.cid_hex
      ORDER BY wallet_count DESC
      LIMIT 100
    `,
    format: 'JSONEachRow'
  });

  const unresolvedMarkets = await unresolved.json<Array<{
    condition_id: string;
    wallet_count: string;
    trade_count: string;
    first_trade: string;
    last_trade: string;
    days_since_first_trade: string;
  }>>();

  console.log(`Found ${unresolvedMarkets.length} unresolved markets in sample`);
  console.log(`Top 5 by wallet count:`);
  unresolvedMarkets.slice(0, 5).forEach((m, i) => {
    console.log(`  ${i+1}. ${m.condition_id.substring(0, 16)}... | ${m.wallet_count} wallets | ${m.trade_count} trades | ${m.days_since_first_trade} days old`);
  });

  // Step 2: Check Polymarket PNL Subgraph (Goldsky)
  console.log('\n' + '─'.repeat(80));
  console.log('Step 2: Checking PNL Subgraph (Goldsky)...\n');

  const testConditions = unresolvedMarkets.slice(0, 10).map(m =>
    m.condition_id.toLowerCase().replace(/^0x/, '')
  );

  let subgraphHits = 0;
  const subgraphResults: any[] = [];

  for (const conditionId of testConditions) {
    try {
      const query = `
        query {
          condition(id: "${conditionId}") {
            id
            payoutNumerators
            payoutDenominator
            positionIds
          }
        }
      `;

      const response = await fetch(
        'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query })
        }
      );

      const data = await response.json();

      if (data.data?.condition && data.data.condition.payoutDenominator > 0) {
        subgraphHits++;
        subgraphResults.push({
          condition_id: conditionId,
          payout_numerators: data.data.condition.payoutNumerators,
          payout_denominator: data.data.condition.payoutDenominator
        });
      }
    } catch (error) {
      // Skip errors
    }
  }

  console.log(`✅ PNL Subgraph Results: ${subgraphHits}/${testConditions.length} have payouts`);
  if (subgraphHits > 0) {
    console.log(`   Sample: ${JSON.stringify(subgraphResults[0], null, 2)}`);
    console.log(`\n   📊 Extrapolation: ${Math.round(subgraphHits/testConditions.length * 100)}% of 148K = ~${Math.round(subgraphHits/testConditions.length * 148000).toLocaleString()} markets`);
  }

  // Step 3: Check gamma_resolved table
  console.log('\n' + '─'.repeat(80));
  console.log('Step 3: Checking gamma_resolved table...\n');

  const gammaCheck = await ch.query({
    query: `
      SELECT
        COUNT(DISTINCT g.condition_id_norm) as gamma_has_outcome,
        COUNT(DISTINCT CASE WHEN g.outcome IS NOT NULL THEN g.condition_id_norm END) as gamma_has_winner
      FROM (
        SELECT DISTINCT
          lower(replaceAll(t.cid_hex, '0x', '')) as condition_id
        FROM cascadian_clean.fact_trades_clean t
        LEFT JOIN default.market_resolutions_final r
          ON lower(replaceAll(t.cid_hex, '0x', '')) = lower(r.condition_id_norm)
        WHERE r.payout_denominator = 0 OR r.condition_id_norm IS NULL
        LIMIT 10000
      ) unresolved
      LEFT JOIN default.gamma_resolved g
        ON unresolved.condition_id = g.condition_id_norm
    `,
    format: 'JSONEachRow'
  });

  const gammaResults = await gammaCheck.json<Array<{
    gamma_has_outcome: string;
    gamma_has_winner: string;
  }>>();

  console.log(`✅ gamma_resolved Results: ${gammaResults[0].gamma_has_winner} markets have outcomes`);

  // Step 4: Check resolution_candidates table
  console.log('\n' + '─'.repeat(80));
  console.log('Step 4: Checking resolution_candidates table...\n');

  const candidatesCheck = await ch.query({
    query: `
      SELECT
        COUNT(DISTINCT rc.condition_id) as candidates_have_data
      FROM (
        SELECT DISTINCT
          lower(replaceAll(t.cid_hex, '0x', '')) as condition_id
        FROM cascadian_clean.fact_trades_clean t
        LEFT JOIN default.market_resolutions_final r
          ON lower(replaceAll(t.cid_hex, '0x', '')) = lower(r.condition_id_norm)
        WHERE r.payout_denominator = 0 OR r.condition_id_norm IS NULL
        LIMIT 10000
      ) unresolved
      INNER JOIN default.resolution_candidates rc
        ON unresolved.condition_id = rc.condition_id
      WHERE rc.payout_denominator > 0
    `,
    format: 'JSONEachRow'
  });

  const candidatesResults = await candidatesCheck.json<Array<{
    candidates_have_data: string;
  }>>();

  console.log(`✅ resolution_candidates Results: ${candidatesResults[0].candidates_have_data} markets have payouts`);

  // Step 5: Check api_ctf_bridge table
  console.log('\n' + '─'.repeat(80));
  console.log('Step 5: Checking api_ctf_bridge table...\n');

  const bridgeCheck = await ch.query({
    query: `
      SELECT
        COUNT(DISTINCT b.condition_id) as bridge_has_outcome
      FROM (
        SELECT DISTINCT
          lower(replaceAll(t.cid_hex, '0x', '')) as condition_id
        FROM cascadian_clean.fact_trades_clean t
        LEFT JOIN default.market_resolutions_final r
          ON lower(replaceAll(t.cid_hex, '0x', '')) = lower(r.condition_id_norm)
        WHERE r.payout_denominator = 0 OR r.condition_id_norm IS NULL
        LIMIT 10000
      ) unresolved
      INNER JOIN default.api_ctf_bridge b
        ON unresolved.condition_id = b.condition_id
      WHERE b.resolved_outcome IS NOT NULL
    `,
    format: 'JSONEachRow'
  });

  const bridgeResults = await bridgeCheck.json<Array<{
    bridge_has_outcome: string;
  }>>();

  console.log(`✅ api_ctf_bridge Results: ${bridgeResults[0].bridge_has_outcome} markets have outcomes`);

  // Step 6: Summary and Recommendations
  console.log('\n' + '═'.repeat(80));
  console.log('📊 SUMMARY & RECOMMENDATIONS');
  console.log('═'.repeat(80) + '\n');

  const sources = [
    { name: 'PNL Subgraph (Goldsky)', coverage: `${subgraphHits}/${testConditions.length} (${Math.round(subgraphHits/testConditions.length * 100)}%)`, estimated: Math.round(subgraphHits/testConditions.length * 148000), recommendation: '🥇 PRIMARY SOURCE' },
    { name: 'gamma_resolved', coverage: `${gammaResults[0].gamma_has_winner}/10000`, estimated: parseInt(gammaResults[0].gamma_has_winner) * 14.8, recommendation: '🥈 SECONDARY' },
    { name: 'resolution_candidates', coverage: `${candidatesResults[0].candidates_have_data}/10000`, estimated: parseInt(candidatesResults[0].candidates_have_data) * 14.8, recommendation: '🥉 TERTIARY' },
    { name: 'api_ctf_bridge', coverage: `${bridgeResults[0].bridge_has_outcome}/10000`, estimated: parseInt(bridgeResults[0].bridge_has_outcome) * 14.8, recommendation: '⚠️  BACKUP' },
  ];

  console.log('Data Source Coverage:\n');
  sources.forEach(s => {
    console.log(`${s.recommendation.padEnd(20)} | ${s.name.padEnd(30)} | Coverage: ${s.coverage.padEnd(15)} | Est. Total: ~${s.estimated.toLocaleString().padStart(10)}`);
  });

  console.log('\n' + '─'.repeat(80));
  console.log('🎯 RECOMMENDED ACTION PLAN:\n');

  const bestSource = sources[0];
  console.log(`1. PRIMARY: Backfill from ${bestSource.name}`);
  console.log(`   - Expected coverage: ~${bestSource.estimated.toLocaleString()} of 148K markets`);
  console.log(`   - Script: backfill-payouts-from-pnl-subgraph.ts`);
  console.log(`   - Runtime: ~2-4 hours for 148K condition IDs`);
  console.log(`   - API: https://api.goldsky.com/api/public/.../pnl-subgraph/0.0.14/gn\n`);

  console.log(`2. SECONDARY: Merge existing gamma_resolved data`);
  console.log(`   - Already in ClickHouse`);
  console.log(`   - SQL: UPDATE market_resolutions_final FROM gamma_resolved WHERE outcome IS NOT NULL\n`);

  console.log(`3. TERTIARY: Merge resolution_candidates data`);
  console.log(`   - Already in ClickHouse`);
  console.log(`   - SQL: UPDATE market_resolutions_final FROM resolution_candidates WHERE payout_denominator > 0\n`);

  console.log(`4. VALIDATE: After backfill, check coverage`);
  console.log(`   - Target: 95%+ of traded markets should have payouts`);
  console.log(`   - Remaining gaps likely truly unresolved active markets\n`);

  console.log('═'.repeat(80) + '\n');

  await ch.close();
}

main()
  .then(() => {
    console.log('✅ Investigation complete!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
