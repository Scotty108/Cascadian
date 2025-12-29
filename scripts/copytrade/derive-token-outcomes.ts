/**
 * Derive token → outcome mapping from CLOB trade patterns
 *
 * Key insight: For each condition_id, there are exactly 2 tokens (YES/NO)
 * By looking at which tokens were traded in the same transaction as splits,
 * we can pair them up and determine their outcomes.
 *
 * For binary markets:
 * - Outcome 0 = NO (typically the "against" position)
 * - Outcome 1 = YES (typically the "for" position)
 *
 * When a split happens in a transaction, the user:
 * 1. Pays $1 to create YES+NO pair
 * 2. Sells one side on CLOB (recorded as SELL)
 * 3. Keeps the other side (net LONG position)
 *
 * From CLOB patterns:
 * - If token is net LONG: user kept it after splits
 * - If token is net SHORT: user sold it from splits
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== DERIVING TOKEN → OUTCOME MAPPINGS ===');
  console.log(`Wallet: ${WALLET}\n`);

  // Step 1: Get all CLOB trades with tx_hash
  console.log('Step 1: Getting CLOB trades with tx_hash...');
  const tradesQ = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens,
        any(lower(concat('0x', hex(transaction_hash)))) as tx_hash
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      token_id,
      tx_hash,
      side,
      usdc,
      tokens
    FROM deduped
  `;
  const tradesR = await clickhouse.query({ query: tradesQ, format: 'JSONEachRow' });
  const trades = (await tradesR.json()) as {
    token_id: string;
    tx_hash: string;
    side: string;
    usdc: string;
    tokens: string;
  }[];
  console.log(`  Found ${trades.length} CLOB trades`);

  // Step 2: Get CTF splits with tx_hash and condition_id
  console.log('\nStep 2: Getting CTF splits with condition_id...');
  const splitsQ = `
    WITH wallet_txs AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    )
    SELECT
      tx_hash,
      condition_id,
      toFloat64OrZero(amount_or_payout) / 1e6 as split_amount
    FROM pm_ctf_events
    WHERE tx_hash IN (SELECT tx_hash FROM wallet_txs)
      AND event_type = 'PositionSplit'
      AND is_deleted = 0
  `;
  const splitsR = await clickhouse.query({ query: splitsQ, format: 'JSONEachRow' });
  const splits = (await splitsR.json()) as {
    tx_hash: string;
    condition_id: string;
    split_amount: string;
  }[];
  console.log(`  Found ${splits.length} CTF splits`);

  // Create tx_hash → condition_id mapping
  const txToCondition = new Map<string, string>();
  for (const s of splits) {
    txToCondition.set(s.tx_hash, s.condition_id);
  }

  // Step 3: For each condition_id, find the tokens traded
  console.log('\nStep 3: Mapping tokens to conditions...');
  const conditionTokens = new Map<string, Set<string>>();
  const tokenCondition = new Map<string, string>();

  for (const t of trades) {
    const conditionId = txToCondition.get(t.tx_hash);
    if (conditionId) {
      if (!conditionTokens.has(conditionId)) {
        conditionTokens.set(conditionId, new Set());
      }
      conditionTokens.get(conditionId)!.add(t.token_id);
      tokenCondition.set(t.token_id, conditionId);
    }
  }

  console.log(`  Mapped ${tokenCondition.size} tokens to ${conditionTokens.size} conditions`);

  // Step 4: For each condition, identify token pairs
  console.log('\nStep 4: Identifying token pairs per condition...');
  const tokenPairs: { condition_id: string; tokens: string[] }[] = [];

  for (const [conditionId, tokens] of conditionTokens.entries()) {
    const tokenArray = Array.from(tokens);
    if (tokenArray.length === 2) {
      tokenPairs.push({ condition_id: conditionId, tokens: tokenArray });
    } else {
      console.log(`  Warning: condition ${conditionId.slice(0, 12)}... has ${tokenArray.length} tokens`);
    }
  }
  console.log(`  Found ${tokenPairs.length} complete token pairs`);

  // Step 5: Aggregate positions per token
  console.log('\nStep 5: Aggregating positions per token...');
  const tokenPositions = new Map<string, { bought: number; sold: number }>();

  for (const t of trades) {
    const tokenId = t.token_id;
    if (!tokenPositions.has(tokenId)) {
      tokenPositions.set(tokenId, { bought: 0, sold: 0 });
    }
    const pos = tokenPositions.get(tokenId)!;
    if (t.side === 'buy') {
      pos.bought += parseFloat(t.tokens);
    } else {
      pos.sold += parseFloat(t.tokens);
    }
  }

  // Step 6: For each pair, determine which is LONG vs SHORT
  console.log('\nStep 6: Determining LONG vs SHORT for each pair...');
  const tokenOutcomes: { token_id: string; condition_id: string; inferred_outcome: number }[] = [];

  for (const pair of tokenPairs) {
    const pos0 = tokenPositions.get(pair.tokens[0]) || { bought: 0, sold: 0 };
    const pos1 = tokenPositions.get(pair.tokens[1]) || { bought: 0, sold: 0 };

    const net0 = pos0.bought - pos0.sold;
    const net1 = pos1.bought - pos1.sold;

    // For splits: one token is LONG (kept), one is SHORT (sold)
    // The LONG token is the one user kept
    // The SHORT token is the one user sold

    // Key insight: token_id determines outcome_index, not trading pattern
    // We need to figure out which token_id maps to which outcome
    // Strategy: Try BOTH mappings and see which one gives ~20% win rate

    // First pass: assume token with SMALLER token_id = outcome 0
    // (This is a guess based on how Polymarket might generate token IDs)
    const token0 = pair.tokens[0];
    const token1 = pair.tokens[1];

    // Compare token IDs numerically to determine likely outcome
    const tokenId0Num = BigInt(token0);
    const tokenId1Num = BigInt(token1);

    // Try FLIPPED mapping (opposite of numeric ordering)
    if (tokenId0Num < tokenId1Num) {
      // FLIP: token0 is outcome 1, token1 is outcome 0
      tokenOutcomes.push({ token_id: token0, condition_id: pair.condition_id, inferred_outcome: 1 });
      tokenOutcomes.push({ token_id: token1, condition_id: pair.condition_id, inferred_outcome: 0 });
    } else {
      // FLIP: token1 is outcome 1, token0 is outcome 0
      tokenOutcomes.push({ token_id: token0, condition_id: pair.condition_id, inferred_outcome: 0 });
      tokenOutcomes.push({ token_id: token1, condition_id: pair.condition_id, inferred_outcome: 1 });
    }
  }

  console.log(`  Inferred outcomes for ${tokenOutcomes.length} tokens`);

  // Step 7: Look up resolution prices
  console.log('\nStep 7: Looking up resolution prices...');
  const conditionIds = Array.from(conditionTokens.keys()).map((c) => `'${c}'`).join(',');
  const resolutionQ = `
    SELECT condition_id, outcome_index, resolved_price
    FROM vw_pm_resolution_prices
    WHERE condition_id IN (${conditionIds})
  `;
  const resolutionR = await clickhouse.query({ query: resolutionQ, format: 'JSONEachRow' });
  const resolutions = (await resolutionR.json()) as {
    condition_id: string;
    outcome_index: number;
    resolved_price: string;
  }[];

  const resolutionMap = new Map<string, Map<number, number>>();
  for (const r of resolutions) {
    if (!resolutionMap.has(r.condition_id)) {
      resolutionMap.set(r.condition_id, new Map());
    }
    resolutionMap.get(r.condition_id)!.set(r.outcome_index, parseFloat(r.resolved_price));
  }

  console.log(`  Found resolutions for ${resolutionMap.size} conditions`);

  // Step 8: Calculate held token value using inferred outcomes
  console.log('\nStep 8: Calculating held token value...');
  let heldValueCalculated = 0;
  let longTokensCalculated = 0;
  let winnersCount = 0;
  let losersCount = 0;

  for (const to of tokenOutcomes) {
    const pos = tokenPositions.get(to.token_id);
    if (!pos) continue;

    const net = pos.bought - pos.sold;
    if (net <= 0) continue; // Only LONG positions have held value

    const condRes = resolutionMap.get(to.condition_id);
    if (!condRes) continue;

    const resPrice = condRes.get(to.inferred_outcome);
    if (resPrice === undefined) continue;

    const value = net * resPrice;
    heldValueCalculated += value;
    longTokensCalculated += net;

    if (resPrice > 0.5) {
      winnersCount++;
    } else {
      losersCount++;
    }
  }

  console.log(`  Long tokens with inferred outcomes: ${longTokensCalculated.toFixed(2)}`);
  console.log(`  Held value calculated: $${heldValueCalculated.toFixed(2)}`);
  console.log(`  Winners: ${winnersCount}, Losers: ${losersCount}`);

  // Step 9: Compare to ground truth
  console.log('\n=== COMPARISON ===');
  const impliedHeldValue = 413.83; // From ground truth
  console.log(`  Implied held value (from ground truth): $${impliedHeldValue.toFixed(2)}`);
  console.log(`  Calculated held value: $${heldValueCalculated.toFixed(2)}`);
  console.log(`  Gap: $${(heldValueCalculated - impliedHeldValue).toFixed(2)}`);

  if (longTokensCalculated > 0) {
    console.log(`\n  Implied avg price: $${(impliedHeldValue / 2015.81).toFixed(4)}`);
    console.log(`  Calculated avg price: $${(heldValueCalculated / longTokensCalculated).toFixed(4)}`);
  }

  // Show sample mappings
  console.log('\n=== SAMPLE TOKEN MAPPINGS ===');
  for (const to of tokenOutcomes.slice(0, 10)) {
    const pos = tokenPositions.get(to.token_id)!;
    const net = pos.bought - pos.sold;
    const condRes = resolutionMap.get(to.condition_id);
    const resPrice = condRes?.get(to.inferred_outcome) ?? 'N/A';
    console.log(
      `  ${to.token_id.slice(0, 12)}... cond=${to.condition_id.slice(0, 8)}... outcome=${to.inferred_outcome} net=${net.toFixed(2)} res=${resPrice}`
    );
  }
}

main().catch(console.error);
