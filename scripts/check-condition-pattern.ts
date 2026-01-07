import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const wallet = '0xbf4f05a8b1d08f82d57697bb0bbfda19b0df5b24';

async function check() {
  // Check for buys on complementary tokens - grouped by condition
  const q = `
    SELECT
      any(m.condition_id) as condition_id,
      m.outcome_index,
      t.side,
      sum(t.usdc) / 1e6 as usdc,
      sum(t.tokens) / 1e6 as tokens,
      count(*) as cnt
    FROM (
      SELECT
        any(token_id) as token_id,
        side,
        any(usdc_amount) as usdc,
        any(token_amount) as tokens
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
      GROUP BY transaction_hash, side, usdc_amount, token_amount
    ) t
    LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    GROUP BY m.condition_id, m.outcome_index, t.side
    HAVING condition_id != ''
    ORDER BY condition_id, m.outcome_index, t.side
    LIMIT 50
  `;

  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const rows = (await r.json()) as any[];

  console.log('CONDITION-LEVEL VIEW (grouped by market):');
  console.log('-'.repeat(80));

  let currentCond = '';
  for (const row of rows) {
    if (row.condition_id !== currentCond) {
      currentCond = row.condition_id;
      console.log(`\nCondition: ${currentCond.slice(0, 20)}...`);
    }
    const usdc = Number(row.usdc).toFixed(2);
    const tokens = Number(row.tokens).toFixed(2);
    console.log(`  outcome[${row.outcome_index}] ${row.side.padEnd(4)} $${usdc.padStart(8)} | ${tokens.padStart(10)} tokens | ${row.cnt} trades`);
  }

  // Now check: for each condition, do we have buy on one outcome and sell on another?
  console.log('\n\n--- LOOKING FOR COMPLEMENT PATTERN ---');
  console.log('(BUY outcome[0] + SELL outcome[1] or vice versa)\n');

  const byCondition = new Map<string, any[]>();
  for (const row of rows) {
    const cid = row.condition_id;
    if (!byCondition.has(cid)) byCondition.set(cid, []);
    byCondition.get(cid)!.push(row);
  }

  let complementPattern = 0;
  for (const [cid, trades] of byCondition) {
    const outcomes = new Set(trades.map(t => t.outcome_index));
    const sides = new Set(trades.map(t => t.side));

    if (outcomes.size > 1 && sides.has('buy') && sides.has('sell')) {
      complementPattern++;
      if (complementPattern <= 5) {
        console.log(`Condition ${cid.slice(0, 16)}... has COMPLEMENT pattern:`);
        for (const t of trades) {
          console.log(`  outcome[${t.outcome_index}] ${t.side} $${Number(t.usdc).toFixed(2)}`);
        }
      }
    }
  }

  console.log(`\nTotal conditions with complement pattern: ${complementPattern}`);
}

check();
