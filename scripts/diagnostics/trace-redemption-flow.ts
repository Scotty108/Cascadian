/**
 * Trace CTF redemption flow through CCR-v1 engine
 *
 * This script simulates the CCR-v1 computation step-by-step to find
 * where the $131K gap is coming from.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const LATINA_WALLET = '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae';

interface CTFEvent {
  event_type: string;
  condition_id: string;
  amount: number;
  event_timestamp: string;
  block_number: number;
  tx_hash: string;
}

interface TokenMapping {
  condition_id: string;
  token_id_0: string;
  token_id_1: string;
}

interface Resolution {
  token_id: string;
  payout: number;
  is_resolved: boolean;
}

async function main() {
  console.log('='.repeat(80));
  console.log('TRACING CTF REDEMPTION FLOW');
  console.log('='.repeat(80));

  // Step 1: Load CTF events
  const ctfQuery = `
    SELECT
      event_type,
      condition_id,
      toFloat64OrZero(amount_or_payout) / 1e6 as amount,
      event_timestamp,
      block_number,
      tx_hash
    FROM pm_ctf_events
    WHERE lower(user_address) = lower('${LATINA_WALLET}')
      AND is_deleted = 0
    ORDER BY block_number
  `;

  const ctfResult = await clickhouse.query({ query: ctfQuery, format: 'JSONEachRow' });
  const ctfEvents = await ctfResult.json() as CTFEvent[];

  console.log(`\n1. CTF Events loaded: ${ctfEvents.length}`);

  // Step 2: Get condition->token mappings
  const conditionIds = [...new Set(ctfEvents.map(e => e.condition_id.toLowerCase()))];
  const conditionList = conditionIds.map(c => `'${c}'`).join(',');

  const mapQuery = `
    SELECT
      lower(condition_id) as condition_id,
      token_id_dec,
      outcome_index
    FROM pm_token_to_condition_map_v5
    WHERE lower(condition_id) IN (${conditionList})
  `;

  const mapResult = await clickhouse.query({ query: mapQuery, format: 'JSONEachRow' });
  const mapRows = await mapResult.json() as any[];

  const conditionToTokens = new Map<string, TokenMapping>();
  const rawMap = new Map<string, { t0?: string; t1?: string }>();
  for (const row of mapRows) {
    const entry = rawMap.get(row.condition_id) || {};
    if (row.outcome_index === 0) entry.t0 = row.token_id_dec;
    else if (row.outcome_index === 1) entry.t1 = row.token_id_dec;
    rawMap.set(row.condition_id, entry);
  }

  for (const [cid, tokens] of rawMap) {
    if (tokens.t0 && tokens.t1) {
      conditionToTokens.set(cid, {
        condition_id: cid,
        token_id_0: tokens.t0,
        token_id_1: tokens.t1,
      });
    }
  }

  console.log(`\n2. Condition->Token mappings: ${conditionToTokens.size}`);

  // Step 3: Get all token IDs and load resolutions
  const allTokenIds = new Set<string>();
  for (const [, mapping] of conditionToTokens) {
    allTokenIds.add(mapping.token_id_0);
    allTokenIds.add(mapping.token_id_1);
  }

  const tokenList = [...allTokenIds].map(t => `'${t}'`).join(',');
  const resQuery = `
    SELECT
      m.token_id_dec as token_id,
      r.payout_numerators,
      m.outcome_index
    FROM pm_token_to_condition_map_v5 m
    LEFT JOIN pm_condition_resolutions r ON lower(m.condition_id) = lower(r.condition_id)
    WHERE m.token_id_dec IN (${tokenList})
  `;

  const resResult = await clickhouse.query({ query: resQuery, format: 'JSONEachRow' });
  const resRows = await resResult.json() as any[];

  const resolutions = new Map<string, Resolution>();
  for (const row of resRows) {
    let payout = 0.5;
    let isResolved = false;

    if (row.payout_numerators) {
      try {
        const payouts = JSON.parse(row.payout_numerators.replace(/'/g, '"'));
        const outcomeIndex = Number(row.outcome_index);
        const payoutDenominator = payouts.reduce((a: number, b: number) => a + b, 0);
        payout = payoutDenominator > 0 ? payouts[outcomeIndex] / payoutDenominator : 0;
        isResolved = true;
      } catch {}
    }

    resolutions.set(row.token_id, { token_id: row.token_id, payout, is_resolved: isResolved });
  }

  console.log(`\n3. Token resolutions loaded: ${resolutions.size}`);

  // Step 4: Process redemption events (as CCR-v1 would)
  console.log('\n' + '─'.repeat(80));
  console.log('4. Processing PayoutRedemption events:');
  console.log('─'.repeat(80));

  let totalRedemptionValue = 0;
  let totalRedemptionTokens = 0;

  for (const ctfEvent of ctfEvents) {
    if (ctfEvent.event_type !== 'PayoutRedemption') continue;

    const tokens = conditionToTokens.get(ctfEvent.condition_id.toLowerCase());
    if (!tokens) {
      console.log(`   SKIP: No mapping for condition ${ctfEvent.condition_id.slice(0, 16)}...`);
      continue;
    }

    const payout0 = resolutions.get(tokens.token_id_0)?.payout ?? 0.5;
    const payout1 = resolutions.get(tokens.token_id_1)?.payout ?? 0.5;
    const isResolved0 = resolutions.get(tokens.token_id_0)?.is_resolved ?? false;
    const isResolved1 = resolutions.get(tokens.token_id_1)?.is_resolved ?? false;

    console.log(`\n   Condition: ...${ctfEvent.condition_id.slice(-16)}`);
    console.log(`   Amount: ${ctfEvent.amount.toLocaleString()} tokens`);
    console.log(`   Token0: payout=${payout0.toFixed(2)}, resolved=${isResolved0}`);
    console.log(`   Token1: payout=${payout1.toFixed(2)}, resolved=${isResolved1}`);

    // CCR-v1 adds redemption sells for outcomes with payout > 0
    if (payout0 > 0) {
      const value = ctfEvent.amount * payout0;
      console.log(`   → Redemption0: ${ctfEvent.amount.toLocaleString()} × $${payout0.toFixed(2)} = $${value.toLocaleString()}`);
      totalRedemptionValue += value;
      totalRedemptionTokens += ctfEvent.amount;
    }
    if (payout1 > 0) {
      const value = ctfEvent.amount * payout1;
      console.log(`   → Redemption1: ${ctfEvent.amount.toLocaleString()} × $${payout1.toFixed(2)} = $${value.toLocaleString()}`);
      totalRedemptionValue += value;
      totalRedemptionTokens += ctfEvent.amount;
    }
  }

  console.log('\n' + '─'.repeat(80));
  console.log('5. Summary:');
  console.log('─'.repeat(80));
  console.log(`   Total redemption tokens processed: ${totalRedemptionTokens.toLocaleString()}`);
  console.log(`   Total redemption value (at payout price): $${totalRedemptionValue.toLocaleString()}`);

  // Step 5: Compare with CLOB buy-side to estimate profit
  // If avg buy price was $0.50, then profit = value - (tokens * 0.50)
  const assumedAvgCost = 0.50;
  const estimatedCost = totalRedemptionTokens * assumedAvgCost;
  const estimatedProfit = totalRedemptionValue - estimatedCost;

  console.log(`\n   If avg buy price was $${assumedAvgCost.toFixed(2)}:`);
  console.log(`   → Estimated cost: $${estimatedCost.toLocaleString()}`);
  console.log(`   → Estimated profit from redemptions: $${estimatedProfit.toLocaleString()}`);

  // Step 6: Check if the $131K gap matches
  const gap = 131241;
  const matchPct = (estimatedProfit / gap * 100).toFixed(0);
  console.log(`\n   PnL Gap: $${gap.toLocaleString()}`);
  console.log(`   Does estimated profit explain gap? ${matchPct}%`);

  // Step 7: Check what CLOB trades exist for these condition tokens
  console.log('\n' + '─'.repeat(80));
  console.log('6. CLOB trades for redemption conditions:');
  console.log('─'.repeat(80));

  for (const [cid, tokens] of conditionToTokens) {
    const tradeQuery = `
      SELECT
        token_id,
        side,
        count() as cnt,
        sum(usdc_amount) / 1e6 as total_usdc,
        sum(token_amount) / 1e6 as total_tokens
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${LATINA_WALLET}')
        AND is_deleted = 0
        AND role = 'maker'
        AND token_id IN ('${tokens.token_id_0}', '${tokens.token_id_1}')
      GROUP BY token_id, side
    `;

    const tradeResult = await clickhouse.query({ query: tradeQuery, format: 'JSONEachRow' });
    const trades = await tradeResult.json() as any[];

    if (trades.length > 0) {
      console.log(`\n   Condition: ...${cid.slice(-16)}`);
      for (const t of trades) {
        const isToken0 = t.token_id === tokens.token_id_0;
        const label = isToken0 ? 'Token0' : 'Token1';
        console.log(`   ${label} ${t.side}: ${t.cnt} trades, ${Number(t.total_tokens).toLocaleString()} tokens, $${Number(t.total_usdc).toLocaleString()}`);
      }
    }
  }

  console.log('\n' + '='.repeat(80));
}

main().catch(console.error);
