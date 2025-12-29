/**
 * Debug held value discrepancy between CLOB API and greedy optimization
 *
 * CLOB API: $139.82 (4 winners, 16 losers)
 * Greedy:   $413.82 (7 winners, 13 losers)
 * Gap:      $274
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';
import { ClobClient } from '@polymarket/clob-client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== DEBUG HELD VALUE DISCREPANCY ===\n');

  const client = new ClobClient('https://clob.polymarket.com', 137);

  // Get all held positions (positive net)
  const posQ = `
    SELECT
      token_id,
      sum(if(side = 'buy', token_amount, -token_amount)) / 1e6 as net_position
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    GROUP BY token_id
    HAVING net_position > 0
    ORDER BY net_position DESC
  `;
  const posR = await clickhouse.query({ query: posQ, format: 'JSONEachRow' });
  const heldPositions = (await posR.json()) as { token_id: string; net_position: string }[];

  console.log(`Held positions: ${heldPositions.length}\n`);

  // Get condition_ids
  const condQ = `
    WITH wallet_txs AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    )
    SELECT DISTINCT condition_id
    FROM pm_ctf_events
    WHERE tx_hash IN (SELECT tx_hash FROM wallet_txs)
      AND event_type = 'PositionSplit'
      AND is_deleted = 0
  `;
  const condR = await clickhouse.query({ query: condQ, format: 'JSONEachRow' });
  const conditions = (await condR.json()) as { condition_id: string }[];

  // Fetch ALL token metadata
  const tokenInfo = new Map<
    string,
    { condition_id: string; outcome: string; winner: boolean | null; price: number }
  >();

  for (const { condition_id } of conditions) {
    try {
      const formattedCondId = condition_id.startsWith('0x') ? condition_id : `0x${condition_id}`;
      const market = await client.getMarket(formattedCondId);
      if (market && market.tokens) {
        for (const t of market.tokens) {
          tokenInfo.set(t.token_id, {
            condition_id,
            outcome: t.outcome,
            winner: t.winner ?? null,
            price: parseFloat(t.price || '0'),
          });
        }
      }
    } catch {
      // Skip
    }
  }

  // Analyze each held position
  console.log('=== HELD POSITION ANALYSIS ===\n');
  console.log('Token ID (first 30)             | Position | Outcome | Winner | Value');
  console.log('-'.repeat(80));

  let totalHeldValue = 0;
  let winnerCount = 0;
  let loserCount = 0;

  for (const p of heldPositions) {
    const pos = parseFloat(p.net_position);
    const info = tokenInfo.get(p.token_id);

    if (info) {
      const value = info.winner === true ? pos : 0;
      totalHeldValue += value;
      if (info.winner === true) winnerCount++;
      else loserCount++;

      console.log(
        `${p.token_id.slice(0, 30)}... | ${pos.toFixed(2).padStart(8)} | ${info.outcome.padEnd(7)} | ${String(info.winner).padEnd(6)} | $${value.toFixed(2)}`
      );
    } else {
      console.log(`${p.token_id.slice(0, 30)}... | ${pos.toFixed(2).padStart(8)} | ???     | ???    | ???`);
    }
  }

  console.log('-'.repeat(80));
  console.log(`TOTAL HELD VALUE: $${totalHeldValue.toFixed(2)}`);
  console.log(`Winners: ${winnerCount}, Losers: ${loserCount}`);

  // Check redemptions
  console.log('\n=== REDEMPTION ANALYSIS ===\n');
  const redQ = `
    SELECT
      condition_id,
      sum(toFloat64OrZero(amount_or_payout)) / 1e6 as payout
    FROM pm_ctf_events
    WHERE lower(user_address) = '${WALLET}'
      AND event_type = 'PayoutRedemption'
      AND is_deleted = 0
    GROUP BY condition_id
    ORDER BY payout DESC
  `;
  const redR = await clickhouse.query({ query: redQ, format: 'JSONEachRow' });
  const redemptions = (await redR.json()) as { condition_id: string; payout: string }[];

  console.log(`Redemption conditions: ${redemptions.length}`);
  let totalRedemptions = 0;
  for (const r of redemptions.slice(0, 10)) {
    console.log(`  ${r.condition_id.slice(0, 20)}... $${parseFloat(r.payout).toFixed(2)}`);
    totalRedemptions += parseFloat(r.payout);
  }
  console.log(`  ... Total: $${totalRedemptions.toFixed(2)}`);

  // Check if any held positions overlap with redeemed conditions
  console.log('\n=== OVERLAP CHECK ===');
  const heldConditions = new Set<string>();
  for (const p of heldPositions) {
    const info = tokenInfo.get(p.token_id);
    if (info) heldConditions.add(info.condition_id);
  }

  const redeemedConditions = new Set(redemptions.map((r) => r.condition_id));
  const overlap = [...heldConditions].filter((c) => redeemedConditions.has(c));
  console.log(`Held conditions: ${heldConditions.size}`);
  console.log(`Redeemed conditions: ${redeemedConditions.size}`);
  console.log(`Overlap: ${overlap.length}`);

  // The key question: where does the extra $274 come from?
  console.log('\n=== DISCREPANCY ANALYSIS ===');
  const expectedHeld = 413.82;
  const actualHeld = totalHeldValue;
  console.log(`Expected held value (from ground truth): $${expectedHeld.toFixed(2)}`);
  console.log(`Actual held value (from CLOB API):       $${actualHeld.toFixed(2)}`);
  console.log(`Discrepancy:                             $${(expectedHeld - actualHeld).toFixed(2)}`);

  // Calculate what the P&L would be with different held values
  const sells = 3848.35;
  const reds = 358.54;
  const buys = 1214.14;
  const splits = 3493.23;

  console.log('\n=== P&L BREAKDOWN ===');
  console.log(`Sells:       $${sells.toFixed(2)}`);
  console.log(`Redemptions: $${reds.toFixed(2)}`);
  console.log(`Buys:        $${buys.toFixed(2)}`);
  console.log(`Splits:      $${splits.toFixed(2)}`);
  console.log(`---`);
  console.log(`P&L before held: $${(sells + reds - buys - splits).toFixed(2)}`);
  console.log(`With CLOB held:  $${(sells + reds - buys - splits + actualHeld).toFixed(2)}`);
  console.log(`Ground truth:    $-86.66`);
  console.log(`Required held:   $${(-86.66 - (sells + reds - buys - splits)).toFixed(2)}`);
}

main().catch(console.error);
