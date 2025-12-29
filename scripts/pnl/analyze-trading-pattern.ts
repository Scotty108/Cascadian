/**
 * Analyze trading pattern per market to find YES/NO conversion pattern
 */
import { clickhouse } from '../../lib/clickhouse/client';

const wallet = process.argv[2] || '0xdbaed59f8730b3ae23e0b38196e091208431f4ff';

interface TradeEntry {
  outcome: number;
  usdc: number;
  tokens: number;
}

interface MarketActivity {
  buys: TradeEntry[];
  sells: TradeEntry[];
}

async function analyze() {
  console.log('Analyzing trading pattern for wallet:', wallet);

  // Get condition_id for each token via the mapping table
  const query = `
    WITH trades AS (
      SELECT
        token_id,
        side,
        usdc_amount / 1e6 as usdc,
        token_amount / 1e6 as tokens
      FROM pm_trader_events_v2
      WHERE trader_wallet = {wallet:String}
        AND is_deleted = 0
      GROUP BY event_id, token_id, side, usdc_amount, token_amount, transaction_hash
    ),
    token_conditions AS (
      SELECT token_id_dec as token_id, condition_id, outcome_index
      FROM pm_token_to_condition_map_v5
    )
    SELECT
      t.side,
      tc.condition_id,
      tc.outcome_index,
      sum(t.usdc) as total_usdc,
      sum(t.tokens) as total_tokens
    FROM trades t
    LEFT JOIN token_conditions tc ON t.token_id = tc.token_id
    GROUP BY t.side, tc.condition_id, tc.outcome_index
    ORDER BY tc.condition_id, t.side, tc.outcome_index
  `;

  const result = await clickhouse.query({
    query,
    query_params: { wallet: wallet.toLowerCase() },
    format: 'JSONEachRow',
  });

  const rows = await result.json() as Array<{
    side: string;
    condition_id: string | null;
    outcome_index: number;
    total_usdc: string;
    total_tokens: string;
  }>;

  // Group by condition_id
  const byCondition: Record<string, MarketActivity> = {};
  for (const row of rows) {
    const cid = row.condition_id || 'UNKNOWN';
    if (!byCondition[cid]) {
      byCondition[cid] = { buys: [], sells: [] };
    }

    const entry: TradeEntry = {
      outcome: row.outcome_index,
      usdc: Number(row.total_usdc),
      tokens: Number(row.total_tokens)
    };

    if (row.side === 'buy') {
      byCondition[cid].buys.push(entry);
    } else {
      byCondition[cid].sells.push(entry);
    }
  }

  console.log('\n=== Trading Pattern Analysis ===\n');

  let buyOneSellOther = 0;
  let buyBothSides = 0;
  let buyOnlyOneOutcome = 0;

  for (const [cid, data] of Object.entries(byCondition)) {
    const buyOutcomes = new Set(data.buys.map(b => b.outcome));
    const sellOutcomes = new Set(data.sells.map(s => s.outcome));

    const buyCount = buyOutcomes.size;
    const sellCount = sellOutcomes.size;

    // Check if they buy one outcome and sell a different one
    const sellsDifferentOutcome = [...sellOutcomes].some(s => !buyOutcomes.has(s));

    if (buyCount === 1 && sellCount === 1 && sellsDifferentOutcome) {
      buyOneSellOther++;
      console.log('Market:', cid ? cid.substring(0, 20) + '...' : 'UNKNOWN');
      console.log('  Buys:', data.buys.map(b => 'O' + b.outcome + ':$' + b.usdc.toFixed(2)).join(', '));
      console.log('  Sells:', data.sells.map(s => 'O' + s.outcome + ':$' + s.usdc.toFixed(2)).join(', '));
    } else if (buyCount === 2) {
      buyBothSides++;
    } else if (buyCount === 1 && sellCount === 0) {
      buyOnlyOneOutcome++;
    }
  }

  console.log('\n=== Pattern Summary ===');
  console.log('Buy-one-sell-other markets:', buyOneSellOther);
  console.log('Buy-both-sides markets:', buyBothSides);
  console.log('Buy-only-one-outcome markets:', buyOnlyOneOutcome);
  console.log('Total markets:', Object.keys(byCondition).length);

  // Now calculate true PnL accounting for this pattern
  console.log('\n=== True PnL Calculation ===');

  // For buy-one-sell-other pattern, the true cost is the buy cost plus the sell proceeds
  // Example: Buy YES @ $0.50, Sell NO @ $0.50
  // True cost of YES = $0.50 (buy) + $0.50 (opportunity cost of selling NO at same level) = $0.50
  // Wait no, that's wrong...
  //
  // Actually the correct interpretation is:
  // - Buy YES tokens: pay $X
  // - Sell NO tokens you don't have: receive $Y
  //
  // Where did the NO tokens come from? This is only possible if:
  // 1. They were transferred in (we checked - no)
  // 2. They were created via SPLIT (we checked - no SPLIT events)
  // 3. This is a NegRisk market where holding YES automatically means short NO
  //
  // Let me check if these are NegRisk markets...

  console.log('\nChecking if markets are NegRisk...');
}

analyze().catch(console.error);
