/**
 * Debug calibration wallet data to understand the split/trade pattern
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';

const CALIBRATION = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function debugCalibration() {
  console.log('=== CALIBRATION WALLET DEBUG ===\n');

  // 1) Get all CLOB trades with details
  const tradesQ = `
    SELECT
      token_id,
      sum(CASE WHEN side = 'buy' THEN usdc_amount ELSE 0 END)/1e6 as buy_usdc,
      sum(CASE WHEN side = 'sell' THEN usdc_amount ELSE 0 END)/1e6 as sell_usdc,
      sum(CASE WHEN side = 'buy' THEN token_amount ELSE 0 END)/1e6 as buy_tokens,
      sum(CASE WHEN side = 'sell' THEN token_amount ELSE 0 END)/1e6 as sell_tokens
    FROM pm_trader_events_dedup_v2_tbl
    WHERE trader_wallet = '${CALIBRATION}'
    GROUP BY token_id
    ORDER BY sell_tokens - buy_tokens ASC
    LIMIT 50
  `;
  const tradesR = await clickhouse.query({ query: tradesQ, format: 'JSONEachRow' });
  const trades = await tradesR.json() as Array<{
    token_id: string;
    buy_usdc: number;
    sell_usdc: number;
    buy_tokens: number;
    sell_tokens: number;
  }>;

  console.log('Top tokens with deficits:');
  console.log('Token ID | Bought | Sold | Net | Deficit');
  console.log('-'.repeat(80));

  let totalDeficit = 0;
  let totalBuyTokens = 0;
  let totalSellTokens = 0;

  for (const t of trades) {
    const net = t.buy_tokens - t.sell_tokens;
    const deficit = Math.max(0, -net);
    totalDeficit += deficit;
    totalBuyTokens += t.buy_tokens;
    totalSellTokens += t.sell_tokens;

    if (deficit > 0) {
      console.log(`${t.token_id.slice(0, 20)}... | ${t.buy_tokens.toFixed(2)} | ${t.sell_tokens.toFixed(2)} | ${net.toFixed(2)} | ${deficit.toFixed(2)}`);
    }
  }

  console.log('-'.repeat(80));
  console.log(`Total tokens bought: ${totalBuyTokens.toFixed(2)}`);
  console.log(`Total tokens sold: ${totalSellTokens.toFixed(2)}`);
  console.log(`Total token deficit (sum of all deficits): $${totalDeficit.toFixed(2)}`);

  // 2) Get CTF events
  const ctfQ = `
    SELECT
      event_type,
      condition_id,
      count() as cnt,
      sum(toFloat64OrZero(amount_or_payout))/1e6 as total_amount
    FROM pm_ctf_events
    WHERE lower(user_address) = '${CALIBRATION}'
      AND is_deleted = 0
    GROUP BY event_type, condition_id
    ORDER BY event_type, total_amount DESC
  `;
  const ctfR = await clickhouse.query({ query: ctfQ, format: 'JSONEachRow' });
  const ctfEvents = await ctfR.json() as Array<{
    event_type: string;
    condition_id: string;
    cnt: number;
    total_amount: number;
  }>;

  console.log('\nCTF Events by type:');
  const eventTotals: Record<string, number> = {};
  for (const e of ctfEvents) {
    eventTotals[e.event_type] = (eventTotals[e.event_type] || 0) + e.total_amount;
  }
  for (const [type, total] of Object.entries(eventTotals)) {
    console.log(`  ${type}: $${total.toFixed(2)}`);
  }

  // 3) Get token to condition mapping for calibration's tokens
  const tokenIds = trades.map(t => t.token_id);
  const mappingQ = `
    SELECT token_id_dec as token_id, condition_id, outcome_index
    FROM pm_token_to_condition_map_v5
    WHERE token_id_dec IN ({tokenIds:Array(String)})
    UNION ALL
    SELECT token_id_dec as token_id, condition_id, outcome_index
    FROM pm_token_to_condition_patch
    WHERE token_id_dec IN ({tokenIds:Array(String)})
  `;
  const mappingR = await clickhouse.query({
    query: mappingQ,
    query_params: { tokenIds },
    format: 'JSONEachRow',
  });
  const mappings = await mappingR.json() as Array<{
    token_id: string;
    condition_id: string;
    outcome_index: number;
  }>;

  const tokenToCondition = new Map<string, string>();
  for (const m of mappings) {
    tokenToCondition.set(m.token_id, m.condition_id);
  }

  // 4) Calculate max deficit per condition
  const conditionDeficits = new Map<string, { maxDeficit: number; outcomes: Map<number, number> }>();
  const tokenOutcomeMap = new Map<string, number>();
  for (const m of mappings) {
    tokenOutcomeMap.set(m.token_id, m.outcome_index);
  }

  for (const t of trades) {
    const conditionId = tokenToCondition.get(t.token_id);
    if (!conditionId) continue;

    const outcomeIndex = tokenOutcomeMap.get(t.token_id) || 0;
    const net = t.buy_tokens - t.sell_tokens;
    const deficit = Math.max(0, -net);

    const existing = conditionDeficits.get(conditionId) || { maxDeficit: 0, outcomes: new Map() };
    existing.outcomes.set(outcomeIndex, (existing.outcomes.get(outcomeIndex) || 0) + deficit);
    if (deficit > existing.maxDeficit) {
      existing.maxDeficit = deficit;
    }
    conditionDeficits.set(conditionId, existing);
  }

  console.log('\nCondition-level analysis:');
  let maxDeficitSum = 0;
  for (const [condId, data] of conditionDeficits.entries()) {
    if (data.maxDeficit > 0) {
      maxDeficitSum += data.maxDeficit;
      console.log(`  ${condId.slice(0, 30)}...: max deficit = $${data.maxDeficit.toFixed(2)}`);
    }
  }
  console.log(`\nSum of max deficits per condition: $${maxDeficitSum.toFixed(2)}`);

  // 5) Calculate expected P&L
  const tradesAggQ = `
    SELECT
      sum(CASE WHEN side = 'buy' THEN usdc_amount ELSE 0 END)/1e6 as total_buys,
      sum(CASE WHEN side = 'sell' THEN usdc_amount ELSE 0 END)/1e6 as total_sells
    FROM pm_trader_events_dedup_v2_tbl
    WHERE trader_wallet = '${CALIBRATION}'
  `;
  const tradesAggR = await clickhouse.query({ query: tradesAggQ, format: 'JSONEachRow' });
  const [agg] = await tradesAggR.json() as [{ total_buys: number; total_sells: number }];

  const redemptions = eventTotals['PayoutRedemption'] || 0;
  const merges = eventTotals['PositionsMerge'] || 0;
  const explicitSplits = eventTotals['PositionSplit'] || 0;

  console.log('\n=== P&L CALCULATION ===');
  console.log(`Buys: $${agg.total_buys.toFixed(2)}`);
  console.log(`Sells: $${agg.total_sells.toFixed(2)}`);
  console.log(`Redemptions: $${redemptions.toFixed(2)}`);
  console.log(`Merges: $${merges.toFixed(2)}`);
  console.log(`Explicit Splits: $${explicitSplits.toFixed(2)}`);

  // Without any split cost
  const pnlNoSplit = agg.total_sells + redemptions + merges - agg.total_buys;
  console.log(`\nP&L (no split cost): $${pnlNoSplit.toFixed(2)}`);

  // With max deficit per condition
  const pnlWithMaxDeficit = pnlNoSplit - maxDeficitSum;
  console.log(`P&L (with max deficit split): $${pnlWithMaxDeficit.toFixed(2)}`);

  // What split cost would give -$86?
  const targetPnl = -86;
  const requiredSplitCost = pnlNoSplit - targetPnl;
  console.log(`\nRequired split cost for -$86 target: $${requiredSplitCost.toFixed(2)}`);
  console.log(`Gap from max deficit: $${(requiredSplitCost - maxDeficitSum).toFixed(2)}`);
}

debugCalibration()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
