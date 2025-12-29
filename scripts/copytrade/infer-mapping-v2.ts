/**
 * Infer token → outcome mapping from redemption data (v2)
 *
 * Key insight: redemption amount should equal position size for fully redeemed tokens.
 * Held value = winning positions MINUS what was already redeemed.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '@/lib/clickhouse/client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== INFER MAPPING v2 - TRACKING UNREDEEMED VALUE ===\n');

  // Step 1: Get token positions grouped by condition
  const posQ = `
    WITH wallet_txs AS (
      SELECT
        token_id,
        lower(concat('0x', hex(transaction_hash))) as tx_hash,
        side,
        token_amount / 1e6 as tokens
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    ),
    split_conditions AS (
      SELECT DISTINCT tx_hash, condition_id
      FROM pm_ctf_events
      WHERE tx_hash IN (SELECT DISTINCT tx_hash FROM wallet_txs)
        AND event_type = 'PositionSplit'
        AND is_deleted = 0
    )
    SELECT
      t.token_id,
      s.condition_id,
      sum(if(t.side = 'buy', t.tokens, -t.tokens)) as net
    FROM wallet_txs t
    JOIN split_conditions s ON t.tx_hash = s.tx_hash
    GROUP BY t.token_id, s.condition_id
  `;
  const posR = await clickhouse.query({ query: posQ, format: 'JSONEachRow' });
  const positions = await posR.json() as any[];

  // Group tokens by condition
  const conditionTokens = new Map<string, Array<{token_id: string, net: number}>>();
  for (const p of positions) {
    if (!conditionTokens.has(p.condition_id)) {
      conditionTokens.set(p.condition_id, []);
    }
    conditionTokens.get(p.condition_id)!.push({
      token_id: p.token_id,
      net: parseFloat(p.net)
    });
  }
  console.log(`Found ${conditionTokens.size} conditions with token pairs\n`);

  // Step 2: Get redemptions by condition
  const redemptionQ = `
    SELECT
      condition_id,
      sum(toFloat64OrZero(amount_or_payout)) / 1e6 as redeemed_usdc
    FROM pm_ctf_events
    WHERE lower(user_address) = '${WALLET}'
      AND event_type = 'PayoutRedemption'
      AND is_deleted = 0
    GROUP BY condition_id
  `;
  const redemptionR = await clickhouse.query({ query: redemptionQ, format: 'JSONEachRow' });
  const redemptions = await redemptionR.json() as any[];

  const redemptionMap = new Map<string, number>();
  for (const r of redemptions) {
    redemptionMap.set(r.condition_id, parseFloat(r.redeemed_usdc));
  }

  // Step 3: Get resolution prices
  const conditions = Array.from(conditionTokens.keys());
  const condList = conditions.map(c => `'${c}'`).join(',');
  const resQ = `
    SELECT condition_id, outcome_index, resolved_price
    FROM vw_pm_resolution_prices
    WHERE condition_id IN (${condList})
  `;
  const resR = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
  const resolutions = await resR.json() as any[];

  // Map condition -> winning outcome_index
  const winningOutcome = new Map<string, number>();
  for (const r of resolutions) {
    if (parseFloat(r.resolved_price) === 1) {
      winningOutcome.set(r.condition_id, r.outcome_index);
    }
  }

  // Step 4: For each condition, determine winner and calculate unredeemed value
  console.log('Condition Analysis:');
  console.log('Cond ID (20 chars)              | Token A Net | Token B Net | Redeemed | Winner | Unredeemed');
  console.log('-'.repeat(110));

  let totalUnredeemedValue = 0;
  let inferredCount = 0;

  for (const [condId, tokens] of conditionTokens.entries()) {
    if (tokens.length !== 2) continue;

    const t0 = tokens[0];
    const t1 = tokens[1];
    const redeemed = redemptionMap.get(condId) || 0;

    // Determine which token is the winner
    // Logic: if we redeemed, the token with positive net that matches redemption is winner
    let winnerToken: string | null = null;
    let winnerNet = 0;

    if (t0.net > 0 && t1.net <= 0) {
      winnerToken = t0.token_id;
      winnerNet = t0.net;
    } else if (t1.net > 0 && t0.net <= 0) {
      winnerToken = t1.token_id;
      winnerNet = t1.net;
    } else if (t0.net > 0 && t1.net > 0) {
      // Both positive - use redemption to infer
      // The one closer to redemption amount is likely the winner
      if (Math.abs(t0.net - redeemed) < Math.abs(t1.net - redeemed)) {
        winnerToken = t0.token_id;
        winnerNet = t0.net;
      } else {
        winnerToken = t1.token_id;
        winnerNet = t1.net;
      }
    } else {
      // Both negative or zero - no held value
      winnerToken = 'none';
      winnerNet = 0;
    }

    // Unredeemed value = winning position - what was already redeemed
    const unredeemedValue = Math.max(0, winnerNet - redeemed);
    totalUnredeemedValue += unredeemedValue;

    if (winnerToken !== 'none') inferredCount++;

    console.log(
      `${condId.slice(0, 28)}... | ${t0.net.toFixed(2).padStart(10)} | ${t1.net.toFixed(2).padStart(10)} | $${redeemed.toFixed(2).padStart(7)} | ${winnerToken === t0.token_id ? 'A' : winnerToken === t1.token_id ? 'B' : '-'} | $${unredeemedValue.toFixed(2).padStart(7)}`
    );
  }

  console.log('\n=== RESULTS ===');
  console.log(`Conditions with inferred winner: ${inferredCount}/${conditionTokens.size}`);
  console.log(`Total unredeemed winning value: $${totalUnredeemedValue.toFixed(2)}`);

  // Step 5: Calculate P&L
  const clobQ = `
    WITH deduped AS (
      SELECT event_id, any(side) as side, any(usdc_amount) / 1e6 as usdc
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      sum(if(side = 'buy', usdc, 0)) as buys,
      sum(if(side = 'sell', usdc, 0)) as sells
    FROM deduped
  `;
  const clobR = await clickhouse.query({ query: clobQ, format: 'JSONEachRow' });
  const { buys, sells } = (await clobR.json() as any[])[0];

  const totalRedemptions = Array.from(redemptionMap.values()).reduce((a, b) => a + b, 0);

  const splitQ = `
    WITH wallet_txs AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    )
    SELECT sum(toFloat64OrZero(amount_or_payout)) / 1e6 as split_cost
    FROM pm_ctf_events
    WHERE tx_hash IN (SELECT tx_hash FROM wallet_txs)
      AND event_type = 'PositionSplit'
      AND is_deleted = 0
  `;
  const splitR = await clickhouse.query({ query: splitQ, format: 'JSONEachRow' });
  const { split_cost: splitCost } = (await splitR.json() as any[])[0];

  console.log('\n=== P&L CALCULATION ===');
  console.log(`Sells: $${parseFloat(sells).toFixed(2)}`);
  console.log(`Redemptions: $${totalRedemptions.toFixed(2)}`);
  console.log(`Buys: $${parseFloat(buys).toFixed(2)}`);
  console.log(`Split cost: $${parseFloat(splitCost).toFixed(2)}`);
  console.log(`Unredeemed held value: $${totalUnredeemedValue.toFixed(2)}`);

  const pnl = parseFloat(sells) + totalRedemptions - parseFloat(buys) - parseFloat(splitCost) + totalUnredeemedValue;
  console.log('---');
  console.log(`Calculated P&L: $${pnl.toFixed(2)}`);
  console.log(`Ground truth: $-86.66`);
  console.log(`Error: $${Math.abs(pnl - (-86.66)).toFixed(2)}`);
}

main().catch(console.error);
