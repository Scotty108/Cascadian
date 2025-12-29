/**
 * Infer token → outcome mapping from redemption data
 *
 * Key insight: When a wallet redeems, they redeem WINNING tokens.
 * If we see redemption for condition X, and the wallet holds token A,
 * then token A must be the winning outcome.
 *
 * This is DETERMINISTIC - no ground truth needed!
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '@/lib/clickhouse/client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== INFER MAPPING FROM REDEMPTIONS ===\n');

  // Step 1: Get all redemptions for this wallet by condition
  const redemptionQ = `
    SELECT
      condition_id,
      sum(toFloat64OrZero(amount_or_payout)) / 1e6 as redeemed_usdc
    FROM pm_ctf_events
    WHERE lower(user_address) = '${WALLET}'
      AND event_type = 'PayoutRedemption'
      AND is_deleted = 0
    GROUP BY condition_id
    ORDER BY redeemed_usdc DESC
  `;
  const r1 = await clickhouse.query({ query: redemptionQ, format: 'JSONEachRow' });
  const redemptions = await r1.json() as any[];
  console.log(`Found redemptions for ${redemptions.length} conditions\n`);

  // Step 2: Get token positions via tx_hash correlation
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
      sum(if(t.side = 'buy', t.tokens, 0)) as bought,
      sum(if(t.side = 'sell', t.tokens, 0)) as sold,
      sum(if(t.side = 'buy', t.tokens, 0)) - sum(if(t.side = 'sell', t.tokens, 0)) as net
    FROM wallet_txs t
    JOIN split_conditions s ON t.tx_hash = s.tx_hash
    GROUP BY t.token_id, s.condition_id
  `;
  const r2 = await clickhouse.query({ query: posQ, format: 'JSONEachRow' });
  const positions = await r2.json() as any[];

  // Group by condition
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

  // Step 3: Get resolution prices
  const conditions = Array.from(conditionTokens.keys());
  const condList = conditions.map(c => `'${c}'`).join(',');
  const resQ = `
    SELECT condition_id, outcome_index, resolved_price
    FROM vw_pm_resolution_prices
    WHERE condition_id IN (${condList})
  `;
  const r3 = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
  const resolutions = await r3.json() as any[];

  const resolutionMap = new Map<string, number>(); // condition -> winning outcome_index
  for (const r of resolutions) {
    if (parseFloat(r.resolved_price) === 1) {
      resolutionMap.set(r.condition_id, r.outcome_index);
    }
  }

  // Step 4: Infer mapping from redemptions
  console.log('Inferring token → outcome mapping from redemptions:\n');
  console.log('Condition ID (first 20)         | Redeemed | Token A Net | Token B Net | Inferred Winner');
  console.log('-'.repeat(100));

  const inferredMappings: Array<{token_id: string, condition_id: string, is_winner: boolean}> = [];
  let inferredCount = 0;
  let ambiguousCount = 0;

  for (const redemption of redemptions) {
    const condId = redemption.condition_id;
    const redeemed = parseFloat(redemption.redeemed_usdc);
    const tokens = conditionTokens.get(condId);
    const winningOutcome = resolutionMap.get(condId);

    if (!tokens || tokens.length !== 2) continue;

    const t0 = tokens[0];
    const t1 = tokens[1];

    // The token with positive net position that was redeemed is the WINNER
    // Redemption amount should match the positive position
    let inferredWinner: string | null = null;

    // If one token has positive net ≈ redemption amount, it's the winner
    if (t0.net > 0 && Math.abs(t0.net - redeemed) < 1) {
      inferredWinner = t0.token_id;
    } else if (t1.net > 0 && Math.abs(t1.net - redeemed) < 1) {
      inferredWinner = t1.token_id;
    } else if (t0.net > 0 && t1.net <= 0) {
      // Only t0 has positive position, must be winner
      inferredWinner = t0.token_id;
    } else if (t1.net > 0 && t0.net <= 0) {
      // Only t1 has positive position, must be winner
      inferredWinner = t1.token_id;
    }

    if (inferredWinner) {
      inferredCount++;
      // Record mappings
      inferredMappings.push({ token_id: t0.token_id, condition_id: condId, is_winner: t0.token_id === inferredWinner });
      inferredMappings.push({ token_id: t1.token_id, condition_id: condId, is_winner: t1.token_id === inferredWinner });
    } else {
      ambiguousCount++;
    }

    console.log(
      `${condId.slice(0, 28)}... | $${redeemed.toFixed(2).padStart(7)} | ${t0.net.toFixed(2).padStart(10)} | ${t1.net.toFixed(2).padStart(10)} | ${inferredWinner ? 'Token ' + (inferredWinner === t0.token_id ? 'A' : 'B') : 'AMBIGUOUS'}`
    );
  }

  console.log('\n=== RESULTS ===');
  console.log(`Inferred: ${inferredCount}/${redemptions.length} conditions`);
  console.log(`Ambiguous: ${ambiguousCount}/${redemptions.length} conditions`);
  console.log(`Total mappings derived: ${inferredMappings.length} tokens`);

  // Step 5: Calculate P&L using inferred mappings
  console.log('\n=== P&L CALCULATION WITH INFERRED MAPPINGS ===');

  // Get CLOB aggregates
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

  // Get total redemptions
  const totalRedemptions = redemptions.reduce((sum, r) => sum + parseFloat(r.redeemed_usdc), 0);

  // Get split cost
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

  // Calculate held value using inferred mappings
  let heldValue = 0;
  for (const m of inferredMappings) {
    if (m.is_winner) {
      const pos = positions.find(p => p.token_id === m.token_id);
      if (pos) {
        const net = parseFloat(pos.net);
        if (net > 0) {
          heldValue += net; // Winner pays $1 per token
        }
      }
    }
  }

  const finalPnl = parseFloat(sells) + totalRedemptions - parseFloat(buys) - parseFloat(splitCost) + heldValue;

  console.log(`Sells: $${parseFloat(sells).toFixed(2)}`);
  console.log(`Redemptions: $${totalRedemptions.toFixed(2)}`);
  console.log(`Buys: $${parseFloat(buys).toFixed(2)}`);
  console.log(`Split cost: $${parseFloat(splitCost).toFixed(2)}`);
  console.log(`Held value (inferred winners): $${heldValue.toFixed(2)}`);
  console.log(`---`);
  console.log(`Calculated P&L: $${finalPnl.toFixed(2)}`);
  console.log(`Ground truth: $-86.66`);
  console.log(`Error: $${Math.abs(finalPnl - (-86.66)).toFixed(2)}`);
}

main().catch(console.error);
