#!/usr/bin/env tsx
/**
 * Edge Case Detection Suite
 * Step E (partial) from PnL TDD Validation Plan
 *
 * Detects potential data quality issues that could cause PnL calculation errors:
 * 1. Negative final shares in resolved markets
 * 2. Unmapped tokens (trades not assignable to conditions)
 * 3. Duplicate resolutions
 * 4. Zero-fee trades
 * 5. Egg wallet specific mapping coverage
 */

import * as dotenv from 'dotenv';
import { clickhouse } from '../lib/clickhouse/client';

// Load environment variables
dotenv.config({ path: '.env.local' });

interface NegativeSharesResult {
  negative_position_count: string;
}

interface UnmappedTokensResult {
  unmapped_token_count: string;
  unmapped_trade_count: string;
  unmapped_volume: string;
}

interface DuplicateResolutionsResult {
  condition_id: string;
  resolution_count: string;
}

interface FeeDistributionResult {
  zero_fee_count: string;
  has_fee_count: string;
  total: string;
}

interface EggWalletMappingResult {
  mapped: string;
  unmapped: string;
}

async function runEdgeCaseDetection() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║          Edge Case Detection Suite - Step E (partial)         ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  try {
    // 1. Negative final shares
    console.log('━━━ 1. NEGATIVE FINAL SHARES (should be 0 or very small) ━━━\n');
    const negativeSharesQuery = `
      WITH positions AS (
          SELECT
              t.trader_wallet,
              m.condition_id,
              m.outcome_index,
              sum(CASE WHEN t.side = 'BUY' THEN t.token_amount ELSE -t.token_amount END) as final_shares
          FROM pm_trader_events_v2 t
          JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
          JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
          GROUP BY t.trader_wallet, m.condition_id, m.outcome_index
      )
      SELECT count(*) as negative_position_count
      FROM positions
      WHERE final_shares < -0.01
    `;

    const negativeShares = await clickhouse.query<NegativeSharesResult>({
      query: negativeSharesQuery,
      format: 'JSONEachRow'
    });
    const negativeData = await negativeShares.json<NegativeSharesResult[]>();
    const negCount = parseInt(negativeData[0]?.negative_position_count || '0');
    console.log(`Negative position count: ${negCount.toLocaleString()}`);
    if (negCount > 0) {
      console.log('⚠️  WARNING: Found negative positions in resolved markets!');
    } else {
      console.log('✅ PASS: No negative positions found');
    }

    // 2. Unmapped tokens
    console.log('\n━━━ 2. UNMAPPED TOKENS (trades not assignable to conditions) ━━━\n');
    const unmappedQuery = `
      SELECT
          count(DISTINCT t.token_id) as unmapped_token_count,
          count(*) as unmapped_trade_count,
          sum(t.usdc_amount) as unmapped_volume
      FROM pm_trader_events_v2 t
      LEFT JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
      WHERE m.condition_id IS NULL
    `;

    const unmapped = await clickhouse.query<UnmappedTokensResult>({
      query: unmappedQuery,
      format: 'JSONEachRow'
    });
    const unmappedData = await unmapped.json<UnmappedTokensResult[]>();
    const unmappedTokens = parseInt(unmappedData[0]?.unmapped_token_count || '0');
    const unmappedTrades = parseInt(unmappedData[0]?.unmapped_trade_count || '0');
    const unmappedVolume = parseFloat(unmappedData[0]?.unmapped_volume || '0');

    console.log(`Unmapped token IDs: ${unmappedTokens.toLocaleString()}`);
    console.log(`Unmapped trade events: ${unmappedTrades.toLocaleString()}`);
    console.log(`Unmapped volume: $${unmappedVolume.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

    if (unmappedTrades > 0) {
      console.log('⚠️  WARNING: Found unmapped trades - PnL calculations may be incomplete');
    } else {
      console.log('✅ PASS: All trades mapped to conditions');
    }

    // 3. Duplicate resolutions
    console.log('\n━━━ 3. DUPLICATE RESOLUTIONS (same condition resolved twice) ━━━\n');
    const duplicateQuery = `
      SELECT
          condition_id,
          count(*) as resolution_count
      FROM pm_condition_resolutions
      GROUP BY condition_id
      HAVING count(*) > 1
      LIMIT 10
    `;

    const duplicates = await clickhouse.query<DuplicateResolutionsResult>({
      query: duplicateQuery,
      format: 'JSONEachRow'
    });
    const duplicateData = await duplicates.json<DuplicateResolutionsResult[]>();

    if (duplicateData.length > 0) {
      console.log(`⚠️  WARNING: Found ${duplicateData.length} conditions with duplicate resolutions:`);
      duplicateData.forEach(row => {
        console.log(`  - ${row.condition_id}: ${row.resolution_count} resolutions`);
      });
    } else {
      console.log('✅ PASS: No duplicate resolutions found');
    }

    // 4. Zero-fee trades
    console.log('\n━━━ 4. ZERO-FEE TRADES (sanity check) ━━━\n');
    const feeQuery = `
      SELECT
          countIf(fee_amount = 0) as zero_fee_count,
          countIf(fee_amount > 0) as has_fee_count,
          count(*) as total
      FROM pm_trader_events_v2
    `;

    const fees = await clickhouse.query<FeeDistributionResult>({
      query: feeQuery,
      format: 'JSONEachRow'
    });
    const feeData = await fees.json<FeeDistributionResult[]>();
    const zeroFees = parseInt(feeData[0]?.zero_fee_count || '0');
    const hasFees = parseInt(feeData[0]?.has_fee_count || '0');
    const total = parseInt(feeData[0]?.total || '0');

    console.log(`Total trades: ${total.toLocaleString()}`);
    console.log(`Trades with fees: ${hasFees.toLocaleString()} (${((hasFees / total) * 100).toFixed(2)}%)`);
    console.log(`Trades with zero fees: ${zeroFees.toLocaleString()} (${((zeroFees / total) * 100).toFixed(2)}%)`);

    if (zeroFees / total > 0.1) {
      console.log('⚠️  WARNING: More than 10% of trades have zero fees');
    } else {
      console.log('✅ PASS: Fee distribution looks normal');
    }

    // 5. Egg wallet specific - unmapped trades
    console.log('\n━━━ 5. EGG WALLET UNMAPPED TRADES ━━━\n');
    const eggWalletQuery = `
      SELECT
          countIf(m.condition_id IS NOT NULL) as mapped,
          countIf(m.condition_id IS NULL) as unmapped
      FROM pm_trader_events_v2 t
      LEFT JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
      WHERE t.trader_wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
    `;

    const eggWallet = await clickhouse.query<EggWalletMappingResult>({
      query: eggWalletQuery,
      format: 'JSONEachRow'
    });
    const eggData = await eggWallet.json<EggWalletMappingResult[]>();
    const eggMapped = parseInt(eggData[0]?.mapped || '0');
    const eggUnmapped = parseInt(eggData[0]?.unmapped || '0');
    const eggTotal = eggMapped + eggUnmapped;

    console.log(`Egg wallet (0xcce2b7c71f21e358b8e5e797e586cbc03160d58b):`);
    console.log(`  Mapped trades: ${eggMapped.toLocaleString()} (${((eggMapped / eggTotal) * 100).toFixed(2)}%)`);
    console.log(`  Unmapped trades: ${eggUnmapped.toLocaleString()} (${((eggUnmapped / eggTotal) * 100).toFixed(2)}%)`);

    if (eggUnmapped > 0) {
      console.log('⚠️  WARNING: Egg wallet has unmapped trades');
    } else {
      console.log('✅ PASS: All Egg wallet trades mapped');
    }

    // Summary
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║                       OVERALL ASSESSMENT                       ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    let issuesFound = 0;
    if (negCount > 0) {
      console.log('❌ Negative positions in resolved markets');
      issuesFound++;
    }
    if (unmappedTrades > 0) {
      console.log(`❌ ${unmappedTrades.toLocaleString()} unmapped trades ($${unmappedVolume.toLocaleString(undefined, { minimumFractionDigits: 2 })} volume)`);
      issuesFound++;
    }
    if (duplicateData.length > 0) {
      console.log(`❌ ${duplicateData.length} conditions with duplicate resolutions`);
      issuesFound++;
    }
    if (zeroFees / total > 0.1) {
      console.log(`❌ ${((zeroFees / total) * 100).toFixed(2)}% of trades have zero fees`);
      issuesFound++;
    }
    if (eggUnmapped > 0) {
      console.log(`❌ Egg wallet has ${eggUnmapped} unmapped trades`);
      issuesFound++;
    }

    if (issuesFound === 0) {
      console.log('✅ ALL CHECKS PASSED - No edge cases detected');
    } else {
      console.log(`\n⚠️  FOUND ${issuesFound} ISSUE(S) - Review needed`);
    }

  } catch (error) {
    console.error('Error running edge case detection:', error);
    throw error;
  }
}

// Run the detection
runEdgeCaseDetection()
  .then(() => {
    console.log('\n✅ Edge case detection complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Edge case detection failed:', error);
    process.exit(1);
  });
