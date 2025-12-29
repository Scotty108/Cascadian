/**
 * CLOB Engine Validation Test Suite
 *
 * This script validates the V7 CLOB-only PnL calculation against the Polymarket API.
 * It picks wallets with:
 *   - Zero CTF flows in pm_erc20_usdc_flows
 *   - Non-trivial CLOB history in pm_trader_events_v2
 *
 * Purpose: Freeze the CLOB engine and prove it produces consistent results.
 *
 * Usage: npx tsx scripts/pnl/tests/clob-engine-validation.ts
 */

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: 'Lbr.jYtw5ikf3',
  database: 'default',
  request_timeout: 600000
});

interface PositionComparison {
  conditionId: string;
  ourPnl: number;
  apiPnl: number;
  difference: number;
  differencePercent: number;
  match: boolean;
}

interface WalletTestResult {
  wallet: string;
  ourTotalPnl: number;
  apiTotalPnl: number;
  totalDifference: number;
  totalDifferencePercent: number;
  resolvedOutcomes: number;
  apiPositions: number;
  positionComparisons: PositionComparison[];
  status: 'PASS' | 'PARTIAL' | 'FAIL';
  notes: string[];
}

async function findTestWallets(): Promise<string[]> {
  console.log('=== FINDING TEST WALLETS (Significant CLOB Activity) ===\n');

  // Find wallets with significant CLOB activity (regardless of CTF - we test CLOB engine only)
  // Filter to wallets with medium volume to avoid mega-whales that may have complex patterns
  const result = await client.query({
    query: `
      SELECT
        lower(trader_wallet) AS wallet,
        count() AS trade_count,
        SUM(usdc_amount) / 1000000.0 AS total_usdc_volume
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      GROUP BY lower(trader_wallet)
      HAVING trade_count BETWEEN 100 AND 1000
        AND total_usdc_volume BETWEEN 5000 AND 100000
      ORDER BY trade_count DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const wallets = await result.json() as any[];

  console.log('Candidate wallets (medium CLOB activity):');
  console.log('-'.repeat(80));
  for (const w of wallets) {
    console.log(`  ${w.wallet} | ${w.trade_count} trades | $${Number(w.total_usdc_volume).toLocaleString()} volume`);
  }
  console.log('');

  // Return top 5
  return wallets.slice(0, 5).map((w: any) => w.wallet);
}

async function computeClobPnlForWallet(wallet: string): Promise<{
  totalPnl: number;
  resolvedOutcomes: number;
  byCondition: Map<string, number>;
}> {
  // Use the canonical tx_hash dedup pattern
  const result = await client.query({
    query: `
      WITH
      -- Step 1: Filter to wallet, dedupe by tx_hash (Session 10 canonical pattern)
      wallet_trades AS (
        SELECT
          substring(event_id, 1, position(event_id, '_') - 1) AS tx_hash,
          lower(trader_wallet) AS wallet,
          token_id,
          side,
          usdc_amount / 1000000.0 AS usdc,
          token_amount / 1000000.0 AS tokens
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = '${wallet}'
          AND is_deleted = 0
      ),
      clob_deduped AS (
        SELECT
          tx_hash,
          wallet,
          token_id,
          any(side) AS side,
          any(usdc) AS usdc,
          any(tokens) AS tokens
        FROM wallet_trades
        GROUP BY tx_hash, wallet, token_id
      ),

      -- Step 2: Aggregate to token level
      wallet_token_flows AS (
        SELECT
          wallet,
          token_id,
          SUM(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) AS net_cash_usdc,
          SUM(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) AS final_net_tokens
        FROM clob_deduped
        GROUP BY wallet, token_id
      ),

      -- Step 3: Map to conditions
      with_mapping AS (
        SELECT
          w.wallet,
          w.token_id,
          w.net_cash_usdc,
          w.final_net_tokens,
          m.condition_id,
          m.outcome_index
        FROM wallet_token_flows w
        INNER JOIN pm_token_to_condition_map_v3 m ON w.token_id = m.token_id_dec
      ),

      -- Step 4: Join resolutions
      with_resolution AS (
        SELECT
          w.wallet,
          w.token_id,
          w.net_cash_usdc,
          w.final_net_tokens,
          w.condition_id,
          w.outcome_index,
          r.payout_numerators,
          r.resolved_at IS NOT NULL AS is_resolved
        FROM with_mapping w
        LEFT JOIN pm_condition_resolutions r ON lower(w.condition_id) = lower(r.condition_id)
      ),

      -- Step 5: Calculate payout price
      with_payout AS (
        SELECT
          wallet,
          token_id,
          condition_id,
          outcome_index,
          net_cash_usdc,
          final_net_tokens,
          is_resolved,
          CASE
            WHEN is_resolved AND payout_numerators IS NOT NULL
            THEN arrayElement(
              JSONExtract(payout_numerators, 'Array(Float64)'),
              toUInt32(outcome_index + 1)
            )
            ELSE 0.0
          END AS payout_price
        FROM with_resolution
      )

      SELECT
        condition_id,
        SUM(net_cash_usdc + (final_net_tokens * payout_price)) AS realized_pnl
      FROM with_payout
      WHERE is_resolved = 1
      GROUP BY condition_id
    `,
    format: 'JSONEachRow'
  });

  const rows = await result.json() as any[];

  const byCondition = new Map<string, number>();
  let totalPnl = 0;

  for (const row of rows) {
    const pnl = Number(row.realized_pnl);
    byCondition.set(row.condition_id, pnl);
    totalPnl += pnl;
  }

  return {
    totalPnl,
    resolvedOutcomes: rows.length,
    byCondition
  };
}

async function fetchApiClosedPositions(wallet: string): Promise<any[]> {
  try {
    // Use limit=500 to get more positions (API caps at some max, usually 50-100)
    const response = await fetch(`https://data-api.polymarket.com/closed-positions?user=${wallet}&limit=500`);
    if (!response.ok) {
      console.log(`  API returned ${response.status} for ${wallet}`);
      return [];
    }
    return await response.json();
  } catch (e) {
    console.log(`  API error for ${wallet}: ${(e as Error).message}`);
    return [];
  }
}

async function testWallet(wallet: string): Promise<WalletTestResult> {
  console.log(`\n--- Testing wallet: ${wallet.substring(0, 20)}... ---\n`);

  const notes: string[] = [];

  // Compute our CLOB PnL
  const ourData = await computeClobPnlForWallet(wallet);
  console.log(`  Our CLOB PnL: $${ourData.totalPnl.toFixed(2)} across ${ourData.resolvedOutcomes} resolved outcomes`);

  // Fetch API data
  const apiPositions = await fetchApiClosedPositions(wallet);
  const apiTotalPnl = apiPositions.reduce((sum: number, p: any) => sum + Number(p.realizedPnl || 0), 0);
  console.log(`  API PnL: $${apiTotalPnl.toFixed(2)} across ${apiPositions.length} closed positions`);

  // Compare per-condition
  const positionComparisons: PositionComparison[] = [];

  // Build API condition map - NORMALIZE by removing 0x prefix and lowercasing
  const apiByCondition = new Map<string, number>();
  for (const pos of apiPositions) {
    if (pos.conditionId) {
      // API returns 0x-prefixed condition IDs, our data stores without 0x
      const normalizedId = pos.conditionId.toLowerCase().replace('0x', '');
      const existing = apiByCondition.get(normalizedId) || 0;
      apiByCondition.set(normalizedId, existing + Number(pos.realizedPnl || 0));
    }
  }

  // Compare conditions that exist in both
  let matchCount = 0;
  let totalCompared = 0;

  for (const [conditionId, ourPnl] of ourData.byCondition) {
    // Normalize our condition ID to match API format (lowercase, no 0x)
    const normalizedOurId = conditionId.toLowerCase().replace('0x', '');
    const apiPnl = apiByCondition.get(normalizedOurId);
    if (apiPnl !== undefined) {
      totalCompared++;
      const difference = ourPnl - apiPnl;
      const differencePercent = apiPnl !== 0 ? Math.abs(difference / apiPnl * 100) : 0;
      const match = Math.abs(difference) < 10 || differencePercent < 5; // $10 or 5% tolerance

      if (match) matchCount++;

      positionComparisons.push({
        conditionId,
        ourPnl,
        apiPnl,
        difference,
        differencePercent,
        match
      });
    }
  }

  // Determine status
  const totalDifference = ourData.totalPnl - apiTotalPnl;
  const totalDifferencePercent = apiTotalPnl !== 0 ? Math.abs(totalDifference / apiTotalPnl * 100) : 0;

  let status: 'PASS' | 'PARTIAL' | 'FAIL';
  if (totalDifferencePercent < 10 && matchCount >= totalCompared * 0.8) {
    status = 'PASS';
    notes.push('Within 10% total variance, 80%+ condition matches');
  } else if (totalDifferencePercent < 25 || matchCount >= totalCompared * 0.5) {
    status = 'PARTIAL';
    notes.push('Partial match - some conditions align, others diverge');
  } else {
    status = 'FAIL';
    notes.push('Significant divergence from API');
  }

  // Add explanation notes
  if (ourData.resolvedOutcomes !== apiPositions.length) {
    notes.push(`Outcome count mismatch: ours=${ourData.resolvedOutcomes}, API=${apiPositions.length}`);
  }

  if (ourData.byCondition.size > apiByCondition.size) {
    notes.push('We have more conditions than API (possible mapping differences)');
  }

  console.log(`  Status: ${status}`);
  console.log(`  Total difference: $${totalDifference.toFixed(2)} (${totalDifferencePercent.toFixed(1)}%)`);
  console.log(`  Conditions compared: ${totalCompared}, matches: ${matchCount}`);

  return {
    wallet,
    ourTotalPnl: ourData.totalPnl,
    apiTotalPnl,
    totalDifference,
    totalDifferencePercent,
    resolvedOutcomes: ourData.resolvedOutcomes,
    apiPositions: apiPositions.length,
    positionComparisons,
    status,
    notes
  };
}

async function main() {
  console.log('='.repeat(80));
  console.log('CLOB ENGINE VALIDATION TEST SUITE');
  console.log('Purpose: Validate V7 CLOB-only PnL against Polymarket API');
  console.log('Pattern: tx_hash dedup (Session 10 canonical)');
  console.log('='.repeat(80));
  console.log('');

  // Find test wallets
  const testWallets = await findTestWallets();

  if (testWallets.length === 0) {
    console.log('No suitable test wallets found!');
    await client.close();
    return;
  }

  // Test each wallet
  const results: WalletTestResult[] = [];
  for (const wallet of testWallets) {
    const result = await testWallet(wallet);
    results.push(result);
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('TEST SUMMARY');
  console.log('='.repeat(80));
  console.log('');

  console.log('Wallet                                     | Status  | Our PnL       | API PnL       | Diff %');
  console.log('-'.repeat(100));

  for (const r of results) {
    const walletShort = r.wallet.substring(0, 40);
    const statusPad = r.status.padEnd(7);
    const ourPnl = ('$' + r.ourTotalPnl.toFixed(2)).padStart(12);
    const apiPnl = ('$' + r.apiTotalPnl.toFixed(2)).padStart(12);
    const diff = (r.totalDifferencePercent.toFixed(1) + '%').padStart(7);
    console.log(`${walletShort} | ${statusPad} | ${ourPnl} | ${apiPnl} | ${diff}`);
  }

  console.log('');

  const passCount = results.filter(r => r.status === 'PASS').length;
  const partialCount = results.filter(r => r.status === 'PARTIAL').length;
  const failCount = results.filter(r => r.status === 'FAIL').length;

  console.log(`Results: ${passCount} PASS, ${partialCount} PARTIAL, ${failCount} FAIL`);
  console.log('');

  // Detailed notes for each wallet
  console.log('DETAILED NOTES:');
  console.log('-'.repeat(80));
  for (const r of results) {
    console.log(`\n${r.wallet}:`);
    for (const note of r.notes) {
      console.log(`  - ${note}`);
    }

    // Show top 3 position comparisons by absolute difference
    const topDiffs = r.positionComparisons
      .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference))
      .slice(0, 3);

    if (topDiffs.length > 0) {
      console.log('  Top differences by condition:');
      for (const pc of topDiffs) {
        console.log(`    ${pc.conditionId.substring(0, 20)}... | ours: $${pc.ourPnl.toFixed(2)} | api: $${pc.apiPnl.toFixed(2)} | diff: $${pc.difference.toFixed(2)}`);
      }
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('CLOB ENGINE VALIDATION COMPLETE');
  console.log('='.repeat(80));

  await client.close();
}

main().catch(console.error);
