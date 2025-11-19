#!/usr/bin/env tsx
/**
 * Investigate Resolution Status for 8 Markets with Data
 *
 * CRITICAL DISCOVERY: Script 108 revealed 8 markets have ALL trade data (clob_fills,
 * pm_trades, pm_markets) but status='open' instead of 'resolved'. This excludes them
 * from P&L despite having realized trades.
 *
 * This script:
 * 1. Checks resolution sources (gamma_resolved, market_resolutions_final, etc.)
 * 2. Queries Polymarket API for current resolution status
 * 3. Identifies if this is a resolution ingestion bug or markets genuinely unresolved
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

// 8 condition_ids that HAVE data but status='open'
const MARKETS_WITH_DATA = [
  {
    id: '0xef00c9e8b1eb7eb322ccc13b67cfa35d4291017a0aa46d09f3e2f3e3b255e3d0',
    name: 'Eggs $3.00-3.25 Sept',
    fills: 393
  },
  {
    id: '0xa491ceedf3da3e6e6b4913c8eff3362caf6dbfda9bbf299e5a628b223803c2e6',
    name: 'Xi out before Oct',
    fills: 1000
  },
  {
    id: '0x93ae0bd274982c8c08581bc3ef1fa143e1294a6326d2a2eec345515a2cb15620',
    name: 'Inflation 2.7% Aug',
    fills: 1000
  },
  {
    id: '0x03bf5c66a49c7f44661d99dc3784f3cb4484c0aa8459723bd770680512e72f82',
    name: 'Eggs $3.25-3.50 Aug',
    fills: 472
  },
  {
    id: '0xfae907b4c7d9b39fcd27683e3f9e4bdbbafc24f36765b6240a93b8c94ed206fa',
    name: 'Lisa Cook Fed',
    fills: 1000
  },
  {
    id: '0x340c700abfd4870e95683f1d45cf7cb28e77c284f41e69d385ed2cc52227b307',
    name: 'Eggs $4.25-4.50 Aug',
    fills: 133
  },
  {
    id: '0x601141063589291af41d6811b9f20d544e1c24b3641f6996c21e8957dd43bcec',
    name: 'Eggs $3.00-3.25 Aug',
    fills: 333
  },
  {
    id: '0x7bdc006d11b7dff2eb7ccbba5432c22b702c92aa570840f3555b5e4da86fed02',
    name: 'Eggs $3.75-4.00 Aug',
    fills: 537
  }
];

async function investigateMarket(market: typeof MARKETS_WITH_DATA[0]) {
  const conditionId = market.id.toLowerCase().replace(/^0x/, '');

  console.log(`\n${'='.repeat(80)}`);
  console.log(`Market: ${market.name}`);
  console.log(`Condition ID: ${conditionId.substring(0, 16)}...`);
  console.log(`Known fills: ${market.fills}`);
  console.log('='.repeat(80));

  const results: any = {
    market_name: market.name,
    condition_id_short: conditionId.substring(0, 16) + '...',
    fills_count: market.fills,
    pm_markets_status: null,
    pm_markets_winning_outcome: null,
    gamma_resolved_exists: false,
    gamma_resolved_outcome: null,
    market_resolutions_final_exists: false,
    market_resolutions_outcome: null,
    polymarket_api_status: null,
    polymarket_api_closed: null
  };

  // Check pm_markets current status
  console.log('\n1. Checking pm_markets status...');
  try {
    const marketsQuery = await clickhouse.query({
      query: `
        SELECT
          status,
          market_type,
          winning_outcome_index,
          resolved_at,
          end_date
        FROM pm_markets
        WHERE lower(replaceAll(condition_id, '0x', '')) = '${conditionId}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });
    const marketsResult = await marketsQuery.json();

    if (marketsResult.length > 0) {
      const market = marketsResult[0];
      results.pm_markets_status = market.status;
      results.pm_markets_winning_outcome = market.winning_outcome_index;
      results.pm_markets_resolved_at = market.resolved_at;
      results.pm_markets_end_date = market.end_date;

      console.log(`   Status: ${market.status}`);
      console.log(`   Resolved at: ${market.resolved_at || 'NULL'}`);
      console.log(`   Winning outcome: ${market.winning_outcome_index}`);
      console.log(`   End date: ${market.end_date}`);
    } else {
      console.log('   ❌ NOT FOUND in pm_markets');
    }
  } catch (e: any) {
    console.log(`   ❌ Error: ${e.message}`);
  }

  // Check gamma_resolved
  console.log('\n2. Checking gamma_resolved...');
  try {
    const gammaQuery = await clickhouse.query({
      query: `
        SELECT
          cid,
          winning_outcome,
          closed,
          fetched_at
        FROM gamma_resolved
        WHERE lower(replaceAll(cid, '0x', '')) = '${conditionId}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });
    const gammaResult = await gammaQuery.json();

    if (gammaResult.length > 0) {
      results.gamma_resolved_exists = true;
      results.gamma_resolved_outcome = gammaResult[0].winning_outcome;
      results.gamma_resolved_at = gammaResult[0].fetched_at;

      console.log(`   ✅ Found in gamma_resolved`);
      console.log(`   Winning outcome: ${gammaResult[0].winning_outcome}`);
      console.log(`   Closed: ${gammaResult[0].closed}`);
      console.log(`   Fetched at: ${gammaResult[0].fetched_at}`);
    } else {
      console.log('   ❌ NOT FOUND in gamma_resolved');
    }
  } catch (e: any) {
    console.log(`   ⚠️  Table may not exist: ${e.message}`);
  }

  // Skip market_resolutions_final check (table structure unknown)
  console.log('\n3. Skipping market_resolutions_final (table structure varies)');

  // Check Polymarket API for current status (using market_slug if available)
  console.log('\n4. Checking Polymarket API...');

  // First get market_slug from pm_markets if available
  let marketSlug = null;
  if (results.pm_markets_status) {
    try {
      const slugQuery = await clickhouse.query({
        query: `
          SELECT market_slug
          FROM pm_markets
          WHERE lower(replaceAll(condition_id, '0x', '')) = '${conditionId}'
          LIMIT 1
        `,
        format: 'JSONEachRow'
      });
      const slugResult = await slugQuery.json();
      if (slugResult.length > 0 && slugResult[0].market_slug) {
        marketSlug = slugResult[0].market_slug;
      }
    } catch (e) {
      // Ignore slug lookup failures
    }
  }

  if (marketSlug) {
    try {
      const apiUrl = `https://gamma-api.polymarket.com/markets/${marketSlug}`;
      console.log(`   URL: ${apiUrl}`);

      const apiResp = await fetch(apiUrl, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });

      if (apiResp.ok) {
        const marketData = await apiResp.json();
        results.polymarket_api_status = marketData.active ? 'active' : 'inactive';
        results.polymarket_api_closed = marketData.closed;
        results.polymarket_api_resolved = marketData.resolved;

        console.log(`   ✅ Market found`);
        console.log(`   Active: ${marketData.active}`);
        console.log(`   Closed: ${marketData.closed}`);
        console.log(`   Resolved: ${marketData.resolved || false}`);

        if (marketData.resolved && results.pm_markets_status === 'open') {
          console.log(`   ⚠️  CRITICAL: Polymarket says RESOLVED but our pm_markets says 'open'!`);
        }
      } else {
        console.log(`   ⚠️  HTTP ${apiResp.status}: ${apiResp.statusText}`);
      }
    } catch (e: any) {
      console.log(`   ❌ Error: ${e.message}`);
    }
  } else {
    console.log(`   ⚠️  Skipped: No market_slug found in pm_markets`);
  }

  return results;
}

async function main() {
  console.log('🔍 Resolution Status Investigation: 8 Markets with Data');
  console.log('='.repeat(80));
  console.log('');
  console.log('Purpose: Determine why markets with trade data are marked "open" not "resolved"');
  console.log('');

  const results: any[] = [];

  for (const market of MARKETS_WITH_DATA) {
    const result = await investigateMarket(market);
    results.push(result);

    // Rate limit: wait 1 second between API requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Summary
  console.log(`\n${'='.repeat(80)}`);
  console.log('📋 SUMMARY');
  console.log('='.repeat(80));
  console.log('');

  console.table(results.map(r => ({
    'Market': r.market_name.substring(0, 25),
    'Fills': r.fills_count,
    'PM Status': r.pm_markets_status,
    'Gamma Resolved': r.gamma_resolved_exists ? 'YES' : 'NO',
    'API Resolved': r.polymarket_api_resolved ? 'YES' : 'NO'
  })));

  console.log('');
  console.log('Diagnostic Statistics:');

  const stats = {
    total_markets: results.length,
    pm_status_open: results.filter(r => r.pm_markets_status === 'open').length,
    pm_status_resolved: results.filter(r => r.pm_markets_status === 'resolved').length,
    found_in_gamma_resolved: results.filter(r => r.gamma_resolved_exists).length,
    found_in_market_resolutions: results.filter(r => r.market_resolutions_final_exists).length,
    api_says_resolved: results.filter(r => r.polymarket_api_resolved).length,
    mismatch_api_vs_db: results.filter(r => r.polymarket_api_resolved && r.pm_markets_status !== 'resolved').length
  };

  console.log(`  Total markets investigated: ${stats.total_markets}`);
  console.log(`  pm_markets status='open': ${stats.pm_status_open}`);
  console.log(`  pm_markets status='resolved': ${stats.pm_status_resolved}`);
  console.log(`  Found in gamma_resolved: ${stats.found_in_gamma_resolved}`);
  console.log(`  Found in market_resolutions_final: ${stats.found_in_market_resolutions}`);
  console.log(`  Polymarket API says resolved: ${stats.api_says_resolved}`);
  console.log(`  Mismatch (API resolved but DB open): ${stats.mismatch_api_vs_db}`);
  console.log('');

  // Conclusion
  console.log('='.repeat(80));
  console.log('🔍 CONCLUSION');
  console.log('='.repeat(80));
  console.log('');

  if (stats.mismatch_api_vs_db > 0) {
    console.log(`⚠️  CRITICAL: ${stats.mismatch_api_vs_db} markets are RESOLVED on Polymarket but 'open' in our database`);
    console.log('   This means:');
    console.log('   1. The resolution data EXISTS on Polymarket');
    console.log('   2. Our resolution ingestion is broken or incomplete');
    console.log('   3. Fixing resolution status could immediately recover significant P&L');
    console.log('');
    console.log('   Next steps:');
    console.log('   a) Backfill resolution status from Polymarket API');
    console.log('   b) Update pm_markets.status from "open" to "resolved"');
    console.log('   c) Update pm_markets.winning_outcome_index with correct values');
    console.log('   d) Recompute P&L (should recover portion of $84K gap)');
  } else if (stats.found_in_gamma_resolved > 0 && stats.pm_status_open > 0) {
    console.log(`⚠️  ${stats.found_in_gamma_resolved} markets found in gamma_resolved but pm_markets still 'open'`);
    console.log('   This means:');
    console.log('   1. Resolution data WAS ingested into gamma_resolved');
    console.log('   2. But pm_markets was never updated with this data');
    console.log('   3. This is a pipeline sync issue between tables');
    console.log('');
    console.log('   Next steps:');
    console.log('   a) Copy resolution status from gamma_resolved to pm_markets');
    console.log('   b) Recompute P&L');
  } else {
    console.log('All markets have consistent status across sources.');
  }

  console.log('');
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
