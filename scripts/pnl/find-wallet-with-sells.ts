#!/usr/bin/env npx tsx
/**
 * Find HC wallet with significant sell profit for validation
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
}

async function computeWalletProfit(wallet: string): Promise<{
  wallet: string;
  realized_profit: number;
  breakdown: {
    redemption_profit: number;
    sell_profit: number;
    unredeemed_loss: number;
  };
}> {
  const walletLower = wallet.toLowerCase();

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

  const redemptionsQ = await clickhouse.query({
    query: `
      SELECT condition_id, redemption_payout
      FROM pm_redemption_payouts_agg
      WHERE lower(wallet) = '${walletLower}'
    `,
    format: 'JSONEachRow'
  });
  const redemptions = await redemptionsQ.json() as Redemption[];

  const redemptionMap = new Map<string, number>();
  for (const r of redemptions) {
    redemptionMap.set(r.condition_id.toLowerCase(), Number(r.redemption_payout));
  }

  const resolutionQ = await clickhouse.query({
    query: `
      SELECT
        lower(condition_id) as condition_id,
        payout_numerators
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
    const numerators = JSON.parse(r.payout_numerators || '[0,0]');
    resolutionMap.set(r.condition_id, {
      payout_0: numerators[0] > 0 ? 1 : 0,
      payout_1: numerators[1] > 0 ? 1 : 0
    });
  }

  let redemptionProfit = 0;
  let sellProfit = 0;
  let unredeemedLoss = 0;

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
        continue;
      }

      const costBasis = Number(pos.net_tokens) * Number(pos.avg_buy_price);

      // Real sells
      if (Number(pos.sell_tokens) > 0 && Number(pos.buy_tokens) > 0) {
        const sellCost = Number(pos.sell_tokens) * Number(pos.avg_buy_price);
        sellProfit += Number(pos.sell_usdc) - sellCost;
      }

      // Resolution
      if (Number(pos.net_tokens) > 0) {
        if (redemption > 0 || resolution) {
          const payout = resolution?.[`payout_${pos.outcome_index}` as 'payout_0' | 'payout_1'] || 0;

          if (payout > 0) {
            redemptionProfit += Number(pos.net_tokens) * payout - costBasis;
          } else if (resolution) {
            unredeemedLoss -= costBasis;
          }
        }
      }
    }
  }

  return {
    wallet,
    realized_profit: redemptionProfit + sellProfit + unredeemedLoss,
    breakdown: {
      redemption_profit: redemptionProfit,
      sell_profit: sellProfit,
      unredeemed_loss: unredeemedLoss,
    }
  };
}

async function main() {
  // Get HC wallets
  const walletsQ = await clickhouse.query({
    query: `SELECT wallet FROM pm_wallet_classification_v1 WHERE is_hc = 1 LIMIT 50`,
    format: 'JSONEachRow'
  });
  const wallets = (await walletsQ.json() as any[]).map(w => w.wallet);

  console.log('SCANNING HC WALLETS FOR SELL PROFIT');
  console.log('='.repeat(100));

  const walletsWithSells: any[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    try {
      const result = await computeWalletProfit(wallet);

      if (Math.abs(result.breakdown.sell_profit) > 10) {
        walletsWithSells.push({
          wallet,
          ...result.breakdown,
          realized_profit: result.realized_profit
        });
        console.log(`✅ ${wallet.slice(0, 16)}... | sell_profit: $${result.breakdown.sell_profit.toFixed(2)} | redemption: $${result.breakdown.redemption_profit.toFixed(2)} | loss: $${result.breakdown.unredeemed_loss.toFixed(2)}`);
      }

      if ((i + 1) % 10 === 0) {
        console.log(`  Scanned ${i + 1}/${wallets.length} wallets...`);
      }
    } catch (e) {
      // Skip errors
    }
  }

  console.log('\n' + '='.repeat(100));
  console.log(`Found ${walletsWithSells.length} wallets with sell_profit > $10`);

  if (walletsWithSells.length > 0) {
    console.log('\nTop wallets with sell profit:');
    walletsWithSells.sort((a, b) => Math.abs(b.sell_profit) - Math.abs(a.sell_profit));
    for (const w of walletsWithSells.slice(0, 5)) {
      console.log(`  ${w.wallet}`);
      console.log(`    Sell Profit: $${w.sell_profit.toFixed(2)}`);
      console.log(`    Redemption:  $${w.redemption_profit.toFixed(2)}`);
      console.log(`    Loss:        $${w.unredeemed_loss.toFixed(2)}`);
      console.log(`    TOTAL:       $${w.realized_profit.toFixed(2)}`);
    }
  }

  await clickhouse.close();
}

main().catch(console.error);
