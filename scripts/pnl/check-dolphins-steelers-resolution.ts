/**
 * Check if Dolphins vs Steelers resolution exists in our database
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';

async function main() {
  const client = getClickHouseClient();
  const wallet = '0x16ea6d68c8305c1c8f95d247d0845d19c9cf6df7';
  
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║   CHECKING DOLPHINS VS STEELERS RESOLUTION                     ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  
  // First, find the Dolphins vs Steelers market from the wallet's trades
  const findMarketQuery = `
    SELECT DISTINCT
      m.condition_id,
      m.token_id_dec,
      m.outcome_index,
      meta.question,
      meta.outcomes
    FROM pm_trader_events_dedup_v2_tbl t
    INNER JOIN pm_token_to_condition_map_v4 m
      ON toString(t.token_id) = toString(m.token_id_dec)
    LEFT JOIN pm_markets_metadata meta
      ON lower(m.condition_id) = lower(meta.condition_id)
    WHERE lower(t.trader_wallet) = lower('${wallet}')
      AND (
        lower(meta.question) LIKE '%dolphin%'
        OR lower(meta.question) LIKE '%steeler%'
        OR lower(meta.question) LIKE '%pittsburgh%'
        OR lower(meta.question) LIKE '%miami%'
      )
    LIMIT 10
  `;
  
  console.log('Finding Dolphins vs Steelers market for wallet...');
  const result = await client.query({ query: findMarketQuery, format: 'JSONEachRow' });
  const rows = await result.json() as any[];
  
  if (rows.length === 0) {
    console.log('No Dolphins/Steelers markets found via metadata. Trying alternative search...\n');
    
    // Try finding by looking at all wallet positions and checking latest resolutions
    const allPositionsQuery = `
      SELECT
        m.condition_id,
        m.outcome_index,
        meta.question,
        r.payout_numerators,
        r.resolution_time,
        count() as trade_count,
        sum(CASE WHEN t.side = 'buy' THEN -t.usdc_amount ELSE t.usdc_amount END) / 1000000.0 as cash_flow,
        sum(CASE WHEN t.side = 'buy' THEN t.token_amount ELSE -t.token_amount END) / 1000000.0 as final_shares
      FROM pm_trader_events_dedup_v2_tbl t
      INNER JOIN pm_token_to_condition_map_v4 m
        ON toString(t.token_id) = toString(m.token_id_dec)
      LEFT JOIN pm_markets_metadata meta
        ON lower(m.condition_id) = lower(meta.condition_id)
      LEFT JOIN pm_condition_resolutions r
        ON lower(m.condition_id) = lower(r.condition_id)
        AND r.is_deleted = 0
      WHERE lower(t.trader_wallet) = lower('${wallet}')
      GROUP BY m.condition_id, m.outcome_index, meta.question, r.payout_numerators, r.resolution_time
      ORDER BY final_shares DESC
      LIMIT 20
    `;
    
    const posResult = await client.query({ query: allPositionsQuery, format: 'JSONEachRow' });
    const posRows = await posResult.json() as any[];
    
    console.log('Top positions by share size:');
    console.log('─'.repeat(100));
    
    let unresolvedCount = 0;
    let resolvedCount = 0;
    
    for (const row of posRows) {
      const question = row.question?.slice(0, 50) || 'Unknown';
      const isResolved = row.payout_numerators ? '✅' : '❌';
      const shares = Number(row.final_shares).toFixed(2);
      const cashFlow = Number(row.cash_flow).toFixed(2);
      
      if (row.payout_numerators) {
        resolvedCount++;
      } else {
        unresolvedCount++;
      }
      
      console.log(`${isResolved} ${question.padEnd(52)} | Shares: ${shares.padStart(10)} | Cash: ${cashFlow.padStart(10)} | Payout: ${row.payout_numerators || 'NONE'}`);
    }
    
    console.log('─'.repeat(100));
    console.log(`\nResolved: ${resolvedCount} | Unresolved: ${unresolvedCount}`);
    
    return;
  }
  
  console.log('Found markets:', JSON.stringify(rows, null, 2));
  
  const conditionId = rows[0].condition_id;
  console.log('\nChecking resolution for condition_id:', conditionId);
  
  // Check if this condition_id has a resolution
  const resolutionQuery = `
    SELECT *
    FROM pm_condition_resolutions
    WHERE lower(condition_id) = lower('${conditionId}')
  `;
  
  const resResult = await client.query({ query: resolutionQuery, format: 'JSONEachRow' });
  const resRows = await resResult.json() as any[];
  
  if (resRows.length > 0) {
    console.log('\n✅ Resolution EXISTS:', JSON.stringify(resRows, null, 2));
  } else {
    console.log('\n❌ NO RESOLUTION FOUND for this condition_id!');
    console.log('This explains why our PnL is off - we are treating this as unresolved.');
  }
}

main().catch(console.error);
