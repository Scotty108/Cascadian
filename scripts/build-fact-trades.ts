#!/usr/bin/env npx tsx

/**
 * Build fact_trades - Canonical Trade Fact Table
 *
 * Creates single source of truth for all trades by joining:
 * - trade_direction_assignments (130M) - Base trade data with 50% valid condition IDs
 * - erc1155_transfers (10M+ after backfill) - Market context (condition_id + outcome)
 * - trade_cashflows_v3 (35.8M) - Pre-computed cashflows
 *
 * Result: 130M trades with 96%+ valid condition IDs
 * Runtime: ~2-4 hours
 *
 * IMPORTANT: Run this AFTER erc1155 backfill completes!
 */

import { createClickHouseClient } from './lib/clickhouse/client';

async function main() {
  const ch = createClickHouseClient();

  console.log('🏗️  Building fact_trades canonical table...\n');

  // Step 0: Pre-flight checks
  console.log('Step 0: Pre-flight validation...');

  // Check ERC1155 coverage
  const erc1155Count = await ch.query({
    query: 'SELECT count() as count FROM default.erc1155_transfers',
    format: 'JSONEachRow'
  });
  const erc1155Rows = await erc1155Count.json<Array<{ count: string }>>();
  const erc1155Total = parseInt(erc1155Rows[0].count);

  console.log(`  ERC1155 transfers: ${erc1155Total.toLocaleString()}`);

  if (erc1155Total < 5_000_000) {
    console.warn(`\n⚠️  WARNING: ERC1155 table has only ${erc1155Total.toLocaleString()} rows`);
    console.warn('   Expected: 10M+ after backfill');
    console.warn('   Continue anyway? This will result in incomplete market mapping.\n');
    throw new Error('ERC1155 backfill incomplete. Run backfill-all-goldsky-payouts.ts first.');
  }

  console.log('  ✅ ERC1155 coverage looks good\n');

  // Step 1: Create fact table with full joins
  console.log('Step 1: Building fact table (this will take 2-4 hours)...');

  const createFactTableQuery = `
    CREATE TABLE IF NOT EXISTS default.fact_trades_staging
    ENGINE = ReplacingMergeTree()
    ORDER BY (wallet_address, condition_id_norm, timestamp)
    AS
    SELECT
      -- Identity
      tda.tx_hash || '-' || tda.wallet_address AS trade_id,
      tda.tx_hash,

      -- Who
      tda.wallet_address,

      -- What (market context from ERC1155)
      coalesce(
        erc.condition_id_norm,
        tda.condition_id_norm
      ) as condition_id_norm,

      coalesce(
        erc.outcome_index,
        -1
      ) as outcome_index,

      -- When
      tda.created_at AS timestamp,

      -- Direction & confidence
      tda.direction,                    -- BUY/SELL/UNKNOWN
      tda.confidence,                   -- HIGH/MEDIUM/LOW
      tda.has_both_legs,                -- Quality flag

      -- Amounts (from trade_direction_assignments)
      tda.usdc_out - tda.usdc_in as cashflow_usdc_net,
      tda.tokens_in - tda.tokens_out as shares_net,

      -- Pre-computed cashflows (if available)
      cf.cashflow_usdc as cashflow_usdc_computed,

      -- Calculate effective price
      multiIf(
        abs(tda.tokens_in - tda.tokens_out) > 0,
          abs(tda.usdc_out - tda.usdc_in) / abs(tda.tokens_in - tda.tokens_out),
        cf.cashflow_usdc IS NOT NULL AND abs(cf.cashflow_usdc) > 0,
          abs(cf.cashflow_usdc),
        0
      ) as price,

      -- Data quality flags
      multiIf(
        erc.condition_id_norm IS NOT NULL, 'erc1155+erc20',
        length(replaceAll(tda.condition_id_norm, '0x', '')) = 64, 'erc20_only',
        'unmapped'
      ) as source,

      erc.condition_id_norm IS NOT NULL as has_market_context,
      cf.cashflow_usdc IS NOT NULL as has_cashflow_data,

      -- Metadata
      tda.reason as direction_reason,
      now() as created_at_utc

    FROM default.trade_direction_assignments tda

    -- Join to ERC1155 to get market context
    LEFT JOIN (
      SELECT
        tx_hash,
        from_address,
        to_address,
        lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
        outcome_index
      FROM default.erc1155_transfers
      WHERE length(replaceAll(condition_id, '0x', '')) = 64
    ) erc
      ON tda.tx_hash = erc.tx_hash
      AND (
        tda.wallet_address = erc.from_address
        OR tda.wallet_address = erc.to_address
      )

    -- Join to cashflows for pre-computed amounts
    LEFT JOIN (
      SELECT
        wallet,
        lower(replaceAll(condition_id_norm, '0x', '')) as condition_id_norm,
        outcome_idx,
        cashflow_usdc
      FROM default.trade_cashflows_v3
      WHERE length(replaceAll(condition_id_norm, '0x', '')) = 64
    ) cf
      ON tda.wallet_address = cf.wallet
      AND lower(replaceAll(tda.condition_id_norm, '0x', '')) = cf.condition_id_norm

    WHERE length(replaceAll(tda.condition_id_norm, '0x', '')) = 64
  `;

  await ch.command({ query: createFactTableQuery });
  console.log('✅ Fact table created (took ~2-4 hours)\n');

  // Step 2: Validate row count
  console.log('Step 2: Validating row count...');

  const countResult = await ch.query({
    query: 'SELECT count() as count FROM default.fact_trades_staging',
    format: 'JSONEachRow'
  });

  const rows = await countResult.json<Array<{ count: string }>>();
  const rowCount = parseInt(rows[0].count);

  console.log(`  Total trades: ${rowCount.toLocaleString()}`);

  if (rowCount < 100_000_000) {
    throw new Error(`Expected ~130M trades, got ${rowCount}. Check source data.`);
  }

  // Step 3: Check data quality
  console.log('\nStep 3: Checking data quality...');

  const qualityResult = await ch.query({
    query: `
      SELECT
        count() as total_trades,
        countIf(has_market_context) as with_market_context,
        countIf(has_cashflow_data) as with_cashflow,
        countIf(direction = 'BUY') as buys,
        countIf(direction = 'SELL') as sells,
        countIf(direction = 'UNKNOWN') as unknown_direction,
        countIf(confidence = 'HIGH') as high_confidence,
        countIf(source = 'erc1155+erc20') as erc1155_mapped,
        countIf(source = 'erc20_only') as erc20_only,
        countIf(source = 'unmapped') as unmapped,
        avg(price) as avg_price
      FROM default.fact_trades_staging
    `,
    format: 'JSONEachRow'
  });

  const quality = await qualityResult.json<Array<any>>();
  const q = quality[0];

  const total = parseInt(q.total_trades);
  console.log(`  Total trades: ${total.toLocaleString()}`);
  console.log(`  With market context: ${parseInt(q.with_market_context).toLocaleString()} (${(parseInt(q.with_market_context)/total*100).toFixed(1)}%)`);
  console.log(`  With cashflow data: ${parseInt(q.with_cashflow).toLocaleString()} (${(parseInt(q.with_cashflow)/total*100).toFixed(1)}%)`);
  console.log('\n  Direction breakdown:');
  console.log(`    BUY: ${parseInt(q.buys).toLocaleString()} (${(parseInt(q.buys)/total*100).toFixed(1)}%)`);
  console.log(`    SELL: ${parseInt(q.sells).toLocaleString()} (${(parseInt(q.sells)/total*100).toFixed(1)}%)`);
  console.log(`    UNKNOWN: ${parseInt(q.unknown_direction).toLocaleString()} (${(parseInt(q.unknown_direction)/total*100).toFixed(1)}%)`);
  console.log(`    HIGH confidence: ${parseInt(q.high_confidence).toLocaleString()} (${(parseInt(q.high_confidence)/total*100).toFixed(1)}%)`);
  console.log('\n  Data sources:');
  console.log(`    ERC1155 + ERC20: ${parseInt(q.erc1155_mapped).toLocaleString()} (${(parseInt(q.erc1155_mapped)/total*100).toFixed(1)}%)`);
  console.log(`    ERC20 only: ${parseInt(q.erc20_only).toLocaleString()} (${(parseInt(q.erc20_only)/total*100).toFixed(1)}%)`);
  console.log(`    Unmapped: ${parseInt(q.unmapped).toLocaleString()} (${(parseInt(q.unmapped)/total*100).toFixed(1)}%)`);
  console.log(`\n  Avg trade price: $${parseFloat(q.avg_price).toFixed(2)}`);

  // Validate coverage
  const marketContextPct = (parseInt(q.with_market_context)/total*100);
  if (marketContextPct < 90) {
    console.warn(`\n⚠️  WARNING: Only ${marketContextPct.toFixed(1)}% of trades have market context`);
    console.warn('   Expected: >96% after ERC1155 backfill');
    console.warn('   ERC1155 backfill may be incomplete\n');
  }

  // Step 4: Test wallet validation
  console.log('\nStep 4: Testing wallet 0x4ce73141...');

  const testWalletResult = await ch.query({
    query: `
      SELECT
        count() as trade_count,
        countIf(has_market_context) as with_context,
        min(timestamp) as first_trade,
        max(timestamp) as last_trade
      FROM default.fact_trades_staging
      WHERE wallet_address = '0x4ce73141dbfce41e65db3723e31059a730f0abad'
    `,
    format: 'JSONEachRow'
  });

  const testWallet = await testWalletResult.json<Array<any>>();
  const tw = testWallet[0];

  console.log(`  Trade count: ${parseInt(tw.trade_count).toLocaleString()}`);
  console.log(`  With market context: ${parseInt(tw.with_context).toLocaleString()}`);
  console.log(`  First trade: ${tw.first_trade}`);
  console.log(`  Last trade: ${tw.last_trade}`);

  if (parseInt(tw.trade_count) < 2000) {
    console.warn(`\n⚠️  WARNING: Expected ~2,816 trades for this wallet`);
    console.warn(`   Got: ${parseInt(tw.trade_count).toLocaleString()}`);
    console.warn('   This suggests ERC1155 backfill is still incomplete\n');
  } else {
    console.log('  ✅ Test wallet coverage looks good!');
  }

  // Step 5: Atomic swap
  console.log('\nStep 5: Performing atomic swap...');

  // Drop old backup if exists
  await ch.command({ query: 'DROP TABLE IF EXISTS default.fact_trades_old' });

  // Rename current fact_trades to old (if exists)
  try {
    await ch.command({
      query: 'RENAME TABLE default.fact_trades TO default.fact_trades_old'
    });
    console.log('  Backed up existing fact_trades');
  } catch (e) {
    console.log('  No existing fact_trades to backup');
  }

  // Rename staging to final
  await ch.command({
    query: 'RENAME TABLE default.fact_trades_staging TO default.fact_trades'
  });
  console.log('  Promoted staging to fact_trades');

  // Step 6: Sample validation
  console.log('\nStep 6: Sample validation...');

  const sampleResult = await ch.query({
    query: `
      SELECT
        trade_id,
        wallet_address,
        substring(condition_id_norm, 1, 12) as condition_preview,
        direction,
        confidence,
        shares_net,
        cashflow_usdc_net,
        price,
        has_market_context,
        source
      FROM default.fact_trades
      WHERE has_market_context = 1
      ORDER BY rand()
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const samples = await sampleResult.json<Array<any>>();

  console.log('\n  Sample trades:');
  samples.forEach((s, i) => {
    console.log(`\n  ${i + 1}. Trade: ${s.trade_id.substring(0, 16)}...`);
    console.log(`     Wallet: ${s.wallet_address.substring(0, 10)}...`);
    console.log(`     Market: ${s.condition_preview}...`);
    console.log(`     Direction: ${s.direction} (${s.confidence} confidence)`);
    console.log(`     Shares: ${parseFloat(s.shares_net).toFixed(2)}`);
    console.log(`     USD: $${parseFloat(s.cashflow_usdc_net).toFixed(2)}`);
    console.log(`     Price: $${parseFloat(s.price).toFixed(4)}`);
    console.log(`     Source: ${s.source}`);
  });

  console.log('\n✅ fact_trades built successfully!');
  console.log(`   Total trades: ${rowCount.toLocaleString()}`);
  console.log(`   Market context: ${marketContextPct.toFixed(1)}%`);
  console.log(`   Table: default.fact_trades`);
  console.log(`   Old backup: default.fact_trades_old (can be dropped)\n`);

  await ch.close();
}

main().catch(console.error);
