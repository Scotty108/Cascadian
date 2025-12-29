/**
 * Validate V7 PnL with Corrected TX Hash Deduplication (Session 10 Fix)
 *
 * This script tests the corrected deduplication pattern using tx_hash extraction
 * instead of event_id to eliminate maker/taker double-counting.
 *
 * Key Finding (Session 10):
 * - pm_trader_events_v2 has maker/taker entries for same TX
 * - event_id is unique (e.g., 0x45e...._12345678-m vs 0x45e...._12345678-t)
 * - GROUP BY event_id still double-counts maker/taker
 * - Must GROUP BY tx_hash (substring before first underscore) to get unique trades
 */

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: 'Lbr.jYtw5ikf3',
  database: 'default',
  request_timeout: 600000
});

const W1 = '0x9d36c904930a7d06c5403f9e16996e919f586486';

async function fetchAPIClosedPositions(wallet: string): Promise<any[]> {
  const url = `https://data-api.polymarket.com/closed-positions?user=${wallet}`;
  console.log('Fetching API:', url);
  const response = await fetch(url);
  return response.json();
}

async function main() {
  console.log('=== V7 PnL VALIDATION WITH TX HASH DEDUPLICATION ===');
  console.log('Session 10 Fix: Using tx_hash instead of event_id for deduplication');
  console.log('');
  console.log(`Wallet: ${W1}`);
  console.log('');

  // First, demonstrate the difference in deduplication approaches
  console.log('=== STEP 1: DEDUPLICATION COMPARISON ===');
  console.log('');

  // Raw count
  const rawResult = await client.query({
    query: `
      SELECT count() as cnt
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = '${W1}'
        AND is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  const rawCount = (await rawResult.json() as any[])[0].cnt;
  console.log(`Raw rows: ${Number(rawCount).toLocaleString()}`);

  // Unique by event_id (OLD approach - still double-counts maker/taker)
  const eventIdResult = await client.query({
    query: `
      SELECT count() as cnt
      FROM (
        SELECT event_id
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = '${W1}'
          AND is_deleted = 0
        GROUP BY event_id
      )
    `,
    format: 'JSONEachRow'
  });
  const eventIdCount = (await eventIdResult.json() as any[])[0].cnt;
  console.log(`Unique by event_id: ${Number(eventIdCount).toLocaleString()} (OLD - double-counts maker/taker)`);

  // Unique by tx_hash (NEW approach - correct)
  const txHashResult = await client.query({
    query: `
      SELECT count() as cnt
      FROM (
        SELECT
          substring(event_id, 1, position(event_id, '_') - 1) AS tx_hash,
          lower(trader_wallet) AS wallet,
          token_id
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = '${W1}'
          AND is_deleted = 0
        GROUP BY tx_hash, wallet, token_id
      )
    `,
    format: 'JSONEachRow'
  });
  const txHashCount = (await txHashResult.json() as any[])[0].cnt;
  console.log(`Unique by tx_hash: ${Number(txHashCount).toLocaleString()} (NEW - correct)`);
  console.log('');
  console.log(`Reduction: ${rawCount} → ${eventIdCount} → ${txHashCount} (${((1 - txHashCount/rawCount) * 100).toFixed(1)}% removed)`);
  console.log('');

  // Now compute PnL using the corrected approach
  console.log('=== STEP 2: CLOB PnL WITH TX HASH DEDUP ===');
  console.log('');

  const clobPnlResult = await client.query({
    query: `
      WITH
      -- First filter to wallet, then dedupe by tx_hash (Session 10 fix)
      wallet_trades AS (
        SELECT
          substring(event_id, 1, position(event_id, '_') - 1) AS tx_hash,
          lower(trader_wallet) AS wallet,
          token_id,
          side,
          usdc_amount / 1000000.0 AS usdc,
          token_amount / 1000000.0 AS tokens
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = '${W1}'
          AND is_deleted = 0
      ),
      clob_deduped AS (
        SELECT
          tx_hash,
          wallet AS trader_wallet,
          token_id,
          any(side) AS side,
          any(usdc) AS usdc,
          any(tokens) AS tokens
        FROM wallet_trades
        GROUP BY tx_hash, wallet, token_id
      ),

      -- Aggregate to token level
      wallet_token_flows AS (
        SELECT
          trader_wallet AS wallet,
          token_id,
          SUM(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) AS net_cash_usdc,
          SUM(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) AS final_net_tokens
        FROM clob_deduped
        GROUP BY trader_wallet, token_id
      ),

      -- Map to conditions
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

      -- Join resolutions
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

      -- Calculate payout price
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
        wallet,
        SUM(net_cash_usdc) AS total_net_cash,
        SUM(final_net_tokens) AS total_net_tokens,
        SUM(CASE
          WHEN is_resolved
          THEN net_cash_usdc + (final_net_tokens * payout_price)
          ELSE 0
        END) AS realized_pnl_clob,
        countIf(is_resolved = 1) AS resolved_outcomes,
        countIf(is_resolved = 0) AS unresolved_outcomes
      FROM with_payout
      GROUP BY wallet
    `,
    format: 'JSONEachRow'
  });

  const clobData = (await clobPnlResult.json() as any[])[0];
  if (clobData) {
    console.log('CLOB PnL (tx_hash dedup):');
    console.log(`  Total net cash: $${Number(clobData.total_net_cash).toFixed(2)}`);
    console.log(`  Total net tokens: ${Number(clobData.total_net_tokens).toFixed(2)}`);
    console.log(`  Realized PnL (CLOB): $${Number(clobData.realized_pnl_clob).toFixed(2)}`);
    console.log(`  Resolved outcomes: ${clobData.resolved_outcomes}`);
    console.log(`  Unresolved outcomes: ${clobData.unresolved_outcomes}`);
  }
  console.log('');

  // Add CTF adjustments
  console.log('=== STEP 3: CTF USDC FLOWS ===');
  console.log('');

  const ctfResult = await client.query({
    query: `
      SELECT
        SUM(CASE WHEN flow_type = 'ctf_payout' THEN amount_usdc ELSE 0 END) AS ctf_payouts,
        SUM(CASE WHEN flow_type = 'ctf_deposit' THEN amount_usdc ELSE 0 END) AS ctf_deposits
      FROM pm_erc20_usdc_flows
      WHERE (
        (flow_type = 'ctf_payout' AND lower(to_address) = '${W1}')
        OR (flow_type = 'ctf_deposit' AND lower(from_address) = '${W1}')
      )
      AND amount_usdc > 0
      AND amount_usdc < 1000000000
    `,
    format: 'JSONEachRow'
  });

  const ctfData = (await ctfResult.json() as any[])[0];
  const ctfPayouts = Number(ctfData?.ctf_payouts || 0);
  const ctfDeposits = Number(ctfData?.ctf_deposits || 0);

  console.log('CTF USDC Flows:');
  console.log(`  Payouts (CTF → User): $${ctfPayouts.toFixed(2)}`);
  console.log(`  Deposits (User → CTF): $${ctfDeposits.toFixed(2)}`);
  console.log(`  Net CTF: $${(ctfPayouts - ctfDeposits).toFixed(2)}`);
  console.log('');

  // Calculate V7 PnL
  const clobPnl = Number(clobData?.realized_pnl_clob || 0);
  const v7Pnl = clobPnl + ctfPayouts - ctfDeposits;

  console.log('=== STEP 4: V7 UNIFIED PnL ===');
  console.log('');
  console.log('Formula: V7 PnL = CLOB PnL + CTF Payouts - CTF Deposits');
  console.log(`V7 PnL = $${clobPnl.toFixed(2)} + $${ctfPayouts.toFixed(2)} - $${ctfDeposits.toFixed(2)}`);
  console.log(`V7 PnL = $${v7Pnl.toFixed(2)}`);
  console.log('');

  // Fetch API data for comparison
  console.log('=== STEP 5: API COMPARISON ===');
  console.log('');

  try {
    const apiPositions = await fetchAPIClosedPositions(W1);
    const apiTotalPnl = apiPositions.reduce((sum: number, p: any) =>
      sum + Number(p.realizedPnl || 0), 0);

    console.log(`API closed positions: ${apiPositions.length}`);
    console.log(`API total realizedPnl: $${apiTotalPnl.toFixed(2)}`);
    console.log('');

    const variance = v7Pnl - apiTotalPnl;
    const variancePct = Math.abs(variance / apiTotalPnl * 100);

    console.log('=== FINAL COMPARISON ===');
    console.log('');
    console.log(`Our V7 PnL (tx_hash dedup): $${v7Pnl.toFixed(2)}`);
    console.log(`API realizedPnl:            $${apiTotalPnl.toFixed(2)}`);
    console.log(`Variance:                   $${variance.toFixed(2)} (${variancePct.toFixed(2)}%)`);
    console.log('');

    if (Math.abs(variance) < 100) {
      console.log('✅ VALIDATION PASSED - Within $100 tolerance');
    } else if (Math.abs(variance) < 1000) {
      console.log('⚠️ VALIDATION CLOSE - Within $1000, investigate remaining gap');
    } else {
      console.log('❌ VALIDATION FAILED - Significant variance, further investigation needed');
    }

    // Show top 5 positions by PnL from API for debugging
    console.log('');
    console.log('Top 5 API positions by |realizedPnl|:');
    const sortedPositions = apiPositions
      .sort((a: any, b: any) => Math.abs(Number(b.realizedPnl)) - Math.abs(Number(a.realizedPnl)))
      .slice(0, 5);

    for (const pos of sortedPositions) {
      const condId = pos.conditionId?.substring(0, 20) || 'N/A';
      console.log(`  ${condId}... | PnL: $${Number(pos.realizedPnl).toFixed(2)} | Bought: ${Number(pos.totalBought).toFixed(2)} @ $${Number(pos.avgPrice).toFixed(4)}`);
    }

  } catch (e) {
    console.log('Could not fetch API data:', (e as Error).message);
  }

  await client.close();
}

main().catch(console.error);
