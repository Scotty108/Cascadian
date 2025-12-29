#!/usr/bin/env npx tsx
/**
 * Compute Realized Profit V1
 *
 * Correct formula that handles synthetic positions properly.
 *
 * For HC wallets (CLOB only, no splits/merges, no transfers):
 * - A "sell" on an outcome where you never bought is SYNTHETIC (not a cash inflow)
 * - A "sell" on an outcome where you DID buy is a real sale (profit = sell - cost_basis)
 *
 * Realized profit per market:
 * - If outcome resolved to $1 and you held tokens: profit = tokens - cost_basis
 * - If outcome resolved to $0 and you held tokens: loss = -cost_basis
 * - Real sells: profit = sell_usdc - (sell_tokens * avg_cost)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

interface MarketPosition {
  condition_id: string;
  outcome_index: number;
  buy_usdc: number;
  sell_usdc: number;
  buy_tokens: number;
  sell_tokens: number;
  net_tokens: number;
  avg_buy_price: number;
}

interface Redemption {
  condition_id: string;
  redemption_payout: number;
  redemption_count: number;
}

async function computeWalletProfit(wallet: string): Promise<{
  wallet: string;
  realized_profit: number;
  net_cash: number;
  breakdown: {
    redemption_profit: number;
    sell_profit: number;
    unredeemed_loss: number;
  };
}> {
  const walletLower = wallet.toLowerCase();

  // Get positions per condition/outcome
  const positionsQ = await clickhouse.query({
    query: `
      SELECT
        m.condition_id,
        m.outcome_index,
        sumIf(usdc_amount, side = 'buy') / 1e6 as buy_usdc,
        sumIf(usdc_amount, side = 'sell') / 1e6 as sell_usdc,
        sumIf(token_amount, side = 'buy') / 1e6 as buy_tokens,
        sumIf(token_amount, side = 'sell') / 1e6 as sell_tokens,
        (sumIf(token_amount, side = 'buy') - sumIf(token_amount, side = 'sell')) / 1e6 as net_tokens,
        CASE WHEN sumIf(token_amount, side = 'buy') > 0 
             THEN sumIf(usdc_amount, side = 'buy') / sumIf(token_amount, side = 'buy') 
             ELSE 0 END as avg_buy_price
      FROM (
        SELECT event_id, any(side) as side, any(usdc_amount) as usdc_amount,
               any(token_amount) as token_amount, any(token_id) as token_id
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = '${walletLower}'
        GROUP BY event_id
      ) t
      JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
      GROUP BY m.condition_id, m.outcome_index
    `,
    format: 'JSONEachRow'
  });
  const positions = await positionsQ.json() as MarketPosition[];

  // Get redemptions
  const redemptionsQ = await clickhouse.query({
    query: `
      SELECT condition_id, redemption_payout, redemption_count
      FROM pm_redemption_payouts_agg
      WHERE lower(wallet) = '${walletLower}'
    `,
    format: 'JSONEachRow'
  });
  const redemptions = await redemptionsQ.json() as Redemption[];

  // Build redemption map
  const redemptionMap = new Map<string, number>();
  for (const r of redemptions) {
    redemptionMap.set(r.condition_id.toLowerCase(), Number(r.redemption_payout));
  }

  // Get resolution prices
  // Note: payout_numerators is stored as string like '[1,0]', payout_denominator as string like '2'
  const resolutionQ = await clickhouse.query({
    query: `
      SELECT
        lower(condition_id) as condition_id,
        payout_numerators,
        payout_denominator
      FROM pm_condition_resolutions
      WHERE lower(condition_id) IN (
        SELECT DISTINCT lower(m.condition_id)
        FROM (
          SELECT event_id, any(token_id) as token_id
          FROM pm_trader_events_v2
          WHERE lower(trader_wallet) = '${walletLower}'
          GROUP BY event_id
        ) t
        JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
      )
    `,
    format: 'JSONEachRow'
  });
  const resolutions = await resolutionQ.json() as any[];
  const resolutionMap = new Map<string, { payout_0: number; payout_1: number }>();
  for (const r of resolutions) {
    // Parse the JSON string
    // payout_numerators: [0,1] means outcome 0 = $0, outcome 1 = $1
    // The denominator is NOT for division - it's just metadata (typically 2 for binary)
    const numerators = JSON.parse(r.payout_numerators || '[0,0]');
    resolutionMap.set(r.condition_id, {
      payout_0: numerators[0] > 0 ? 1 : 0,  // 1 if winning, 0 if losing
      payout_1: numerators[1] > 0 ? 1 : 0
    });
  }

  // Calculate realized profit
  let redemptionProfit = 0;
  let sellProfit = 0;
  let unredeemedLoss = 0;

  // Group positions by condition
  const conditionPositions = new Map<string, MarketPosition[]>();
  for (const pos of positions) {
    const condId = pos.condition_id.toLowerCase();
    if (!conditionPositions.has(condId)) {
      conditionPositions.set(condId, []);
    }
    conditionPositions.get(condId)!.push(pos);
  }

  for (const [conditionId, condPositions] of conditionPositions) {
    const redemption = redemptionMap.get(conditionId) || 0;
    const resolution = resolutionMap.get(conditionId);

    for (const pos of condPositions) {
      const isSynthetic = Number(pos.buy_tokens) === 0 && Number(pos.sell_tokens) > 0;
      
      if (isSynthetic) {
        // Synthetic sell - don't count as profit/loss
        continue;
      }

      // Calculate cost basis of remaining tokens
      const costBasis = Number(pos.net_tokens) * Number(pos.avg_buy_price);

      // Real sells (where we bought and sold)
      if (Number(pos.sell_tokens) > 0 && Number(pos.buy_tokens) > 0) {
        const sellCost = Number(pos.sell_tokens) * Number(pos.avg_buy_price);
        sellProfit += Number(pos.sell_usdc) - sellCost;
      }

      // Redemption or resolution
      if (Number(pos.net_tokens) > 0) {
        if (redemption > 0) {
          // Find if this position got redeemed
          // Redemption payout = tokens (at $1 each)
          const tokens = Number(pos.net_tokens);
          const payout = resolution?.[`payout_${pos.outcome_index}` as 'payout_0' | 'payout_1'] || 0;
          
          if (payout > 0) {
            // This outcome won - profit = payout - cost
            redemptionProfit += tokens * payout - costBasis;
          } else {
            // This outcome lost - loss = cost basis
            unredeemedLoss -= costBasis;
          }
        } else if (resolution) {
          // Market resolved but no redemption yet
          const payout = resolution[`payout_${pos.outcome_index}` as 'payout_0' | 'payout_1'] || 0;
          if (payout > 0) {
            redemptionProfit += Number(pos.net_tokens) * payout - costBasis;
          } else {
            unredeemedLoss -= costBasis;
          }
        }
        // Unresolved positions don't count towards realized
      }
    }
  }

  // Net cash for comparison
  let totalBuy = 0, totalSell = 0, totalRedemption = 0;
  for (const pos of positions) {
    totalBuy += Number(pos.buy_usdc);
    totalSell += Number(pos.sell_usdc);
  }
  for (const r of redemptions) {
    totalRedemption += Number(r.redemption_payout);
  }
  const netCash = totalSell - totalBuy + totalRedemption;

  const realizedProfit = redemptionProfit + sellProfit + unredeemedLoss;

  return {
    wallet,
    realized_profit: realizedProfit,
    net_cash: netCash,
    breakdown: {
      redemption_profit: redemptionProfit,
      sell_profit: sellProfit,
      unredeemed_loss: unredeemedLoss,
    }
  };
}

async function main() {
  const wallets = [
    '0x132b505596fadb6971bbb0fbded509421baf3a16',  // Wallet 2 - UI shows $2068.50
    '0x0030490676215689d0764b54c135d47f2c310513',  // Wallet 5
    '0x3d6d9dcc4f40d6447bb650614acc385ff3820dd1',  // Wallet 1
  ];

  console.log('REALIZED PROFIT COMPUTATION V1');
  console.log('='.repeat(100));
  console.log('Formula: Exclude synthetic sells (sells where buy_tokens = 0)');
  console.log('');

  for (const wallet of wallets) {
    console.log('='.repeat(100));
    console.log(`WALLET: ${wallet}`);
    console.log('-'.repeat(100));

    const result = await computeWalletProfit(wallet);

    console.log(`  Redemption Profit: $${result.breakdown.redemption_profit.toFixed(2)}`);
    console.log(`  Sell Profit:       $${result.breakdown.sell_profit.toFixed(2)}`);
    console.log(`  Unredeemed Loss:   $${result.breakdown.unredeemed_loss.toFixed(2)}`);
    console.log(`  ----------------------------------------`);
    console.log(`  REALIZED PROFIT:   $${result.realized_profit.toFixed(2)}`);
    console.log(`  NET-CASH (old):    $${result.net_cash.toFixed(2)}`);
    console.log('');
  }

  await clickhouse.close();
}

main().catch(console.error);
