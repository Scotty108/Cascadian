/**
 * PnL V31 Batch Test - Test realized-only approach on multiple wallets
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const COLLATERAL_SCALE = 1000000;
const BATCH_SIZE = 1000;

interface Position {
  amount: number;
  avgPrice: number;
  realizedPnl: number;
}

async function fetchApiPnl(wallet: string): Promise<number | null> {
  try {
    const url = `https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet.toLowerCase()}`;
    const response = await fetch(url);
    if (response.ok) {
      const data = (await response.json()) as Array<{ t: number; p: number }>;
      if (data && data.length > 0) return data[data.length - 1].p;
    }
  } catch {}
  return null;
}

function updatePositionWithBuy(pos: Position, amount: number, price: number): void {
  if (pos.amount + amount > 0) {
    pos.avgPrice = Math.round((pos.avgPrice * pos.amount + price * amount) / (pos.amount + amount));
  }
  pos.amount += amount;
}

function updatePositionWithSell(pos: Position, amount: number, price: number): void {
  const adjustedAmount = Math.min(amount, Math.max(0, pos.amount));
  if (adjustedAmount > 0) {
    const deltaPnl = (adjustedAmount * (price - pos.avgPrice)) / COLLATERAL_SCALE;
    pos.realizedPnl += deltaPnl;
    pos.amount -= adjustedAmount;
  }
}

async function batchFetchResolutions(conditionIds: string[]): Promise<Map<string, number[]>> {
  const resolutions = new Map<string, number[]>();
  if (conditionIds.length === 0) return resolutions;

  for (let i = 0; i < conditionIds.length; i += BATCH_SIZE) {
    const batch = conditionIds.slice(i, i + BATCH_SIZE);
    const idList = batch.map(id => `'${id}'`).join(',');
    const resResult = await clickhouse.query({
      query: `SELECT lower(condition_id) as condition_id, norm_prices FROM pm_condition_resolutions_norm WHERE lower(condition_id) IN (${idList})`,
      format: 'JSONEachRow',
    });
    const resRows = await resResult.json() as any[];
    for (const row of resRows) {
      resolutions.set(row.condition_id, row.norm_prices);
    }
  }
  return resolutions;
}

async function hasNegRiskConversions(wallet: string): Promise<boolean> {
  const result = await clickhouse.query({
    query: `
      SELECT count() as cnt
      FROM pm_neg_risk_conversions_v1
      WHERE lower(user_address) = '${wallet.toLowerCase()}'
      LIMIT 1
    `,
    format: 'JSONEachRow',
  });
  const rows = await result.json() as any[];
  return rows[0]?.cnt > 0;
}

async function calculatePnL(wallet: string): Promise<number> {
  const positions = new Map<string, Position>();

  const getPosition = (conditionId: string, outcomeIndex: number): Position => {
    const key = `${conditionId}_${outcomeIndex}`;
    if (!positions.has(key)) {
      positions.set(key, { amount: 0, avgPrice: 0, realizedPnl: 0 });
    }
    return positions.get(key)!;
  };

  // Get CLOB trades
  const clobResult = await clickhouse.query({
    query: `
      SELECT
        toUnixTimestamp(t.trade_time) as ts,
        lower(m.condition_id) as condition_id,
        m.outcome_index,
        t.side,
        max(t.token_amount) as tokens,
        max(t.usdc_amount) as usdc
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${wallet.toLowerCase()}'
        AND m.condition_id IS NOT NULL
      GROUP BY t.trade_time, m.condition_id, m.outcome_index, t.side
      ORDER BY ts ASC
    `,
    format: 'JSONEachRow',
  });

  const clobRows = await clobResult.json() as any[];
  for (const row of clobRows) {
    const price = Math.round((row.usdc * COLLATERAL_SCALE) / row.tokens);
    const pos = getPosition(row.condition_id, row.outcome_index);
    const amount = row.tokens / 1e6;

    if (row.side.toLowerCase() === 'buy') {
      updatePositionWithBuy(pos, amount, price);
    } else {
      updatePositionWithSell(pos, amount, price);
    }
  }

  // Get redemptions
  const redemptionResult = await clickhouse.query({
    query: `
      SELECT
        lower(condition_id) as condition_id,
        toFloat64OrZero(amount_or_payout) as amount
      FROM pm_ctf_events
      WHERE lower(user_address) = '${wallet.toLowerCase()}'
        AND event_type = 'PayoutRedemption'
        AND is_deleted = 0
    `,
    format: 'JSONEachRow',
  });

  const redemptionRows = await redemptionResult.json() as any[];
  const redemptionConditionIds = [...new Set(redemptionRows.map((r: any) => r.condition_id))];
  const resolutions = await batchFetchResolutions(redemptionConditionIds);

  for (const row of redemptionRows) {
    const prices = resolutions.get(row.condition_id) ?? [0.5, 0.5];
    const winningOutcome = prices[0] > prices[1] ? 0 : 1;
    const pos = getPosition(row.condition_id, winningOutcome);
    updatePositionWithSell(pos, row.amount / 1e6, COLLATERAL_SCALE);
  }

  let totalRealizedPnl = 0;
  for (const pos of positions.values()) {
    totalRealizedPnl += pos.realizedPnl;
  }

  return totalRealizedPnl;
}

async function main() {
  // Test wallets - mix of simple and complex
  const testWallets = [
    '0x1f3178c3f82eee8e67018473b8fc33b3dc7806cb', // Simple wallet (our test case)
    '0xb7d54bf1d0a362beb916d9cb58a04c41d67e0789', // Heavy Neg Risk user
    '0x8b7b5c3e0b1a9c2d5f1e2a3b4c5d6e7f8a9b0c1d', // Random
    '0xa1b2c3d4e5f6789012345678901234567890abcd', // Random
  ];

  // Get some random wallets from the database
  const randomResult = await clickhouse.query({
    query: `
      SELECT DISTINCT trader_wallet
      FROM pm_trader_events_v3
      WHERE trade_time > now() - INTERVAL 30 DAY
      ORDER BY rand()
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const randomRows = await randomResult.json() as any[];
  const randomWallets = randomRows.map((r: any) => r.trader_wallet);

  const allWallets = [...testWallets.slice(0, 2), ...randomWallets.slice(0, 8)];

  console.log('\n=== PNL V31 BATCH TEST ===\n');
  console.log('wallet                                     | V31 PnL    | API PnL    | Diff       | %Diff    | NegRisk | Result');
  console.log('-'.repeat(120));

  let matchCount = 0;
  let closeCount = 0;
  let mismatchCount = 0;
  let noApiCount = 0;

  for (const wallet of allWallets) {
    try {
      const [pnl, apiPnl, hasNegRisk] = await Promise.all([
        calculatePnL(wallet),
        fetchApiPnl(wallet),
        hasNegRiskConversions(wallet),
      ]);

      if (apiPnl === null) {
        console.log(`${wallet} | $${pnl.toFixed(2).padStart(8)} | N/A        | N/A        | N/A      | ${hasNegRisk ? 'YES' : 'NO'} | NO API`);
        noApiCount++;
        continue;
      }

      const diff = pnl - apiPnl;
      const pctDiff = apiPnl !== 0 ? (diff / Math.abs(apiPnl)) * 100 : 0;

      let result: string;
      if (Math.abs(pctDiff) < 1) {
        result = '✓ MATCH';
        matchCount++;
      } else if (Math.abs(pctDiff) < 10) {
        result = '~ CLOSE';
        closeCount++;
      } else {
        result = '✗ MISMATCH';
        mismatchCount++;
      }

      console.log(
        `${wallet} | ` +
        `$${pnl.toFixed(2).padStart(8)} | ` +
        `$${apiPnl.toFixed(2).padStart(8)} | ` +
        `$${diff.toFixed(2).padStart(8)} | ` +
        `${pctDiff.toFixed(1).padStart(6)}% | ` +
        `${hasNegRisk ? 'YES' : 'NO '.padEnd(3)} | ` +
        result
      );
    } catch (err: any) {
      console.log(`${wallet} | ERROR: ${err.message?.substring(0, 50) ?? 'Unknown'}`);
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Matches (<1%): ${matchCount}`);
  console.log(`Close (<10%): ${closeCount}`);
  console.log(`Mismatches: ${mismatchCount}`);
  console.log(`No API data: ${noApiCount}`);
  console.log(`Total: ${allWallets.length}`);

  process.exit(0);
}

main().catch(console.error);
