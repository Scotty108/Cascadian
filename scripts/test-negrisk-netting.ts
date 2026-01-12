/**
 * Quick test: NegRisk netting formula vs Polymarket API
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const TEST_WALLETS = [
  '0x1417b6fd7444b2f1091b5c8357cf89ecafb238af',
  '0xbbecdebaeca07c08f6bd74c6ee2d744934975765',
  '0x006641592b54fd1f2c656d82d591a37e52f09032',
  '0x6dfd278b120f9bc9979eb9dada5c1965e67c694c',
  '0x9ddc9eeda386b5db892510f9f80ac2cf37668d82',
];

async function getApiPnL(wallet: string): Promise<number | null> {
  try {
    const url = `https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    // API returns array of {t: timestamp, p: cumulative_pnl}, last entry is current
    if (Array.isArray(data) && data.length > 0) {
      return data[data.length - 1].p;
    }
    return data.pnl ?? data.totalPnL ?? null;
  } catch {
    return null;
  }
}

async function calculateNettingPnL(wallet: string): Promise<{ pnl: number; details: string }> {
  // Get all trades grouped by condition, outcome, side
  const query = `
    SELECT
      m.condition_id,
      m.outcome_index,
      t.side,
      sum(t.token_amount) / 1e6 as tokens,
      sum(t.usdc_amount) / 1e6 as usdc
    FROM pm_trader_events_v3 t
    JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    WHERE lower(t.trader_wallet) = '${wallet}'
      AND m.condition_id != ''
    GROUP BY m.condition_id, m.outcome_index, t.side
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  // Group by condition
  const conditions: Record<string, {
    outcome0: { buy_tokens: number; buy_usdc: number; sell_tokens: number; sell_usdc: number };
    outcome1: { buy_tokens: number; buy_usdc: number; sell_tokens: number; sell_usdc: number };
  }> = {};

  for (const row of rows) {
    const cid = row.condition_id;
    if (!conditions[cid]) {
      conditions[cid] = {
        outcome0: { buy_tokens: 0, buy_usdc: 0, sell_tokens: 0, sell_usdc: 0 },
        outcome1: { buy_tokens: 0, buy_usdc: 0, sell_tokens: 0, sell_usdc: 0 },
      };
    }
    const outcome = row.outcome_index === 0 ? 'outcome0' : 'outcome1';
    if (row.side === 'buy') {
      conditions[cid][outcome].buy_tokens += Number(row.tokens);
      conditions[cid][outcome].buy_usdc += Number(row.usdc);
    } else {
      conditions[cid][outcome].sell_tokens += Number(row.tokens);
      conditions[cid][outcome].sell_usdc += Number(row.usdc);
    }
  }

  // Calculate PnL per condition using netting
  let totalPnL = 0;
  let conditionCount = 0;

  for (const [cid, data] of Object.entries(conditions)) {
    conditionCount++;

    // For each outcome: realized PnL = sell_usdc - (sell_tokens / buy_tokens * buy_usdc)
    // Plus unrealized based on current position

    // Outcome 0 (typically YES)
    const o0 = data.outcome0;
    const o0_net_tokens = o0.buy_tokens - o0.sell_tokens;
    const o0_avg_cost = o0.buy_tokens > 0 ? o0.buy_usdc / o0.buy_tokens : 0;
    const o0_realized = o0.sell_usdc - (o0.sell_tokens * o0_avg_cost);

    // Outcome 1 (typically NO)
    const o1 = data.outcome1;
    const o1_net_tokens = o1.buy_tokens - o1.sell_tokens;
    const o1_avg_cost = o1.buy_tokens > 0 ? o1.buy_usdc / o1.buy_tokens : 0;
    const o1_realized = o1.sell_usdc - (o1.sell_tokens * o1_avg_cost);

    // NegRisk netting: if bought YES and sold NO in same condition, net them
    // Net position = YES_bought - NO_sold (when NO_sold came from minting)
    if (o0.buy_tokens > 0 && o1.sell_tokens > 0 && o1.buy_tokens === 0) {
      // This is the NegRisk pattern: buy YES, sell NO (minted)
      const net_position = o0.buy_tokens - o1.sell_tokens;
      const net_cost = o0.buy_usdc - o1.sell_usdc; // YES cost minus NO proceeds
      // For now, just count realized (ignoring unrealized)
      totalPnL += o0_realized + o1_realized;
    } else {
      totalPnL += o0_realized + o1_realized;
    }
  }

  return {
    pnl: totalPnL,
    details: `${conditionCount} conditions, ${rows.length} trade groups`
  };
}

async function main() {
  console.log('=== NegRisk Netting Formula Test ===\n');
  console.log('Wallet                                     | Calculated |       API | Diff %');
  console.log('-'.repeat(85));

  let matches = 0;
  let total = 0;

  for (const wallet of TEST_WALLETS) {
    const [calculated, api] = await Promise.all([
      calculateNettingPnL(wallet),
      getApiPnL(wallet),
    ]);

    if (api !== null) {
      total++;
      const diff = api !== 0 ? Math.abs((calculated.pnl - api) / api * 100) : 0;
      const match = diff < 20 ? '✓' : '✗';
      if (diff < 20) matches++;

      console.log(
        `${wallet} | ${calculated.pnl.toFixed(2).padStart(10)} | ${api.toFixed(2).padStart(9)} | ${diff.toFixed(1).padStart(5)}% ${match}`
      );
    } else {
      console.log(`${wallet} | ${calculated.pnl.toFixed(2).padStart(10)} |    NO API |   N/A`);
    }
  }

  console.log('-'.repeat(85));
  console.log(`\nAccuracy: ${matches}/${total} within 20% of API`);
}

main().catch(console.error);
