import { clickhouse } from '../lib/clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

// spot_3 wallet - one of the 3 failing wallets
const wallet = '0x63bb7e3a1b5f0bf86cabdf5bed3247ca9d8c3430';

// Find conditions where BOTH outcomes have trades and show their buy/sell patterns
const query = `
  SELECT
    condition_id,
    outcome_index,
    bought_tokens,
    bought_cost,
    sold_tokens,
    sold_proceeds,
    bought_tokens - sold_tokens as net_tokens,
    CASE
      WHEN sold_tokens > 0 AND bought_tokens = 0 THEN 'SPLIT_DISPOSAL'
      WHEN sold_tokens > bought_tokens AND bought_tokens > 0 THEN 'OVER_SOLD'
      WHEN bought_tokens > sold_tokens THEN 'NET_LONG'
      WHEN bought_tokens = sold_tokens THEN 'FLAT'
      ELSE 'OTHER'
    END as pattern
  FROM (
    SELECT
      condition_id,
      outcome_index,
      round(sumIf(tokens, side='buy'), 2) as bought_tokens,
      round(sumIf(usdc, side='buy'), 2) as bought_cost,
      round(sumIf(tokens, side='sell'), 2) as sold_tokens,
      round(sumIf(usdc, side='sell'), 2) as sold_proceeds
    FROM (
      SELECT
        m.condition_id as condition_id,
        m.outcome_index as outcome_index,
        t.side as side,
        max(t.usdc_amount) / 1e6 as usdc,
        max(t.token_amount) / 1e6 as tokens
      FROM pm_trader_events_v3 t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${wallet}'
        AND m.condition_id IS NOT NULL AND m.condition_id != ''
      GROUP BY substring(event_id, 1, 66), m.condition_id, m.outcome_index, t.side
    )
    GROUP BY condition_id, outcome_index
  )
  WHERE condition_id IN (
    SELECT condition_id FROM (
      SELECT condition_id, count(DISTINCT outcome_index) as cnt
      FROM (
        SELECT m.condition_id, m.outcome_index
        FROM pm_trader_events_v3 t
        LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = '${wallet}'
          AND m.condition_id IS NOT NULL
        GROUP BY m.condition_id, m.outcome_index
      )
      GROUP BY condition_id
      HAVING cnt >= 2
    )
  )
  ORDER BY condition_id, outcome_index
`;

async function main() {
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as Array<{
    condition_id: string;
    outcome_index: number;
    bought_tokens: number;
    bought_cost: number;
    sold_tokens: number;
    sold_proceeds: number;
    net_tokens: number;
    pattern: string;
  }>;

  console.log(`Found ${rows.length} outcome positions across conditions with multiple outcomes\n`);

  // Group by condition to see the pattern pairs
  const byCondition = new Map<string, typeof rows>();
  for (const row of rows) {
    const cid = row.condition_id.substring(0, 16) + '...';
    if (!byCondition.has(cid)) byCondition.set(cid, []);
    byCondition.get(cid)!.push(row);
  }

  let splitDisposalCount = 0;
  let pairedSplitCount = 0;

  console.log('=== CONDITIONS WITH SPLIT_DISPOSAL PATTERN ===\n');
  for (const [cid, outcomes] of byCondition) {
    const patterns = outcomes.map(o => o.pattern);
    
    // Check if this is a paired split pattern
    const hasSplitDisposal = patterns.includes('SPLIT_DISPOSAL');
    const hasNetLong = patterns.includes('NET_LONG');
    
    if (hasSplitDisposal) {
      splitDisposalCount++;
      if (hasNetLong) pairedSplitCount++;
      
      console.log(`Condition: ${cid}`);
      for (const o of outcomes) {
        console.log(`  Outcome ${o.outcome_index}: ${o.pattern}`);
        console.log(`    Bought: ${o.bought_tokens} tokens ($${o.bought_cost})`);
        console.log(`    Sold:   ${o.sold_tokens} tokens ($${o.sold_proceeds})`);
        console.log(`    Net:    ${o.net_tokens} tokens`);
      }
      console.log('');
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Conditions with SPLIT_DISPOSAL pattern: ${splitDisposalCount}`);
  console.log(`Conditions with SPLIT_DISPOSAL + NET_LONG pairing: ${pairedSplitCount}`);
}

main().catch(console.error);
