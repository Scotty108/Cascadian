/**
 * Investigate wallet data coverage for validation failures
 * Usage: npx tsx scripts/pnl/investigate-wallet-coverage.ts <wallet_address>
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const wallet = process.argv[2] || '0xc9c6c65c1ebebc8a93c2e9bc3e906c179c299e96';

async function investigate() {
  console.log(`\n=== INVESTIGATING WALLET: ${wallet} ===\n`);

  // Step 1A: Check canonical fills (what V17 engine uses)
  console.log('=== STEP 1A: Canonical fills (pm_clob_fills_canonical_v1) ===');
  try {
    const canonical = await clickhouse.query({
      query: `
        SELECT
          count() AS fill_count,
          sum(abs(usdc_amount)) / 1e6 AS usd_notional,
          min(timestamp) AS min_ts,
          max(timestamp) AS max_ts,
          uniqExact(condition_id) AS uniq_conditions,
          uniqExact(token_id) AS uniq_tokens
        FROM pm_clob_fills_canonical_v1
        WHERE lower(wallet) = lower('${wallet}')
      `,
      format: 'JSONEachRow'
    });
    const rows = await canonical.json();
    console.log(JSON.stringify(rows, null, 2));
  } catch (e: any) {
    console.log('Error:', e.message);
  }

  // Step 1B: Check raw CLOB fills (pm_trader_events_v2)
  console.log('\n=== STEP 1B: Raw CLOB fills (pm_trader_events_v2 deduped) ===');
  try {
    const raw = await clickhouse.query({
      query: `
        SELECT
          count() AS fill_count,
          sum(abs(usdc)) AS usd_notional,
          min(trade_time) AS min_ts,
          max(trade_time) AS max_ts,
          uniqExact(token_id) AS uniq_tokens
        FROM (
          SELECT
            event_id,
            any(usdc_amount) / 1e6 AS usdc,
            any(trade_time) AS trade_time,
            any(token_id) AS token_id
          FROM pm_trader_events_v2
          WHERE lower(trader_wallet) = lower('${wallet}')
            AND is_deleted = 0
          GROUP BY event_id
        )
      `,
      format: 'JSONEachRow'
    });
    const rows = await raw.json();
    console.log(JSON.stringify(rows, null, 2));
  } catch (e: any) {
    console.log('Error:', e.message);
  }

  // Step 2: Check token mapping for this wallet's trades
  console.log('\n=== STEP 2: Token IDs and mapping status ===');
  try {
    const tokens = await clickhouse.query({
      query: `
        SELECT
          token_id,
          count() AS n,
          sum(abs(usdc)) AS usd
        FROM (
          SELECT
            event_id,
            any(usdc_amount) / 1e6 AS usdc,
            any(token_id) AS token_id
          FROM pm_trader_events_v2
          WHERE lower(trader_wallet) = lower('${wallet}')
            AND is_deleted = 0
          GROUP BY event_id
        )
        GROUP BY token_id
        ORDER BY usd DESC
        LIMIT 20
      `,
      format: 'JSONEachRow'
    });
    const tokenRows: any[] = await tokens.json();
    console.log('Top token_ids by volume:');
    console.log(JSON.stringify(tokenRows, null, 2));

    // Check if these tokens are mapped
    if (tokenRows.length > 0) {
      const tokenIds = tokenRows.map((r: any) => "'" + r.token_id + "'").join(',');
      console.log('\nMapping status for these tokens:');
      const mapped = await clickhouse.query({
        query: `
          SELECT
            token_id,
            condition_id,
            outcome_index
          FROM pm_token_to_condition_map_v5
          WHERE token_id IN (${tokenIds})
        `,
        format: 'JSONEachRow'
      });
      const mappedRows: any[] = await mapped.json();
      console.log(JSON.stringify(mappedRows, null, 2));
      console.log(`\nMapped: ${mappedRows.length} / ${tokenRows.length} tokens`);

      // Find unmapped tokens
      const mappedTokenIds = new Set(mappedRows.map(r => r.token_id));
      const unmapped = tokenRows.filter(r => !mappedTokenIds.has(r.token_id));
      if (unmapped.length > 0) {
        console.log('\n⚠️ UNMAPPED TOKENS:');
        console.log(JSON.stringify(unmapped, null, 2));
        const unmappedVolume = unmapped.reduce((sum, r) => sum + Number(r.usd), 0);
        console.log(`Total unmapped volume: $${unmappedVolume.toFixed(2)}`);
      }
    }
  } catch (e: any) {
    console.log('Error:', e.message);
  }

  // Step 3: Check resolutions for mapped conditions
  console.log('\n=== STEP 3: Resolution status for wallet markets ===');
  try {
    const resolutions = await clickhouse.query({
      query: `
        SELECT
          c.condition_id,
          c.outcome_index,
          r.payout_numerator IS NOT NULL as is_resolved,
          r.payout_numerator,
          count() as trade_count,
          sum(abs(t.usdc)) as volume
        FROM (
          SELECT
            event_id,
            any(token_id) AS token_id,
            any(usdc_amount) / 1e6 AS usdc
          FROM pm_trader_events_v2
          WHERE lower(trader_wallet) = lower('${wallet}')
            AND is_deleted = 0
          GROUP BY event_id
        ) t
        LEFT JOIN pm_token_to_condition_map_v5 c ON t.token_id = c.token_id
        LEFT JOIN vw_market_resolution_prices_v3 r ON c.condition_id = r.condition_id AND c.outcome_index = r.outcome_index
        WHERE c.condition_id != ''
        GROUP BY c.condition_id, c.outcome_index, r.payout_numerator
        ORDER BY volume DESC
        LIMIT 20
      `,
      format: 'JSONEachRow'
    });
    const rows: any[] = await resolutions.json();
    console.log(JSON.stringify(rows, null, 2));

    const resolved = rows.filter(r => r.is_resolved);
    const unresolved = rows.filter(r => !r.is_resolved);
    console.log(`\nResolved markets: ${resolved.length}, Unresolved: ${unresolved.length}`);
  } catch (e: any) {
    console.log('Error:', e.message);
  }

  process.exit(0);
}

investigate();
