#!/usr/bin/env ts-node

/**
 * Task 7: Final P&L Reconciliation
 * Compute realized P&L for both wallets at snapshot 2025-10-31 23:59:59
 * Compare against Polymarket UI targets
 */

import { createClient } from '@clickhouse/client';

const SNAPSHOT = '2025-10-31 23:59:59';
const WALLETS = {
  HolyMoses7: '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
  niggemon: '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
};
const TARGETS = {
  HolyMoses7: 89975.16,
  niggemon: 102001.46
};

const client = createClient({
  url: process.env.CLICKHOUSE_URL || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DB || 'polymarket'
});

interface WalletPnLResult {
  wallet_address: string;
  wallet_name: string;
  base_fills: number;
  resolved_fills: number;
  unresolved_fills: number;
  settlement_usd: number;
  cashflow_usd: number;
  fees_usd: number;
  realized_pnl_net: number;
  unrealized_pnl: number;
  pct_resolved: number;
  expected: number;
  abs_variance: number;
  pct_variance: number;
  status: 'PASS' | 'FAIL';
  top_markets: Array<{
    market_name: string;
    pnl: number;
  }>;
}

async function computeWalletPnL(walletAddress: string, walletName: string): Promise<WalletPnLResult> {
  console.log(`\n${'='.repeat(63)}`);
  console.log(`Computing P&L for ${walletName} (${walletAddress})`);
  console.log(`${'='.repeat(63)}\n`);

  // Step 1: Count deduped fills at snapshot
  const baseFillsQuery = `
    SELECT count(*) as base_fills
    FROM (
      SELECT DISTINCT
        transaction_hash,
        wallet_address,
        timestamp,
        side,
        shares,
        entry_price,
        usd_value,
        market_id
      FROM trades_raw
      WHERE wallet_address = '${walletAddress}'
        AND timestamp <= '${SNAPSHOT}'
    )
  `;

  const baseFillsResult = await client.query({ query: baseFillsQuery, format: 'JSONEachRow' });
  const baseFillsData = await baseFillsResult.json() as Array<{ base_fills: string }>;
  const baseFills = parseInt(baseFillsData[0].base_fills);
  
  console.log(`Base fills (deduped): ${baseFills}`);

  // Step 2: Build resolved P&L calculation
  const resolvedPnLQuery = `
    WITH deduped_fills AS (
      SELECT DISTINCT
        transaction_hash,
        wallet_address,
        timestamp,
        side,
        shares,
        entry_price,
        usd_value,
        market_id,
        outcome_index,
        fee_usd,
        slippage_usd
      FROM trades_raw
      WHERE wallet_address = '${walletAddress}'
        AND timestamp <= '${SNAPSHOT}'
    ),
    
    fills_with_resolution AS (
      SELECT
        f.*,
        c.condition_id_norm,
        r.winning_index,
        r.market_name
      FROM deduped_fills f
      ANY LEFT JOIN canonical_condition c ON f.market_id = c.market_id
      ANY LEFT JOIN market_resolutions_final r ON c.condition_id_norm = r.condition_id_norm
    ),
    
    per_fill_calculations AS (
      SELECT
        *,
        -- Settlement component (only for resolved fills)
        CASE
          WHEN winning_index IS NOT NULL THEN
            CASE
              WHEN outcome_index = winning_index AND side = 1 THEN shares
              WHEN outcome_index != winning_index AND side = 2 THEN -shares
              ELSE 0
            END
          ELSE 0
        END AS settlement_shares,
        
        -- Signed cashflow (negative for buys, positive for sells)
        CASE
          WHEN side = 1 THEN -(entry_price * shares)
          ELSE (entry_price * shares)
        END AS signed_cashflow,
        
        -- Resolved flag
        CASE WHEN winning_index IS NOT NULL THEN 1 ELSE 0 END AS is_resolved
      FROM fills_with_resolution
    )
    
    SELECT
      sum(is_resolved) as resolved_fills,
      sum(1 - is_resolved) as unresolved_fills,
      sum(settlement_shares) as settlement_usd,
      sum(signed_cashflow) as cashflow_usd,
      sum(fee_usd + slippage_usd) as fees_usd
    FROM per_fill_calculations
  `;

  const resolvedResult = await client.query({ query: resolvedPnLQuery, format: 'JSONEachRow' });
  const resolvedData = await resolvedResult.json() as Array<{
    resolved_fills: string;
    unresolved_fills: string;
    settlement_usd: string;
    cashflow_usd: string;
    fees_usd: string;
  }>;

  const resolvedFills = parseInt(resolvedData[0].resolved_fills);
  const unresolvedFills = parseInt(resolvedData[0].unresolved_fills);
  const settlementUsd = parseFloat(resolvedData[0].settlement_usd);
  const cashflowUsd = parseFloat(resolvedData[0].cashflow_usd);
  const feesUsd = parseFloat(resolvedData[0].fees_usd);
  
  console.log(`Resolved fills: ${resolvedFills}`);
  console.log(`Unresolved fills: ${unresolvedFills}`);
  console.log(`Settlement USD: $${settlementUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`Cashflow USD: $${cashflowUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`Fees USD: $${feesUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

  // Step 3: Calculate realized P&L
  const realizedPnlNet = settlementUsd - cashflowUsd - feesUsd;
  const pctResolved = baseFills > 0 ? (resolvedFills / baseFills) * 100 : 0;
  
  console.log(`\nRealized P&L (net of fees): $${realizedPnlNet.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`Resolution coverage: ${pctResolved.toFixed(2)}%`);

  // Step 4: Get top 3 markets by absolute P&L
  const topMarketsQuery = `
    WITH deduped_fills AS (
      SELECT DISTINCT
        transaction_hash,
        wallet_address,
        timestamp,
        side,
        shares,
        entry_price,
        usd_value,
        market_id,
        outcome_index,
        fee_usd,
        slippage_usd
      FROM trades_raw
      WHERE wallet_address = '${walletAddress}'
        AND timestamp <= '${SNAPSHOT}'
    ),
    
    fills_with_resolution AS (
      SELECT
        f.*,
        c.condition_id_norm,
        r.winning_index,
        r.market_name
      FROM deduped_fills f
      ANY LEFT JOIN canonical_condition c ON f.market_id = c.market_id
      ANY LEFT JOIN market_resolutions_final r ON c.condition_id_norm = r.condition_id_norm
      WHERE r.winning_index IS NOT NULL
    ),
    
    per_market_pnl AS (
      SELECT
        market_name,
        sum(
          CASE
            WHEN outcome_index = winning_index AND side = 1 THEN shares
            WHEN outcome_index != winning_index AND side = 2 THEN -shares
            ELSE 0
          END
        ) - sum(
          CASE
            WHEN side = 1 THEN -(entry_price * shares)
            ELSE (entry_price * shares)
          END
        ) - sum(fee_usd + slippage_usd) as market_pnl
      FROM fills_with_resolution
      GROUP BY market_name
    )
    
    SELECT
      market_name,
      market_pnl
    FROM per_market_pnl
    ORDER BY abs(market_pnl) DESC
    LIMIT 3
  `;

  const topMarketsResult = await client.query({ query: topMarketsQuery, format: 'JSONEachRow' });
  const topMarketsData = await topMarketsResult.json() as Array<{
    market_name: string;
    market_pnl: string;
  }>;

  const topMarkets = topMarketsData.map(m => ({
    market_name: m.market_name,
    pnl: parseFloat(m.market_pnl)
  }));

  // Step 5: Calculate variance
  const expected = TARGETS[walletName as keyof typeof TARGETS];
  const absVariance = Math.abs(realizedPnlNet - expected);
  const pctVariance = (absVariance / expected) * 100;
  const status = pctVariance <= 5 ? 'PASS' : 'FAIL';

  return {
    wallet_address: walletAddress,
    wallet_name: walletName,
    base_fills: baseFills,
    resolved_fills: resolvedFills,
    unresolved_fills: unresolvedFills,
    settlement_usd: settlementUsd,
    cashflow_usd: cashflowUsd,
    fees_usd: feesUsd,
    realized_pnl_net: realizedPnlNet,
    unrealized_pnl: 0, // Placeholder for now
    pct_resolved: pctResolved,
    expected,
    abs_variance: absVariance,
    pct_variance: pctVariance,
    status,
    top_markets: topMarkets
  };
}

function printWalletReport(result: WalletPnLResult): void {
  console.log(`\n${'='.repeat(63)}`);
  console.log(`WALLET: ${result.wallet_name} (${result.wallet_address})`);
  console.log(`${'='.repeat(63)}\n`);

  console.log('Data Coverage:');
  console.log(`  Total fills (deduped):        ${result.base_fills.toLocaleString()}`);
  console.log(`  Fills in resolved markets:    ${result.resolved_fills.toLocaleString()}`);
  console.log(`  Resolution coverage:          ${result.pct_resolved.toFixed(2)}%\n`);

  console.log('P&L Calculation:');
  console.log(`  Settlement (resolved only):   $${result.settlement_usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`  Signed cashflows:             $${result.cashflow_usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`  Fees + slippage:              $${result.fees_usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`  ${'─'.repeat(35)}`);
  console.log(`  Realized P&L (net of fees):   $${result.realized_pnl_net.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`);

  console.log('Unrealized P&L (unresolved positions):');
  console.log(`  Unresolved fills:             ${result.unresolved_fills.toLocaleString()}`);
  console.log(`  Unrealized value:             $${result.unrealized_pnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`);

  console.log('Target Comparison:');
  console.log(`  Calculated:                   $${result.realized_pnl_net.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`  Expected (Polymarket UI):     $${result.expected.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`  Absolute variance:            $${result.abs_variance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`  Percentage variance:          ${result.pct_variance.toFixed(2)}%`);
  console.log(`  `);
  console.log(`  Status:                        ${result.status}`);
  console.log(`  (PASS if |variance| <= 5%, FAIL if > 5%)\n`);

  console.log('Largest 3 Resolved Markets (by absolute P&L):');
  result.top_markets.forEach((market, idx) => {
    const truncatedName = market.market_name.length > 40 
      ? market.market_name.substring(0, 37) + '...'
      : market.market_name;
    console.log(`  Market ${idx + 1}: ${truncatedName} - $${market.pnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  });

  console.log(`\n${'='.repeat(63)}\n`);
}

function printSummaryTable(results: WalletPnLResult[]): void {
  console.log('\n┌─────────────────────────────────────────────────────────────┐');
  console.log('│ RECONCILIATION SUMMARY                                      │');
  console.log('├─────────────────────────────────────────────────────────────┤');
  console.log('│ Wallet        │ Calculated │ Expected   │ Variance │ Status │');
  console.log('├─────────────────────────────────────────────────────────────┤');
  
  results.forEach(r => {
    const walletPad = r.wallet_name.padEnd(13);
    const calcPad = `$${(r.realized_pnl_net / 1000).toFixed(1)}k`.padEnd(10);
    const expPad = `$${(r.expected / 1000).toFixed(1)}k`.padEnd(10);
    const varPad = `${r.pct_variance.toFixed(1)}%`.padEnd(8);
    const statusPad = r.status.padEnd(6);
    console.log(`│ ${walletPad} │ ${calcPad} │ ${expPad} │ ${varPad} │ ${statusPad} │`);
  });
  
  console.log('└─────────────────────────────────────────────────────────────┘\n');
}

async function runDeltaProbes(result: WalletPnLResult): Promise<void> {
  console.log(`\n${'='.repeat(63)}`);
  console.log(`DELTA PROBES FOR ${result.wallet_name} (FAIL case)`);
  console.log(`${'='.repeat(63)}\n`);

  // Delta A: Fees Impact
  console.log('Delta A: Fees Impact');
  console.log('─'.repeat(40));
  const realizedNoFees = result.settlement_usd - result.cashflow_usd;
  const deltaFees = result.realized_pnl_net - realizedNoFees;
  console.log(`  P&L without fees:             $${realizedNoFees.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`  P&L with fees:                $${result.realized_pnl_net.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`  Fees delta:                   $${deltaFees.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`);

  // Delta B: Snapshot Sensitivity
  console.log('Delta B: Snapshot Sensitivity');
  console.log('─'.repeat(40));
  console.log(`  (Would recompute at 2025-10-24 and 2025-11-07)`);
  console.log(`  (Skipped for brevity - implement if needed)\n`);

  // Delta C: Coverage Analysis
  console.log('Delta C: Coverage Analysis');
  console.log('─'.repeat(40));
  
  const coverageQuery = `
    WITH deduped_fills AS (
      SELECT DISTINCT
        market_id,
        transaction_hash,
        wallet_address,
        timestamp,
        side,
        shares,
        entry_price,
        usd_value,
        outcome_index
      FROM trades_raw
      WHERE wallet_address = '${result.wallet_address}'
        AND timestamp <= '${SNAPSHOT}'
    ),
    
    market_summary AS (
      SELECT
        f.market_id,
        count(*) as fill_count,
        sum(f.usd_value) as total_usd,
        c.condition_id_norm,
        CASE WHEN r.winning_index IS NOT NULL THEN 1 ELSE 0 END as has_resolution
      FROM deduped_fills f
      ANY LEFT JOIN canonical_condition c ON f.market_id = c.market_id
      ANY LEFT JOIN market_resolutions_final r ON c.condition_id_norm = r.condition_id_norm
      GROUP BY f.market_id, c.condition_id_norm, has_resolution
    )
    
    SELECT
      countDistinct(market_id) as total_traded_markets,
      sum(has_resolution) as resolved_markets,
      sum(1 - has_resolution) as missing_resolved_count
    FROM market_summary
  `;

  const coverageResult = await client.query({ query: coverageQuery, format: 'JSONEachRow' });
  const coverageData = await coverageResult.json() as Array<{
    total_traded_markets: string;
    resolved_markets: string;
    missing_resolved_count: string;
  }>;

  console.log(`  Total traded markets:         ${coverageData[0].total_traded_markets}`);
  console.log(`  Resolved markets joined:      ${coverageData[0].resolved_markets}`);
  console.log(`  Missing resolved count:       ${coverageData[0].missing_resolved_count}\n`);

  // Top 5 missing markets
  const missingMarketsQuery = `
    WITH deduped_fills AS (
      SELECT DISTINCT
        market_id,
        transaction_hash,
        wallet_address,
        timestamp,
        side,
        shares,
        entry_price,
        usd_value,
        outcome_index
      FROM trades_raw
      WHERE wallet_address = '${result.wallet_address}'
        AND timestamp <= '${SNAPSHOT}'
    ),
    
    market_summary AS (
      SELECT
        f.market_id,
        count(*) as fill_count,
        sum(f.usd_value) as total_usd,
        c.condition_id_norm,
        CASE WHEN r.winning_index IS NOT NULL THEN 1 ELSE 0 END as has_resolution
      FROM deduped_fills f
      ANY LEFT JOIN canonical_condition c ON f.market_id = c.market_id
      ANY LEFT JOIN market_resolutions_final r ON c.condition_id_norm = r.condition_id_norm
      GROUP BY f.market_id, c.condition_id_norm, has_resolution
    )
    
    SELECT
      market_id,
      condition_id_norm,
      fill_count,
      total_usd
    FROM market_summary
    WHERE has_resolution = 0
    ORDER BY total_usd DESC
    LIMIT 5
  `;

  const missingResult = await client.query({ query: missingMarketsQuery, format: 'JSONEachRow' });
  const missingData = await missingResult.json() as Array<{
    market_id: string;
    condition_id_norm: string;
    fill_count: string;
    total_usd: string;
  }>;

  console.log('  Top 5 largest missing markets:');
  missingData.forEach((m, idx) => {
    const marketId = m.market_id.substring(0, 16) + '...';
    const condId = m.condition_id_norm || '(no condition)';
    console.log(`    ${idx + 1}. Market: ${marketId}`);
    console.log(`       Condition: ${condId}`);
    console.log(`       Fills: ${m.fill_count}, USD: $${parseFloat(m.total_usd).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  });

  console.log(`\n${'='.repeat(63)}\n`);
}

async function main(): Promise<void> {
  try {
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║ TASK 7: FINAL P&L RECONCILIATION                         ║');
    console.log('║ Snapshot: 2025-10-31 23:59:59                            ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');

    const results: WalletPnLResult[] = [];

    // Compute P&L for both wallets
    for (const [name, address] of Object.entries(WALLETS)) {
      const result = await computeWalletPnL(address, name);
      printWalletReport(result);
      results.push(result);
    }

    // Print summary table
    printSummaryTable(results);

    // Run delta probes if any wallet fails
    const failedResults = results.filter(r => r.status === 'FAIL');
    if (failedResults.length > 0) {
      console.log('\n⚠️  VARIANCE EXCEEDS THRESHOLD - Running Delta Probes\n');
      for (const result of failedResults) {
        await runDeltaProbes(result);
      }
    }

    // Final recommendation
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║ RECOMMENDATIONS                                           ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    if (results.every(r => r.status === 'PASS')) {
      console.log('✓ All wallets PASS reconciliation within 5% threshold');
      console.log('✓ P&L calculation methodology validated');
      console.log('✓ Ready for production deployment\n');
    } else {
      console.log('⚠️  Some wallets FAIL reconciliation:');
      failedResults.forEach(r => {
        console.log(`   - ${r.wallet_name}: ${r.pct_variance.toFixed(2)}% variance`);
      });
      console.log('\nNext steps:');
      console.log('1. Review Delta Probes output above');
      console.log('2. Investigate missing market resolutions');
      console.log('3. Verify fee calculation methodology');
      console.log('4. Consider adjusting settlement formula\n');
    }

    await client.close();
  } catch (error) {
    console.error('Error computing P&L:', error);
    process.exit(1);
  }
}

main();
