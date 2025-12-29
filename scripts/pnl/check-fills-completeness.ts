/**
 * Check Fills Completeness
 *
 * For a given wallet, determines if fills-only PnL is valid by comparing:
 * - Net tokens per position from CLOB (pm_trader_events_v2)
 * - Ground truth net tokens from ledger (pm_unified_ledger_v9)
 *
 * If the differences are near zero, fills_complete = true and fills-only PnL is valid.
 * If there are large differences, fills_complete = false and we need other data sources.
 *
 * Usage:
 *   npx tsx scripts/pnl/check-fills-completeness.ts
 *   npx tsx scripts/pnl/check-fills-completeness.ts --wallet 0x1234...
 */

import { clickhouse } from '../../lib/clickhouse/client';

// Test wallets with known UI PnL
const TEST_WALLETS = [
  { address: '0x56bf1a64a14601aff2de20bb01045aed8da6c45a', name: 'JustDoIt' },
  { address: '0xf1302aafc43aa3a69bcd8058fc7a0259dac246ab', name: 'TraderRed' },
  { address: '0xeef3b6bd2297a469a9c2f05c2e62ea24f93dcfea', name: 'ImJustKen' },
];

interface FillsCompletenessResult {
  wallet: string;
  name: string;
  fillsComplete: boolean;
  totalPositions: number;
  badPositions: number;
  worstTokenDiff: number;
  clobOnlyTokens: number;
  ledgerTokens: number;
  netDifference: number;
  reason?: string;
}

async function checkWalletFillsCompleteness(
  wallet: string,
  name: string
): Promise<FillsCompletenessResult> {
  const walletLower = wallet.toLowerCase();

  // Step 1: Get net tokens per token_id from CLOB (deduplicated)
  const clobQuery = `
    SELECT
      token_id,
      sum(if(side = 'BUY' OR side = 'buy', tokens, -tokens)) as net_tokens
    FROM (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(token_amount) / 1e6 as tokens
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = '${walletLower}'
        AND is_deleted = 0
      GROUP BY event_id
    )
    GROUP BY token_id
  `;

  const clobResult = await clickhouse.query({ query: clobQuery, format: 'JSONEachRow' });
  const clobRows: any[] = await clobResult.json();

  // Build CLOB token map
  const clobTokens = new Map<string, number>();
  let totalClobTokens = 0;
  for (const row of clobRows) {
    const net = Number(row.net_tokens);
    clobTokens.set(row.token_id, net);
    totalClobTokens += net;
  }

  // Step 2: Get net tokens from ledger (ground truth)
  // Using pm_unified_ledger_v9 which includes CLOB + CTF events
  const ledgerQuery = `
    SELECT
      canonical_condition_id,
      outcome_index,
      sum(token_delta) as net_tokens
    FROM pm_unified_ledger_v9
    WHERE lower(wallet_address) = '${walletLower}'
      AND canonical_condition_id IS NOT NULL
      AND canonical_condition_id != ''
    GROUP BY canonical_condition_id, outcome_index
  `;

  const ledgerResult = await clickhouse.query({ query: ledgerQuery, format: 'JSONEachRow' });
  const ledgerRows: any[] = await ledgerResult.json();

  let totalLedgerTokens = 0;
  for (const row of ledgerRows) {
    totalLedgerTokens += Number(row.net_tokens);
  }

  // Step 3: Get token mapping to compare CLOB token_id with ledger condition_id
  const tokenIds = [...clobTokens.keys()];
  if (tokenIds.length === 0) {
    return {
      wallet,
      name,
      fillsComplete: false,
      totalPositions: 0,
      badPositions: 0,
      worstTokenDiff: 0,
      clobOnlyTokens: 0,
      ledgerTokens: totalLedgerTokens,
      netDifference: totalLedgerTokens,
      reason: 'No CLOB trades found',
    };
  }

  const tokenIdList = tokenIds.map((t) => "'" + t + "'").join(',');
  const mappingQuery = `
    SELECT token_id_dec, condition_id, outcome_index
    FROM pm_token_to_condition_map_v4
    WHERE token_id_dec IN (${tokenIdList})
  `;

  const mappingResult = await clickhouse.query({ query: mappingQuery, format: 'JSONEachRow' });
  const mappingRows: any[] = await mappingResult.json();

  // Build token -> condition map
  const tokenToCondition = new Map<string, { conditionId: string; outcomeIndex: number }>();
  for (const row of mappingRows) {
    tokenToCondition.set(row.token_id_dec, {
      conditionId: row.condition_id,
      outcomeIndex: Number(row.outcome_index),
    });
  }

  // Build ledger position map
  const ledgerPositions = new Map<string, number>();
  for (const row of ledgerRows) {
    const key = row.canonical_condition_id + ':' + row.outcome_index;
    ledgerPositions.set(key, Number(row.net_tokens));
  }

  // Step 4: Compare CLOB vs Ledger per position
  let badPositions = 0;
  let worstDiff = 0;
  const TOLERANCE = 1; // 1 token tolerance

  for (const [tokenId, clobNet] of clobTokens) {
    const condInfo = tokenToCondition.get(tokenId);
    if (!condInfo) {
      // No mapping - can't compare, count as bad if significant
      if (Math.abs(clobNet) > TOLERANCE) {
        badPositions++;
        worstDiff = Math.max(worstDiff, Math.abs(clobNet));
      }
      continue;
    }

    const key = condInfo.conditionId + ':' + condInfo.outcomeIndex;
    const ledgerNet = ledgerPositions.get(key) || 0;
    const diff = Math.abs(clobNet - ledgerNet);

    if (diff > TOLERANCE) {
      badPositions++;
      worstDiff = Math.max(worstDiff, diff);
    }
  }

  // Also check for ledger positions not in CLOB
  const clobConditions = new Set<string>();
  for (const [tokenId] of clobTokens) {
    const condInfo = tokenToCondition.get(tokenId);
    if (condInfo) {
      clobConditions.add(condInfo.conditionId + ':' + condInfo.outcomeIndex);
    }
  }

  for (const [key, ledgerNet] of ledgerPositions) {
    if (!clobConditions.has(key) && Math.abs(ledgerNet) > TOLERANCE) {
      // Position in ledger but not in CLOB
      badPositions++;
      worstDiff = Math.max(worstDiff, Math.abs(ledgerNet));
    }
  }

  const totalPositions = Math.max(clobTokens.size, ledgerPositions.size);
  const netDifference = totalClobTokens - totalLedgerTokens;
  const fillsComplete = badPositions === 0 && Math.abs(netDifference) < 100;

  return {
    wallet,
    name,
    fillsComplete,
    totalPositions,
    badPositions,
    worstTokenDiff: worstDiff,
    clobOnlyTokens: totalClobTokens,
    ledgerTokens: totalLedgerTokens,
    netDifference,
    reason: fillsComplete ? undefined : `${badPositions} positions with mismatched token counts`,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const walletIdx = args.indexOf('--wallet');

  console.log('═'.repeat(70));
  console.log('FILLS COMPLETENESS CHECKER');
  console.log('═'.repeat(70));
  console.log('\nDetermines if fills-only PnL is valid for each wallet.\n');

  const results: FillsCompletenessResult[] = [];

  if (walletIdx !== -1 && args[walletIdx + 1]) {
    // Single wallet mode
    const wallet = args[walletIdx + 1];
    const result = await checkWalletFillsCompleteness(wallet, 'Single Wallet');
    results.push(result);
  } else {
    // Test all wallets
    for (const w of TEST_WALLETS) {
      console.log(`Checking ${w.name}...`);
      const result = await checkWalletFillsCompleteness(w.address, w.name);
      results.push(result);
    }
  }

  // Print results table
  console.log('\n' + '─'.repeat(70));
  console.log('RESULTS');
  console.log('─'.repeat(70));
  console.log('');
  console.log(
    'Wallet'.padEnd(15) +
      ' | ' +
      'Complete'.padEnd(8) +
      ' | ' +
      'Bad Pos'.padStart(7) +
      ' | ' +
      'Worst Diff'.padStart(10) +
      ' | ' +
      'Net Diff'.padStart(12)
  );
  console.log('-'.repeat(70));

  for (const r of results) {
    console.log(
      r.name.padEnd(15) +
        ' | ' +
        (r.fillsComplete ? 'YES ✓' : 'NO ✗').padEnd(8) +
        ' | ' +
        String(r.badPositions).padStart(7) +
        ' | ' +
        r.worstTokenDiff.toFixed(0).padStart(10) +
        ' | ' +
        r.netDifference.toFixed(0).padStart(12)
    );
  }

  console.log('-'.repeat(70));

  // Detailed breakdown for failures
  console.log('\nDETAILS:');
  for (const r of results) {
    console.log(`\n${r.name} (${r.wallet.slice(0, 10)}...):`);
    console.log(`  Status: ${r.fillsComplete ? 'FILLS-ONLY PnL IS VALID' : 'FILLS-ONLY PnL NOT VALID'}`);
    console.log(`  Total positions: ${r.totalPositions}`);
    console.log(`  CLOB net tokens: ${r.clobOnlyTokens.toFixed(0)}`);
    console.log(`  Ledger net tokens: ${r.ledgerTokens.toFixed(0)}`);
    console.log(`  Net difference: ${r.netDifference.toFixed(0)}`);
    if (r.reason) {
      console.log(`  Reason: ${r.reason}`);
    }
  }

  // Summary
  const completeCount = results.filter((r) => r.fillsComplete).length;
  console.log('\n' + '═'.repeat(70));
  console.log(`SUMMARY: ${completeCount}/${results.length} wallets have complete fills data`);
  console.log('═'.repeat(70));

  if (completeCount < results.length) {
    console.log(`
For wallets with incomplete fills:
- Tokens were acquired outside CLOB (transfers, minting, etc.)
- Fills-only PnL will be inaccurate
- Use V17 or ledger-based PnL for these wallets
`);
  }
}

// Export the function for use by other scripts
export { checkWalletFillsCompleteness, FillsCompletenessResult };

// Only run main if this is the entry point
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Error:', err);
      process.exit(1);
    });
}
