/**
 * Investigate why some tokens are not in the token map
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  const wallet = '0x50b977391c4b3dd88b0a0bef03c3434fe4284298';

  console.log('=== Investigating Token Mapping Gap ===\n');

  // 1. Get count of missing tokens for this wallet
  // Note: pm_trader_events_v2 uses token_id, pm_token_to_condition_map_v5 uses token_id_dec
  const missingCountQ = await clickhouse.query({
    query: `
      WITH wallet_tokens AS (
        SELECT DISTINCT token_id
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${wallet}'
          AND is_deleted = 0
      ),
      mapped_tokens AS (
        SELECT DISTINCT token_id_dec
        FROM pm_token_to_condition_map_v5
        WHERE token_id_dec != ''
      )
      SELECT
        count(*) as total_tokens,
        countIf(mt.token_id_dec IS NOT NULL) as mapped,
        countIf(mt.token_id_dec IS NULL) as missing
      FROM wallet_tokens wt
      LEFT JOIN mapped_tokens mt ON wt.token_id = mt.token_id_dec
    `,
    format: 'JSONEachRow',
  });
  const missingCount = (await missingCountQ.json()) as any[];
  console.log('Wallet Token Coverage:');
  console.table(missingCount);

  // 2. Get sample of missing tokens with their trade times
  const missingTokensQ = await clickhouse.query({
    query: `
      WITH wallet_tokens AS (
        SELECT token_id
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${wallet}'
          AND is_deleted = 0
        GROUP BY token_id
      )
      SELECT
        wt.token_id,
        min(te.trade_time) as first_trade,
        max(te.trade_time) as last_trade,
        count(*) as trade_count
      FROM wallet_tokens wt
      LEFT JOIN pm_token_to_condition_map_v5 m ON wt.token_id = m.token_id_dec
      LEFT JOIN pm_trader_events_v2 te ON te.token_id = wt.token_id AND te.is_deleted = 0
      WHERE m.token_id_dec IS NULL OR m.token_id_dec = ''
      GROUP BY wt.token_id
      ORDER BY last_trade DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const missingTokens = (await missingTokensQ.json()) as any[];
  console.log('\nSample Missing Tokens (with trade times):');
  console.table(missingTokens);

  // 3. Check if these tokens exist in pm_trader_events_v2 globally
  if (missingTokens.length > 0) {
    const sampleToken = missingTokens[0].token_id;
    console.log(`\nInvestigating token: ${sampleToken}`);

    // How many wallets traded this token?
    const globalTradesQ = await clickhouse.query({
      query: `
        SELECT
          count(DISTINCT trader_wallet) as wallets_traded,
          count(*) as total_trades,
          min(trade_time) as first_trade,
          max(trade_time) as last_trade
        FROM pm_trader_events_v2
        WHERE token_id = '${sampleToken}'
          AND is_deleted = 0
      `,
      format: 'JSONEachRow',
    });
    const globalTrades = (await globalTradesQ.json()) as any[];
    console.log('Global trades for this token:');
    console.table(globalTrades);

    // Is this token in any of the other metadata tables?
    const metadataCheckQ = await clickhouse.query({
      query: `
        SELECT
          (SELECT count() FROM pm_market_metadata WHERE has(token_ids, '${sampleToken}')) as in_metadata,
          (SELECT count() FROM pm_resolutions_v3 WHERE has(token_ids, '${sampleToken}')) as in_resolutions
      `,
      format: 'JSONEachRow',
    });
    const metadataCheck = (await metadataCheckQ.json()) as any[];
    console.log('Token in other tables:');
    console.table(metadataCheck);
  }

  // 4. Check the Gamma API coverage - when was the last sync?
  const syncStatusQ = await clickhouse.query({
    query: `
      SELECT
        last_success_at,
        records_synced,
        coverage_pct,
        duration_ms / 1000 as duration_sec
      FROM pm_sync_status FINAL
      WHERE sync_type = 'metadata_sync'
      ORDER BY last_success_at DESC
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const syncStatus = (await syncStatusQ.json()) as any[];
  console.log('\nRecent Metadata Sync Status:');
  console.table(syncStatus);

  // 5. Check total markets in metadata vs expected
  const metadataStatsQ = await clickhouse.query({
    query: `
      SELECT
        count() as total_markets,
        countIf(length(token_ids) > 0) as markets_with_tokens,
        sum(length(token_ids)) as total_token_entries
      FROM pm_market_metadata FINAL
    `,
    format: 'JSONEachRow',
  });
  const metadataStats = (await metadataStatsQ.json()) as any[];
  console.log('\nMetadata Table Stats:');
  console.table(metadataStats);

  // 6. Key insight: Are missing tokens from older trades?
  const ageAnalysisQ = await clickhouse.query({
    query: `
      WITH wallet_tokens AS (
        SELECT token_id
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${wallet}' AND is_deleted = 0
        GROUP BY token_id
      ),
      token_ages AS (
        SELECT
          wt.token_id,
          max(te.trade_time) as last_trade,
          m.token_id_dec IS NOT NULL AND m.token_id_dec != '' as is_mapped
        FROM wallet_tokens wt
        LEFT JOIN pm_token_to_condition_map_v5 m ON wt.token_id = m.token_id_dec
        LEFT JOIN pm_trader_events_v2 te ON te.token_id = wt.token_id AND te.is_deleted = 0
        GROUP BY wt.token_id, m.token_id_dec IS NOT NULL AND m.token_id_dec != ''
      )
      SELECT
        is_mapped,
        count(*) as token_count,
        min(last_trade) as oldest_trade,
        max(last_trade) as newest_trade,
        avg(dateDiff('day', last_trade, now())) as avg_days_since_trade
      FROM token_ages
      GROUP BY is_mapped
      ORDER BY is_mapped DESC
    `,
    format: 'JSONEachRow',
  });
  const ageAnalysis = (await ageAnalysisQ.json()) as any[];
  console.log('\nAge Analysis (mapped vs unmapped tokens):');
  console.table(ageAnalysis);

  // 7. CRITICAL: Check if the issue is the Gamma API not returning old markets
  console.log('\n=== ROOT CAUSE ANALYSIS ===');
  console.log(`
The Gamma API (https://gamma-api.polymarket.com/markets) only returns:
- Active markets (not closed/delisted)
- Markets with current activity

This means:
1. Markets that have been closed and delisted are NOT in the API
2. Historical markets this wallet traded on are missing from our metadata
3. The cron is working correctly - it's just limited by what the API provides

SOLUTION OPTIONS:
A. Accept the gap (affects only old trades on delisted markets)
B. Query Polymarket archive/historical data if available
C. Use on-chain data to get condition_id from token trades directly
D. For unrealized PnL, this is fine - old delisted markets are resolved anyway
  `);
}

main().catch(console.error);
