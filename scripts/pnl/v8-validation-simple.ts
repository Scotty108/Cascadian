/**
 * V8 PnL Validation - Simple Approach
 *
 * This script validates our V8 PnL calculations by:
 * 1. Querying CLOB PnL directly (simpler query, avoids view memory issues)
 * 2. Querying CTF flows directly (from vw_ctf_ledger_proxy)
 * 3. Comparing to Polymarket API
 *
 * Uses simpler queries to avoid ClickHouse Cloud memory constraints.
 */

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: 'Lbr.jYtw5ikf3',
  database: 'default',
  request_timeout: 300000
});

// Reference wallets for validation
const TEST_WALLETS = [
  '0x9d36c904930a7d06c5403f9e16996e919f586486', // W1 - known good CLOB-only wallet
  '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838', // W2
  '0x3cf3e8d5427aed066a7a5926980600f6c3cf87b3', // Has CTF activity
];

interface ValidationResult {
  wallet: string;
  clobPnl: number;
  ctfDeposits: number;
  ctfPayouts: number;
  ctfNetCash: number;
  v8Pnl: number;
  apiPnl: number;
  diff: number;
  pctDiff: number;
  status: string;
  resolvedOutcomes: number;
  apiPositions: number;
}

async function getClobPnlForWallet(wallet: string): Promise<{ pnl: number; outcomes: number }> {
  // Simpler CLOB PnL query that focuses on just one wallet
  // This avoids full table aggregation
  const query = `
    WITH
    -- Dedupe trades for this wallet
    deduped AS (
      SELECT
        event_id,
        any(token_id) AS token_id,
        any(side) AS side,
        any(usdc_amount) / 1000000.0 AS usdc,
        any(token_amount) / 1000000.0 AS tokens
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = '${wallet}'
        AND is_deleted = 0
      GROUP BY event_id
    ),

    -- Aggregate to token level
    token_flows AS (
      SELECT
        token_id,
        SUM(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) AS net_cash,
        SUM(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) AS net_tokens
      FROM deduped
      GROUP BY token_id
    ),

    -- Map to conditions and get resolutions
    with_resolution AS (
      SELECT
        t.token_id,
        t.net_cash,
        t.net_tokens,
        m.condition_id,
        m.outcome_index,
        r.payout_numerators,
        r.resolved_at IS NOT NULL AS is_resolved
      FROM token_flows t
      INNER JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
      LEFT JOIN pm_condition_resolutions r ON lower(m.condition_id) = lower(r.condition_id)
    ),

    -- Calculate PnL
    with_pnl AS (
      SELECT
        *,
        CASE
          WHEN is_resolved AND payout_numerators IS NOT NULL
          THEN arrayElement(JSONExtract(payout_numerators, 'Array(Float64)'), toUInt32(outcome_index + 1))
          ELSE 0.0
        END AS payout_price,
        CASE
          WHEN is_resolved
          THEN net_cash + (net_tokens * arrayElement(JSONExtract(payout_numerators, 'Array(Float64)'), toUInt32(outcome_index + 1)))
          ELSE NULL
        END AS realized_pnl
      FROM with_resolution
    )

    SELECT
      SUM(CASE WHEN is_resolved THEN realized_pnl ELSE 0 END) AS total_pnl,
      countIf(is_resolved = 1) AS resolved_outcomes
    FROM with_pnl
  `;

  try {
    const result = await client.query({ query, format: 'JSONEachRow' });
    const data = await result.json() as any[];
    if (data.length > 0) {
      return {
        pnl: Number(data[0].total_pnl) || 0,
        outcomes: Number(data[0].resolved_outcomes) || 0
      };
    }
  } catch (e) {
    console.error(`  Error getting CLOB PnL for ${wallet.substring(0, 10)}...:`, (e as Error).message);
  }
  return { pnl: 0, outcomes: 0 };
}

async function getCtfFlowsForWallet(wallet: string): Promise<{ deposits: number; payouts: number; netCash: number }> {
  // Query CTF flows for this specific wallet
  const query = `
    SELECT
      SUM(ctf_deposits) AS total_deposits,
      SUM(ctf_payouts) AS total_payouts,
      SUM(net_ctf_cash) AS net_cash
    FROM vw_ctf_ledger_proxy
    WHERE wallet = '${wallet}'
  `;

  try {
    const result = await client.query({ query, format: 'JSONEachRow' });
    const data = await result.json() as any[];
    if (data.length > 0) {
      return {
        deposits: Number(data[0].total_deposits) || 0,
        payouts: Number(data[0].total_payouts) || 0,
        netCash: Number(data[0].net_cash) || 0
      };
    }
  } catch (e) {
    console.error(`  Error getting CTF flows for ${wallet.substring(0, 10)}...:`, (e as Error).message);
  }
  return { deposits: 0, payouts: 0, netCash: 0 };
}

async function getApiPnl(wallet: string): Promise<{ pnl: number; positions: number }> {
  try {
    const response = await fetch(`https://data-api.polymarket.com/positions?user=${wallet}&sizeThreshold=0`);
    if (response.ok) {
      const data = await response.json() as any[];
      const pnl = data.reduce((sum: number, p: any) => sum + Number(p.realizedPnl || 0), 0);
      return { pnl, positions: data.length };
    }
  } catch (e) {
    console.error(`  Error fetching API for ${wallet.substring(0, 10)}...:`, (e as Error).message);
  }
  return { pnl: 0, positions: 0 };
}

async function main() {
  console.log('='.repeat(100));
  console.log('V8 PNL VALIDATION - SIMPLE APPROACH');
  console.log('='.repeat(100));
  console.log('');
  console.log('This uses simpler per-wallet queries to avoid ClickHouse Cloud memory limits.');
  console.log('');

  const results: ValidationResult[] = [];

  for (const wallet of TEST_WALLETS) {
    console.log(`Testing wallet: ${wallet.substring(0, 20)}...`);

    // Get CLOB PnL
    const clob = await getClobPnlForWallet(wallet);
    console.log(`  CLOB PnL: $${clob.pnl.toFixed(2)} (${clob.outcomes} resolved outcomes)`);

    // Get CTF flows
    const ctf = await getCtfFlowsForWallet(wallet);
    console.log(`  CTF: deposits=$${ctf.deposits.toFixed(2)}, payouts=$${ctf.payouts.toFixed(2)}, net=$${ctf.netCash.toFixed(2)}`);

    // Get API PnL
    const api = await getApiPnl(wallet);
    console.log(`  API PnL: $${api.pnl.toFixed(2)} (${api.positions} positions)`);

    // Calculate V8 PnL
    const v8Pnl = clob.pnl + ctf.netCash;
    console.log(`  V8 PnL: $${v8Pnl.toFixed(2)} (CLOB + CTF Net)`);

    // Compare
    const diff = Math.abs(v8Pnl - api.pnl);
    const pctDiff = api.pnl !== 0 ? Math.abs((v8Pnl - api.pnl) / api.pnl * 100) : (v8Pnl !== 0 ? 100 : 0);
    const status = pctDiff < 10 ? 'MATCH' : pctDiff < 50 ? 'PARTIAL' : 'DIVERGENT';
    console.log(`  Status: ${status} (${pctDiff.toFixed(1)}% diff)`);
    console.log('');

    results.push({
      wallet: wallet.substring(0, 14) + '...',
      clobPnl: clob.pnl,
      ctfDeposits: ctf.deposits,
      ctfPayouts: ctf.payouts,
      ctfNetCash: ctf.netCash,
      v8Pnl,
      apiPnl: api.pnl,
      diff,
      pctDiff,
      status,
      resolvedOutcomes: clob.outcomes,
      apiPositions: api.positions
    });
  }

  // Print summary table
  console.log('='.repeat(100));
  console.log('SUMMARY TABLE');
  console.log('='.repeat(100));
  console.log('');
  console.log('Wallet           | CLOB PnL    | CTF Net     | V8 PnL      | API PnL     | Diff        | Status');
  console.log('-'.repeat(100));

  for (const r of results) {
    console.log(
      r.wallet.padEnd(16) + ' | ' +
      ('$' + r.clobPnl.toFixed(2)).padStart(11) + ' | ' +
      ('$' + r.ctfNetCash.toFixed(2)).padStart(11) + ' | ' +
      ('$' + r.v8Pnl.toFixed(2)).padStart(11) + ' | ' +
      ('$' + r.apiPnl.toFixed(2)).padStart(11) + ' | ' +
      ('$' + r.diff.toFixed(2)).padStart(11) + ' | ' +
      r.status
    );
  }

  console.log('');
  console.log('DETAILED BREAKDOWN:');
  for (const r of results) {
    console.log('');
    console.log(`  ${r.wallet}`);
    console.log(`    CLOB PnL: $${r.clobPnl.toFixed(2)} (${r.resolvedOutcomes} resolved outcomes)`);
    console.log(`    CTF Deposits: $${r.ctfDeposits.toFixed(2)}`);
    console.log(`    CTF Payouts: $${r.ctfPayouts.toFixed(2)}`);
    console.log(`    CTF Net: $${r.ctfNetCash.toFixed(2)}`);
    console.log(`    V8 Total: $${r.v8Pnl.toFixed(2)} = CLOB($${r.clobPnl.toFixed(2)}) + CTF($${r.ctfNetCash.toFixed(2)})`);
    console.log(`    API PnL: $${r.apiPnl.toFixed(2)} (${r.apiPositions} positions)`);
    console.log(`    Status: ${r.status} (${r.pctDiff.toFixed(1)}% diff)`);
  }

  // Final summary
  console.log('');
  console.log('='.repeat(100));
  const matchCount = results.filter(r => r.status === 'MATCH').length;
  const partialCount = results.filter(r => r.status === 'PARTIAL').length;
  const divergentCount = results.filter(r => r.status === 'DIVERGENT').length;
  console.log('VALIDATION SUMMARY:');
  console.log(`  MATCH (<10% diff): ${matchCount}/${results.length}`);
  console.log(`  PARTIAL (10-50%): ${partialCount}/${results.length}`);
  console.log(`  DIVERGENT (>50%): ${divergentCount}/${results.length}`);
  console.log('');

  if (divergentCount > 0) {
    console.log('INVESTIGATION NEEDED:');
    console.log('  - Check outcome counting methodology (YES/NO aggregation)');
    console.log('  - Check resolution timing differences');
    console.log('  - CTF flows may include market maker activity');
    console.log('  - Multi-outcome markets may have different counting');
  }

  await client.close();
}

main().catch(console.error);
