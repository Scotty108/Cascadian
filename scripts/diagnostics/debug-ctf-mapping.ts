/**
 * Debug CTF event mapping for @Latina
 *
 * Checks if CTF redemptions are being skipped due to missing condition->token mappings
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const LATINA_WALLET = '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae';

async function main() {
  console.log('='.repeat(80));
  console.log('CTF MAPPING DIAGNOSTIC FOR @LATINA');
  console.log('='.repeat(80));

  // Step 1: Get all CTF events for @Latina
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
  const ctfEvents = await ctfResult.json() as any[];

  console.log(`\n1. Total CTF events for @Latina: ${ctfEvents.length}`);

  // Group by event type
  const byType: Record<string, number> = {};
  const byTypeTokens: Record<string, number> = {};
  for (const e of ctfEvents) {
    byType[e.event_type] = (byType[e.event_type] || 0) + 1;
    byTypeTokens[e.event_type] = (byTypeTokens[e.event_type] || 0) + e.amount;
  }
  console.log('\n   By event type:');
  for (const [type, count] of Object.entries(byType)) {
    console.log(`   - ${type}: ${count} events, ${byTypeTokens[type]?.toLocaleString()} tokens`);
  }

  // Step 2: Get unique condition_ids from CTF events
  const conditionIds = [...new Set(ctfEvents.map(e => e.condition_id.toLowerCase()))];
  console.log(`\n2. Unique conditions from CTF events: ${conditionIds.length}`);

  // Step 3: Check which conditions have token mappings
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

  // Group by condition_id
  const conditionMap = new Map<string, { has_0: boolean; has_1: boolean }>();
  for (const row of mapRows) {
    const entry = conditionMap.get(row.condition_id) || { has_0: false, has_1: false };
    if (row.outcome_index === 0) entry.has_0 = true;
    else if (row.outcome_index === 1) entry.has_1 = true;
    conditionMap.set(row.condition_id, entry);
  }

  // Count fully mapped vs partial
  let fullyMapped = 0;
  let partialMapped = 0;
  let notMapped = 0;
  const missingConditions: string[] = [];

  for (const cid of conditionIds) {
    const entry = conditionMap.get(cid);
    if (!entry) {
      notMapped++;
      missingConditions.push(cid);
    } else if (entry.has_0 && entry.has_1) {
      fullyMapped++;
    } else {
      partialMapped++;
      missingConditions.push(cid);
    }
  }

  console.log(`\n3. Condition mapping status:`);
  console.log(`   - Fully mapped (both outcomes): ${fullyMapped}`);
  console.log(`   - Partially mapped: ${partialMapped}`);
  console.log(`   - Not mapped at all: ${notMapped}`);
  console.log(`   - Total skipped: ${partialMapped + notMapped} (${((partialMapped + notMapped) / conditionIds.length * 100).toFixed(1)}%)`);

  // Step 4: Calculate how many redemption tokens would be skipped
  let skippedRedemptionTokens = 0;
  let skippedRedemptionCount = 0;
  const redemptionEvents = ctfEvents.filter(e => e.event_type === 'PayoutRedemption');

  for (const e of redemptionEvents) {
    const cid = e.condition_id.toLowerCase();
    const entry = conditionMap.get(cid);
    if (!entry || !entry.has_0 || !entry.has_1) {
      skippedRedemptionTokens += e.amount;
      skippedRedemptionCount++;
    }
  }

  console.log(`\n4. PayoutRedemption impact:`);
  console.log(`   - Total redemption events: ${redemptionEvents.length}`);
  console.log(`   - Would be SKIPPED (no mapping): ${skippedRedemptionCount}`);
  console.log(`   - Skipped redemption tokens: ${skippedRedemptionTokens.toLocaleString()}`);

  if (redemptionEvents.length > 0) {
    const skipPct = (skippedRedemptionCount / redemptionEvents.length * 100).toFixed(1);
    console.log(`   - Skip rate: ${skipPct}%`);
  }

  // Step 5: Check resolution status for missing conditions
  if (missingConditions.length > 0 && missingConditions.length <= 10) {
    console.log(`\n5. Sample missing conditions:`);
    for (const cid of missingConditions.slice(0, 5)) {
      console.log(`   - ${cid}`);
    }
  }

  // Step 6: Check how many CLOB trades have condition mappings
  const clobQuery = `
    SELECT
      count() as total_trades,
      countIf(m.condition_id IS NOT NULL) as mapped_trades
    FROM (
      SELECT DISTINCT event_id, token_id
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${LATINA_WALLET}')
        AND is_deleted = 0
        AND role = 'maker'
    ) t
    LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
  `;

  const clobResult = await clickhouse.query({ query: clobQuery, format: 'JSONEachRow' });
  const clobStats = await clobResult.json() as any[];

  console.log(`\n6. CLOB trade mapping:`);
  if (clobStats[0]) {
    const total = Number(clobStats[0].total_trades);
    const mapped = Number(clobStats[0].mapped_trades);
    console.log(`   - Total trades: ${total}`);
    console.log(`   - With condition mapping: ${mapped}`);
    console.log(`   - Coverage: ${(mapped / total * 100).toFixed(1)}%`);
  }

  // Step 7: Compare expected vs actual PnL
  const expectedPnl = 543043; // UI value
  const actualPnl = 411802; // CCR-v1 current value
  const gap = expectedPnl - actualPnl;
  const gapPct = (gap / expectedPnl * 100).toFixed(1);

  console.log(`\n7. PnL Gap Analysis:`);
  console.log(`   - UI (expected): $${expectedPnl.toLocaleString()}`);
  console.log(`   - CCR-v1 (actual): $${actualPnl.toLocaleString()}`);
  console.log(`   - Gap: $${gap.toLocaleString()} (${gapPct}%)`);

  // If all redemptions were skipped at $1 avg price
  if (skippedRedemptionTokens > 0) {
    // Estimate: if avg cost basis is ~$0.50, skipped redemption PnL = tokens * (1.0 - 0.5) = tokens * 0.5
    const estimatedMissingPnl = skippedRedemptionTokens * 0.5;
    console.log(`   - Est. missing PnL from skipped redemptions: $${estimatedMissingPnl.toLocaleString()}`);
    console.log(`   - Explains gap: ${(estimatedMissingPnl / gap * 100).toFixed(0)}%`);
  }

  console.log('\n' + '='.repeat(80));
}

main().catch(console.error);
