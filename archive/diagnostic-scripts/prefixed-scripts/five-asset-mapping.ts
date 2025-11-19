/**
 * FIVE-ASSET MAPPING VERIFICATION
 *
 * Purpose: Show complete token → condition_id → resolution chain for 5 assets
 * to identify where the join is failing
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const TARGET_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

interface AssetMapping {
  asset_id: string;
  token_id_raw: string;
  condition_id_hex_derived: string;
  outcome_index_derived: number;
  condition_id_norm_used_for_join: string;
  join_found_in_resolutions: boolean;
  winning_index_from_resolutions: number | null;
  payout_numerators_from_resolutions: any;
  payout_array_length: number;
  net_shares_just_before_resolved_at: number;
  realized_at_resolution_usd_expected: number;
  market_slug_or_id: string;
  tx_hash_examples: string;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('FIVE-ASSET MAPPING VERIFICATION');
  console.log(`Wallet: ${TARGET_WALLET}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  // Step 1: Get 5 assets with resolved positions
  console.log('📊 Step 1: Selecting 5 assets with net positions...\n');

  const assetsQuery = await clickhouse.query({
    query: `
      WITH wallet_fills AS (
        SELECT
          asset_id,
          market_slug,
          groupArray(tx_hash) as tx_hashes,
          sum(if(side = 'BUY', 1, -1) * size / 1000000.0) as net_shares,
          sum(if(side = 'BUY', 1, 0) * size / 1000000.0 * price) as cost_basis
        FROM clob_fills
        WHERE proxy_wallet = '${TARGET_WALLET}'
        GROUP BY asset_id, market_slug
        HAVING net_shares != 0
      )
      SELECT
        asset_id,
        market_slug,
        arrayElement(tx_hashes, 1) as first_tx_hash,
        net_shares,
        cost_basis
      FROM wallet_fills
      ORDER BY cost_basis DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const assets: any[] = await assetsQuery.json();
  console.log(`✅ Found ${assets.length} assets with net positions\n`);

  // Step 2: For each asset, decode and check resolution
  const mappings: AssetMapping[] = [];

  for (const asset of assets) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Asset: ${asset.asset_id.substring(0, 20)}...`);
    console.log(`Market: ${asset.market_slug}`);
    console.log(`Net Shares: ${asset.net_shares}`);
    console.log(`Cost Basis: $${asset.cost_basis}`);
    console.log(`${'='.repeat(80)}\n`);

    // Decode using ClickHouse bitwise operations
    const decodeQuery = await clickhouse.query({
      query: `
        SELECT
          '${asset.asset_id}' as asset_id,
          '${asset.asset_id}' as token_id_raw,
          lpad(lower(hex(bitShiftRight(toUInt256('${asset.asset_id}'), 8))), 64, '0') as condition_id_hex_derived,
          toUInt8(bitAnd(toUInt256('${asset.asset_id}'), 255)) as outcome_index_derived,
          lpad(lower(hex(bitShiftRight(toUInt256('${asset.asset_id}'), 8))), 64, '0') as condition_id_norm_used_for_join
      `,
      format: 'JSONEachRow'
    });

    const decoded: any = (await decodeQuery.json())[0];
    console.log('🔍 Token Decode:');
    console.log(`  Token ID: ${decoded.token_id_raw}`);
    console.log(`  Condition ID (hex): ${decoded.condition_id_hex_derived}`);
    console.log(`  Outcome Index: ${decoded.outcome_index_derived}`);
    console.log(`  Normalized for Join: ${decoded.condition_id_norm_used_for_join}\n`);

    // Check if resolution exists
    const resolutionQuery = await clickhouse.query({
      query: `
        SELECT
          condition_id_norm,
          winning_index,
          payout_numerators,
          length(payout_numerators) as array_length,
          resolved_at
        FROM market_resolutions_final
        WHERE condition_id_norm = '${decoded.condition_id_norm_used_for_join}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const resolutionRows: any[] = await resolutionQuery.json();
    const resolution = resolutionRows.length > 0 ? resolutionRows[0] : null;

    console.log('🔗 Resolution Join:');
    if (resolution) {
      console.log(`  ✅ MATCH FOUND in market_resolutions_final`);
      console.log(`  Winning Index: ${resolution.winning_index}`);
      console.log(`  Payout Array Length: ${resolution.array_length}`);
      console.log(`  Payout Numerators: ${JSON.stringify(resolution.payout_numerators)}`);
      console.log(`  Resolved At: ${resolution.resolved_at}`);

      // Calculate payout for this position
      let payout = 0;
      if (Array.isArray(resolution.payout_numerators)) {
        // ClickHouse arrays are 1-indexed
        payout = resolution.payout_numerators[decoded.outcome_index_derived];
        console.log(`  Payout for Outcome ${decoded.outcome_index_derived}: ${payout}`);
      } else {
        console.log(`  ⚠️  Payout array is not an array: ${typeof resolution.payout_numerators}`);
      }

      // Calculate expected P&L at resolution
      const resolution_value = asset.net_shares * payout;
      const realized_pnl = resolution_value - asset.cost_basis;
      console.log(`  Expected Resolution Value: $${resolution_value.toFixed(2)}`);
      console.log(`  Expected Realized P&L: $${realized_pnl.toFixed(2)}`);

      mappings.push({
        asset_id: asset.asset_id,
        token_id_raw: decoded.token_id_raw,
        condition_id_hex_derived: decoded.condition_id_hex_derived,
        outcome_index_derived: decoded.outcome_index_derived,
        condition_id_norm_used_for_join: decoded.condition_id_norm_used_for_join,
        join_found_in_resolutions: true,
        winning_index_from_resolutions: resolution.winning_index,
        payout_numerators_from_resolutions: resolution.payout_numerators,
        payout_array_length: resolution.array_length,
        net_shares_just_before_resolved_at: asset.net_shares,
        realized_at_resolution_usd_expected: realized_pnl,
        market_slug_or_id: asset.market_slug,
        tx_hash_examples: asset.first_tx_hash,
      });
    } else {
      console.log(`  ❌ NO MATCH FOUND in market_resolutions_final`);
      console.log(`  Condition ID searched: ${decoded.condition_id_norm_used_for_join}`);

      // Try to find similar condition_ids
      const similarQuery = await clickhouse.query({
        query: `
          SELECT
            condition_id_norm,
            winning_index,
            resolved_at
          FROM market_resolutions_final
          WHERE condition_id_norm LIKE '${decoded.condition_id_norm_used_for_join.substring(0, 10)}%'
          LIMIT 5
        `,
        format: 'JSONEachRow'
      });

      const similar: any[] = await similarQuery.json();
      if (similar.length > 0) {
        console.log(`  Found ${similar.length} similar condition_ids:`);
        for (const s of similar) {
          console.log(`    - ${s.condition_id_norm.substring(0, 20)}... (winning: ${s.winning_index})`);
        }
      } else {
        console.log(`  No similar condition_ids found`);
      }

      mappings.push({
        asset_id: asset.asset_id,
        token_id_raw: decoded.token_id_raw,
        condition_id_hex_derived: decoded.condition_id_hex_derived,
        outcome_index_derived: decoded.outcome_index_derived,
        condition_id_norm_used_for_join: decoded.condition_id_norm_used_for_join,
        join_found_in_resolutions: false,
        winning_index_from_resolutions: null,
        payout_numerators_from_resolutions: null,
        payout_array_length: 0,
        net_shares_just_before_resolved_at: asset.net_shares,
        realized_at_resolution_usd_expected: 0,
        market_slug_or_id: asset.market_slug,
        tx_hash_examples: asset.first_tx_hash,
      });
    }
  }

  // Step 3: Summary table
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('SUMMARY TABLE');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.table(mappings.map(m => ({
    asset_id: m.asset_id.substring(0, 20) + '...',
    outcome_idx: m.outcome_index_derived,
    join_found: m.join_found_in_resolutions ? '✅' : '❌',
    winning_idx: m.winning_index_from_resolutions,
    payout_len: m.payout_array_length,
    net_shares: m.net_shares_just_before_resolved_at.toFixed(2),
    expected_pnl: `$${m.realized_at_resolution_usd_expected.toFixed(2)}`,
    market: m.market_slug_or_id?.substring(0, 30) || 'N/A',
  })));

  // Step 4: Analysis
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════\n');

  const matched = mappings.filter(m => m.join_found_in_resolutions).length;
  const unmatched = mappings.filter(m => !m.join_found_in_resolutions).length;

  console.log(`Join Success Rate: ${matched}/${mappings.length} (${(matched / mappings.length * 100).toFixed(0)}%)`);
  console.log(`Unmatched: ${unmatched}\n`);

  if (unmatched > 0) {
    console.log('⚠️  JOIN FAILURE DETECTED');
    console.log('Possible causes:');
    console.log('  1. Token decoding formula incorrect');
    console.log('  2. Condition ID normalization mismatch (padding, case, prefix)');
    console.log('  3. market_resolutions_final missing data for these markets');
    console.log('  4. Different condition_id format between tables\n');
  }

  const total_expected_pnl = mappings.reduce((sum, m) => sum + m.realized_at_resolution_usd_expected, 0);
  console.log(`Total Expected Resolution P&L: $${total_expected_pnl.toFixed(2)}`);
  console.log(`Current Resolution P&L: $0.00 (from reconciliation engine)`);
  console.log(`Delta: $${total_expected_pnl.toFixed(2)}\n`);

  // Step 5: Save CSV
  const csv = [
    'asset_id,token_id_raw,condition_id_hex_derived,outcome_index_derived,condition_id_norm_used_for_join,join_found_in_resolutions,winning_index_from_resolutions,payout_array_length,net_shares_just_before_resolved_at,realized_at_resolution_usd_expected,market_slug_or_id,tx_hash_examples',
    ...mappings.map(m =>
      `${m.asset_id},${m.token_id_raw},${m.condition_id_hex_derived},${m.outcome_index_derived},${m.condition_id_norm_used_for_join},${m.join_found_in_resolutions},${m.winning_index_from_resolutions},${m.payout_array_length},${m.net_shares_just_before_resolved_at},${m.realized_at_resolution_usd_expected},${m.market_slug_or_id},${m.tx_hash_examples}`
    )
  ].join('\n');

  const fs = await import('fs');
  fs.writeFileSync('five_asset_mapping.csv', csv);
  console.log('💾 Saved: five_asset_mapping.csv\n');

  console.log('✅ VERIFICATION COMPLETE\n');
}

main().catch(console.error);
