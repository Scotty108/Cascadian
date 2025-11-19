#!/usr/bin/env tsx
/**
 * Phase 1, Step 1.1: Analyze Trade Sources for PnL v2
 *
 * Objective: Understand existing data and identify where IDs are missing
 *
 * Analysis:
 * 1. vw_trades_canonical structure and null ID rates
 * 2. clob_fills asset_id coverage
 * 3. erc1155_transfers token_id coverage
 * 4. market_resolutions_final condition_id mappings
 * 5. Overlap and gaps between sources
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';
import * as fs from 'fs';

interface AnalysisReport {
  timestamp: string;
  vw_trades_canonical: any;
  clob_fills: any;
  erc1155_transfers: any;
  market_resolutions_final: any;
  overlap_analysis: any;
  recommendations: string[];
}

async function main() {
  console.log('🔍 Analyzing Trade Sources for PnL v2');
  console.log('='.repeat(80));
  console.log('');

  const report: AnalysisReport = {
    timestamp: new Date().toISOString(),
    vw_trades_canonical: {},
    clob_fills: {},
    erc1155_transfers: {},
    market_resolutions_final: {},
    overlap_analysis: {},
    recommendations: []
  };

  // ========================================================================
  // Analysis 1: vw_trades_canonical
  // ========================================================================

  console.log('Analysis 1: vw_trades_canonical Structure & Null IDs');
  console.log('-'.repeat(80));

  try {
    // Check schema
    const schemaResult = await clickhouse.query({
      query: 'DESCRIBE vw_trades_canonical',
      format: 'JSONEachRow'
    });
    const schema = await schemaResult.json();
    console.log('✓ Schema retrieved:', schema.length, 'columns');

    // Check null ID rates
    const nullCheckResult = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_trades,
          COUNT(DISTINCT wallet_address_norm) as distinct_wallets,
          SUM(CASE WHEN market_id_norm IS NULL OR market_id_norm = '0x0000000000000000000000000000000000000000000000000000000000000000' THEN 1 ELSE 0 END) as null_market_ids,
          SUM(CASE WHEN condition_id_norm IS NULL OR condition_id_norm = '0x0000000000000000000000000000000000000000000000000000000000000000' THEN 1 ELSE 0 END) as null_condition_ids,
          MIN(timestamp) as earliest_trade,
          MAX(timestamp) as latest_trade
        FROM vw_trades_canonical
      `,
      format: 'JSONEachRow'
    });
    const nullCheck = (await nullCheckResult.json())[0];

    const nullMarketPct = (parseInt(nullCheck.null_market_ids) / parseInt(nullCheck.total_trades)) * 100;
    const nullConditionPct = (parseInt(nullCheck.null_condition_ids) / parseInt(nullCheck.total_trades)) * 100;

    console.log('Total trades:', parseInt(nullCheck.total_trades).toLocaleString());
    console.log('Distinct wallets:', parseInt(nullCheck.distinct_wallets).toLocaleString());
    console.log('Null market IDs:', parseInt(nullCheck.null_market_ids).toLocaleString(), `(${nullMarketPct.toFixed(2)}%)`);
    console.log('Null condition IDs:', parseInt(nullCheck.null_condition_ids).toLocaleString(), `(${nullConditionPct.toFixed(2)}%)`);
    console.log('Date range:', nullCheck.earliest_trade, 'to', nullCheck.latest_trade);

    report.vw_trades_canonical = {
      total_trades: parseInt(nullCheck.total_trades),
      distinct_wallets: parseInt(nullCheck.distinct_wallets),
      null_market_ids: parseInt(nullCheck.null_market_ids),
      null_market_pct: nullMarketPct,
      null_condition_ids: parseInt(nullCheck.null_condition_ids),
      null_condition_pct: nullConditionPct,
      date_range: {
        earliest: nullCheck.earliest_trade,
        latest: nullCheck.latest_trade
      },
      schema: schema
    };

  } catch (error) {
    console.error('❌ Error analyzing vw_trades_canonical:', error.message);
    report.vw_trades_canonical = { error: error.message };
  }

  console.log('');

  // ========================================================================
  // Analysis 2: clob_fills
  // ========================================================================

  console.log('Analysis 2: clob_fills Asset ID Coverage');
  console.log('-'.repeat(80));

  try {
    // Check schema
    const schemaResult = await clickhouse.query({
      query: 'DESCRIBE clob_fills',
      format: 'JSONEachRow'
    });
    const schema = await schemaResult.json();
    console.log('✓ Schema retrieved:', schema.length, 'columns');

    // Check asset_id coverage
    const assetCheckResult = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_fills,
          COUNT(DISTINCT wallet) as distinct_wallets,
          COUNT(DISTINCT asset_id) as unique_assets,
          SUM(CASE WHEN asset_id IS NULL OR asset_id = '' THEN 1 ELSE 0 END) as null_asset_ids,
          MIN(created_at) as earliest_fill,
          MAX(created_at) as latest_fill
        FROM clob_fills
      `,
      format: 'JSONEachRow'
    });
    const assetCheck = (await assetCheckResult.json())[0];

    const nullAssetPct = (parseInt(assetCheck.null_asset_ids) / parseInt(assetCheck.total_fills)) * 100;

    console.log('Total fills:', parseInt(assetCheck.total_fills).toLocaleString());
    console.log('Distinct wallets:', parseInt(assetCheck.distinct_wallets).toLocaleString());
    console.log('Unique assets:', parseInt(assetCheck.unique_assets).toLocaleString());
    console.log('Null asset IDs:', parseInt(assetCheck.null_asset_ids).toLocaleString(), `(${nullAssetPct.toFixed(2)}%)`);
    console.log('Date range:', assetCheck.earliest_fill, 'to', assetCheck.latest_fill);

    report.clob_fills = {
      total_fills: parseInt(assetCheck.total_fills),
      distinct_wallets: parseInt(assetCheck.distinct_wallets),
      unique_assets: parseInt(assetCheck.unique_assets),
      null_asset_ids: parseInt(assetCheck.null_asset_ids),
      null_asset_pct: nullAssetPct,
      date_range: {
        earliest: assetCheck.earliest_fill,
        latest: assetCheck.latest_fill
      },
      schema: schema
    };

  } catch (error) {
    console.error('❌ Error analyzing clob_fills:', error.message);
    report.clob_fills = { error: error.message };
  }

  console.log('');

  // ========================================================================
  // Analysis 3: erc1155_transfers
  // ========================================================================

  console.log('Analysis 3: erc1155_transfers Token ID Coverage');
  console.log('-'.repeat(80));

  try {
    // Check schema
    const schemaResult = await clickhouse.query({
      query: 'DESCRIBE erc1155_transfers',
      format: 'JSONEachRow'
    });
    const schema = await schemaResult.json();
    console.log('✓ Schema retrieved:', schema.length, 'columns');

    // Check token_id coverage
    const tokenCheckResult = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_transfers,
          COUNT(DISTINCT from_address) + COUNT(DISTINCT to_address) as distinct_addresses,
          COUNT(DISTINCT token_id) as unique_tokens,
          SUM(CASE WHEN token_id IS NULL OR token_id = '' THEN 1 ELSE 0 END) as null_token_ids,
          MIN(block_timestamp) as earliest_transfer,
          MAX(block_timestamp) as latest_transfer
        FROM erc1155_transfers
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });
    const tokenCheck = (await tokenCheckResult.json())[0];

    const nullTokenPct = (parseInt(tokenCheck.null_token_ids) / parseInt(tokenCheck.total_transfers)) * 100;

    console.log('Total transfers:', parseInt(tokenCheck.total_transfers).toLocaleString());
    console.log('Distinct addresses:', parseInt(tokenCheck.distinct_addresses).toLocaleString());
    console.log('Unique tokens:', parseInt(tokenCheck.unique_tokens).toLocaleString());
    console.log('Null token IDs:', parseInt(tokenCheck.null_token_ids).toLocaleString(), `(${nullTokenPct.toFixed(2)}%)`);
    console.log('Date range:', tokenCheck.earliest_transfer, 'to', tokenCheck.latest_transfer);

    report.erc1155_transfers = {
      total_transfers: parseInt(tokenCheck.total_transfers),
      distinct_addresses: parseInt(tokenCheck.distinct_addresses),
      unique_tokens: parseInt(tokenCheck.unique_tokens),
      null_token_ids: parseInt(tokenCheck.null_token_ids),
      null_token_pct: nullTokenPct,
      date_range: {
        earliest: tokenCheck.earliest_transfer,
        latest: tokenCheck.latest_transfer
      },
      schema: schema
    };

  } catch (error) {
    console.error('❌ Error analyzing erc1155_transfers:', error.message);
    report.erc1155_transfers = { error: error.message };
  }

  console.log('');

  // ========================================================================
  // Analysis 4: market_resolutions_final
  // ========================================================================

  console.log('Analysis 4: market_resolutions_final Condition ID Mappings');
  console.log('-'.repeat(80));

  try {
    // Check resolution coverage
    const resolutionCheckResult = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_resolutions,
          COUNT(DISTINCT market_id) as unique_markets,
          COUNT(DISTINCT condition_id) as unique_conditions,
          MIN(resolved_at) as earliest_resolution,
          MAX(resolved_at) as latest_resolution
        FROM market_resolutions_final
      `,
      format: 'JSONEachRow'
    });
    const resolutionCheck = (await resolutionCheckResult.json())[0];

    console.log('Total resolutions:', parseInt(resolutionCheck.total_resolutions).toLocaleString());
    console.log('Unique markets:', parseInt(resolutionCheck.unique_markets).toLocaleString());
    console.log('Unique conditions:', parseInt(resolutionCheck.unique_conditions).toLocaleString());
    console.log('Date range:', resolutionCheck.earliest_resolution, 'to', resolutionCheck.latest_resolution);

    report.market_resolutions_final = {
      total_resolutions: parseInt(resolutionCheck.total_resolutions),
      unique_markets: parseInt(resolutionCheck.unique_markets),
      unique_conditions: parseInt(resolutionCheck.unique_conditions),
      date_range: {
        earliest: resolutionCheck.earliest_resolution,
        latest: resolutionCheck.latest_resolution
      }
    };

  } catch (error) {
    console.error('❌ Error analyzing market_resolutions_final:', error.message);
    report.market_resolutions_final = { error: error.message };
  }

  console.log('');

  // ========================================================================
  // Analysis 5: Overlap Between Sources
  // ========================================================================

  console.log('Analysis 5: Overlap & Gap Analysis');
  console.log('-'.repeat(80));

  try {
    // Check how many null market IDs in vw_trades_canonical can be repaired from resolutions
    const repairPotentialResult = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as null_market_trades,
          SUM(CASE WHEN r.market_id IS NOT NULL THEN 1 ELSE 0 END) as repairable_from_resolutions,
          SUM(CASE WHEN r.market_id IS NULL THEN 1 ELSE 0 END) as still_null
        FROM (
          SELECT condition_id_norm
          FROM vw_trades_canonical
          WHERE market_id_norm IS NULL OR market_id_norm = '0x0000000000000000000000000000000000000000000000000000000000000000'
          LIMIT 1000000
        ) t
        LEFT JOIN market_resolutions_final r
          ON t.condition_id_norm = r.condition_id
      `,
      format: 'JSONEachRow'
    });
    const repairPotential = (await repairPotentialResult.json())[0];

    const repairablePct = (parseInt(repairPotential.repairable_from_resolutions) / parseInt(repairPotential.null_market_trades)) * 100;

    console.log('Null market ID trades (sample):', parseInt(repairPotential.null_market_trades).toLocaleString());
    console.log('Repairable from resolutions:', parseInt(repairPotential.repairable_from_resolutions).toLocaleString(), `(${repairablePct.toFixed(2)}%)`);
    console.log('Still null after repair:', parseInt(repairPotential.still_null).toLocaleString());

    report.overlap_analysis = {
      null_market_trades_sample: parseInt(repairPotential.null_market_trades),
      repairable_from_resolutions: parseInt(repairPotential.repairable_from_resolutions),
      repairable_pct: repairablePct,
      still_null: parseInt(repairPotential.still_null)
    };

  } catch (error) {
    console.error('❌ Error in overlap analysis:', error.message);
    report.overlap_analysis = { error: error.message };
  }

  console.log('');

  // ========================================================================
  // Recommendations
  // ========================================================================

  console.log('='.repeat(80));
  console.log('Recommendations for PnL v2:');
  console.log('='.repeat(80));

  if (report.vw_trades_canonical.null_market_pct > 5) {
    const rec = `⚠️  High null market ID rate (${report.vw_trades_canonical.null_market_pct.toFixed(1)}%) - Global repair required`;
    console.log(rec);
    report.recommendations.push(rec);
  }

  if (report.overlap_analysis.repairable_pct > 50) {
    const rec = `✅ ${report.overlap_analysis.repairable_pct.toFixed(1)}% of null market IDs can be repaired from market_resolutions_final`;
    console.log(rec);
    report.recommendations.push(rec);
  }

  if (report.clob_fills.null_asset_pct < 1) {
    const rec = `✅ clob_fills has good asset_id coverage (${(100 - report.clob_fills.null_asset_pct).toFixed(1)}%)`;
    console.log(rec);
    report.recommendations.push(rec);
  }

  if (report.erc1155_transfers.null_token_pct < 1) {
    const rec = `✅ erc1155_transfers has good token_id coverage (${(100 - report.erc1155_transfers.null_token_pct).toFixed(1)}%)`;
    console.log(rec);
    report.recommendations.push(rec);
  }

  console.log('');

  // ========================================================================
  // Save Report
  // ========================================================================

  const reportPath = `reports/TRADE_SOURCES_ANALYSIS_${new Date().toISOString().split('T')[0]}.json`;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log('✅ Analysis report saved to:', reportPath);
}

main().catch(console.error);
