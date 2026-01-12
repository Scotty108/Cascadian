/**
 * Forensic Analysis of 3 Failing Wallets
 *
 * Analyzes exact discrepancies between V17 and API for:
 * - spot_3: 0x0060a1843fe53a54e9fdc403005da0b1ead44cc4
 * - spot_6: 0xf380061e3ef5fa4d46341b269f75d57d6dc6c8b0
 * - spot_9: 0x61341f266a614cc511d2f606542b0774688998b0
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';
import { getWalletPnLV17 } from '../lib/pnl/pnlEngineV17';

interface PositionDetail {
  condition_id: string;
  outcome_index: number;
  bought_tokens: number;
  bought_cost: number;
  sold_tokens: number;
  sold_proceeds: number;
  net_tokens: number;
  avg_cost: number;
  is_resolved: boolean;
  resolution_price: number;
  mark_price: number;
  status: string;
  realized_pnl: number;
  unrealized_pnl: number;
  effective_sell: number;
}

async function getDetailedPositions(wallet: string): Promise<PositionDetail[]> {
  const w = wallet.toLowerCase();

  // Simplified: get position data, calculate metrics in TypeScript
  const query = `
    SELECT
      ps.condition_id,
      ps.outcome_index,
      ps.bought_tokens,
      ps.bought_cost,
      ps.sold_tokens,
      ps.sold_proceeds,
      greatest(ps.bought_tokens - ps.sold_tokens, 0) as net_tokens,
      if(ps.bought_tokens > 0, ps.bought_cost / ps.bought_tokens, 0) as avg_cost,
      length(r.norm_prices) > 0 as is_resolved,
      if(length(r.norm_prices) > 0,
         arrayElement(r.norm_prices, toUInt8(ps.outcome_index + 1)),
         toFloat64(0)) as resolution_price,
      coalesce(mp.mark_price, toFloat64(0)) as mark_price
    FROM (
      SELECT
        condition_id,
        outcome_index,
        sumIf(tokens, side='buy') as bought_tokens,
        sumIf(usdc, side='buy') as bought_cost,
        sumIf(tokens, side='sell') as sold_tokens,
        sumIf(usdc, side='sell') as sold_proceeds
      FROM (
        SELECT
          m.condition_id as condition_id,
          m.outcome_index as outcome_index,
          t.side as side,
          max(t.usdc_amount) / 1e6 as usdc,
          max(t.token_amount) / 1e6 as tokens
        FROM pm_trader_events_v3 t
        LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = '${w}'
          AND m.condition_id IS NOT NULL
          AND m.condition_id != ''
        GROUP BY substring(event_id, 1, 66), m.condition_id, m.outcome_index, t.side
      )
      GROUP BY condition_id, outcome_index
    ) ps
    LEFT JOIN pm_condition_resolutions_norm r ON lower(ps.condition_id) = lower(r.condition_id)
    LEFT JOIN pm_latest_mark_price_v1 mp ON lower(ps.condition_id) = lower(mp.condition_id)
      AND ps.outcome_index = mp.outcome_index
    ORDER BY ps.bought_cost + ps.sold_proceeds DESC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  return rows.map(row => {
    const bought_tokens = parseFloat(row.bought_tokens);
    const bought_cost = parseFloat(row.bought_cost);
    const sold_tokens = parseFloat(row.sold_tokens);
    const sold_proceeds = parseFloat(row.sold_proceeds);
    const net_tokens = parseFloat(row.net_tokens);
    const avg_cost = parseFloat(row.avg_cost);
    const is_resolved = Boolean(row.is_resolved);
    const resolution_price = parseFloat(row.resolution_price);
    const mark_price = parseFloat(row.mark_price);

    // Calculate effective sell (with capping)
    const effective_sell = (sold_tokens > bought_tokens && sold_tokens > 0)
      ? sold_proceeds * (bought_tokens / sold_tokens)
      : sold_proceeds;

    // Determine status
    const status = is_resolved ? 'resolved' : (net_tokens === 0 ? 'closed' : 'open');

    // Calculate realized PnL
    let realized_pnl = 0;
    if (is_resolved) {
      realized_pnl = (effective_sell + (net_tokens * resolution_price)) - bought_cost;
    } else if (net_tokens === 0) {
      realized_pnl = effective_sell - bought_cost;
    }

    // Calculate unrealized PnL
    const unrealized_pnl = (!is_resolved && net_tokens > 0 && mark_price > 0)
      ? (net_tokens * mark_price) - (net_tokens * avg_cost)
      : 0;

    return {
      condition_id: row.condition_id,
      outcome_index: parseInt(row.outcome_index),
      bought_tokens,
      bought_cost,
      sold_tokens,
      sold_proceeds,
      net_tokens,
      avg_cost,
      is_resolved,
      resolution_price,
      mark_price,
      status,
      realized_pnl,
      unrealized_pnl,
      effective_sell,
    };
  }).filter(p => Math.abs(p.realized_pnl) > 0.01 || Math.abs(p.unrealized_pnl) > 0.01)
    .sort((a, b) => Math.abs(b.realized_pnl + b.unrealized_pnl) - Math.abs(a.realized_pnl + a.unrealized_pnl));
}

async function getApiPnl(wallet: string): Promise<number | null> {
  try {
    const url = `https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet.toLowerCase()}`;
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json() as Array<{ t: number; p: number }>;
      if (data && data.length > 0) {
        return data[data.length - 1].p;
      }
    }
  } catch (e) {
    console.error(`API error for ${wallet}:`, e);
  }
  return null;
}

async function analyzeWallet(name: string, wallet: string) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`WALLET: ${name}`);
  console.log(`ADDRESS: ${wallet}`);
  console.log(`${'='.repeat(80)}\n`);

  const [v17Result, apiPnl, positions] = await Promise.all([
    getWalletPnLV17(wallet),
    getApiPnl(wallet),
    getDetailedPositions(wallet),
  ]);

  console.log('V17 PnL:', v17Result.totalPnl.toFixed(2));
  console.log('API PnL:', apiPnl?.toFixed(2) ?? 'N/A');
  console.log('Difference:', apiPnl ? (v17Result.totalPnl - apiPnl).toFixed(2) : 'N/A');
  console.log('\nMetrics:');
  console.log('- Realized PnL:', v17Result.realizedPnl.toFixed(2));
  console.log('- Unrealized PnL:', v17Result.unrealizedPnl.toFixed(2));
  console.log('- Open positions:', v17Result.openPositionCount);
  console.log('- Closed positions:', v17Result.closedPositionCount);
  console.log('- Neg Risk conversions:', v17Result.negRiskConversionCount);
  console.log('- Bundled txs:', v17Result.bundledTxCount);
  console.log('- Confidence:', v17Result.confidence);
  console.log(`- Positions with PnL: ${positions?.length ?? 0}`);

  if (!positions || positions.length === 0) {
    console.log('\nNO POSITIONS WITH SIGNIFICANT PNL FOUND');
    return {
      name,
      wallet,
      v17Pnl: v17Result.totalPnl,
      apiPnl,
      difference: apiPnl ? v17Result.totalPnl - apiPnl : null,
      positions: [],
      cappedPositions: [],
      oversoldCount: 0,
      negRiskCount: v17Result.negRiskConversionCount,
      bundledCount: v17Result.bundledTxCount,
    };
  }

  console.log(`\n${'─'.repeat(80)}`);
  console.log('TOP POSITIONS BY IMPACT (Sorted by |PnL|)');
  console.log(`${'─'.repeat(80)}\n`);

  const topPositions = positions.slice(0, 10);
  for (const pos of topPositions) {
    const totalImpact = pos.realized_pnl + pos.unrealized_pnl;
    const condId = pos.condition_id || 'unknown';
    console.log(`Condition: ${condId.substring(0, 16)}... (outcome ${pos.outcome_index})`);
    console.log(`  Status: ${pos.status.toUpperCase()}`);
    console.log(`  Bought: ${pos.bought_tokens.toFixed(2)} @ $${pos.avg_cost.toFixed(4)} = $${pos.bought_cost.toFixed(2)}`);
    console.log(`  Sold: ${pos.sold_tokens.toFixed(2)} for $${pos.sold_proceeds.toFixed(2)} (effective: $${pos.effective_sell.toFixed(2)})`);
    console.log(`  Net Position: ${pos.net_tokens.toFixed(2)} tokens`);
    if (pos.is_resolved) {
      console.log(`  Resolution Price: $${pos.resolution_price.toFixed(4)}`);
    } else if (pos.mark_price > 0) {
      console.log(`  Mark Price: $${pos.mark_price.toFixed(4)}`);
    }
    console.log(`  Realized PnL: $${pos.realized_pnl.toFixed(2)}`);
    console.log(`  Unrealized PnL: $${pos.unrealized_pnl.toFixed(2)}`);
    console.log(`  TOTAL IMPACT: $${totalImpact.toFixed(2)}`);
    console.log();
  }

  // Check for positions where effective_sell != sold_proceeds (capping applied)
  const cappedPositions = positions.filter(p =>
    Math.abs(p.effective_sell - p.sold_proceeds) > 0.01
  );

  if (cappedPositions.length > 0) {
    console.log(`${'─'.repeat(80)}`);
    console.log(`CAPPED POSITIONS (${cappedPositions.length} positions)`);
    console.log('These positions had sell proceeds capped due to sold > bought');
    console.log(`${'─'.repeat(80)}\n`);

    for (const pos of cappedPositions.slice(0, 5)) {
      const condId = pos.condition_id || 'unknown';
      console.log(`Condition: ${condId.substring(0, 16)}... (outcome ${pos.outcome_index})`);
      console.log(`  Bought: ${pos.bought_tokens.toFixed(2)} tokens`);
      console.log(`  Sold: ${pos.sold_tokens.toFixed(2)} tokens (OVERSOLD by ${(pos.sold_tokens - pos.bought_tokens).toFixed(2)})`);
      console.log(`  Original sell proceeds: $${pos.sold_proceeds.toFixed(2)}`);
      console.log(`  Capped sell proceeds: $${pos.effective_sell.toFixed(2)}`);
      console.log(`  Difference: $${(pos.sold_proceeds - pos.effective_sell).toFixed(2)}`);
      console.log();
    }
  }

  // Pattern analysis
  const resolvedCount = positions.filter(p => p.is_resolved).length;
  const closedCount = positions.filter(p => p.status === 'closed').length;
  const openCount = positions.filter(p => p.status === 'open').length;
  const oversoldCount = positions.filter(p => p.sold_tokens > p.bought_tokens).length;

  console.log(`${'─'.repeat(80)}`);
  console.log('PATTERN SUMMARY');
  console.log(`${'─'.repeat(80)}\n`);
  console.log(`Total positions analyzed: ${positions.length}`);
  console.log(`- Resolved: ${resolvedCount} (${(resolvedCount/positions.length*100).toFixed(1)}%)`);
  console.log(`- Closed (not resolved): ${closedCount} (${(closedCount/positions.length*100).toFixed(1)}%)`);
  console.log(`- Open: ${openCount} (${(openCount/positions.length*100).toFixed(1)}%)`);
  console.log(`- Oversold positions: ${oversoldCount} (${(oversoldCount/positions.length*100).toFixed(1)}%)`);
  console.log(`- Positions with capping: ${cappedPositions.length} (${(cappedPositions.length/positions.length*100).toFixed(1)}%)`);

  return {
    name,
    wallet,
    v17Pnl: v17Result.totalPnl,
    apiPnl,
    difference: apiPnl ? v17Result.totalPnl - apiPnl : null,
    positions,
    cappedPositions,
    oversoldCount,
    negRiskCount: v17Result.negRiskConversionCount,
    bundledCount: v17Result.bundledTxCount,
  };
}

async function main() {
  console.log('FORENSIC ANALYSIS OF 3 FAILING WALLETS');
  console.log('Identifying common patterns causing PnL discrepancies\n');

  const wallets = [
    { name: 'spot_3', address: '0x0060a1843fe53a54e9fdc403005da0b1ead44cc4' },
    { name: 'spot_6', address: '0xf380061e3ef5fa4d46341b269f75d57d6dc6c8b0' },
    { name: 'spot_9', address: '0x61341f266a614cc511d2f606542b0774688998b0' },
  ];

  const results = [];
  for (const w of wallets) {
    const result = await analyzeWallet(w.name, w.address);
    results.push(result);
  }

  // Cross-wallet analysis
  console.log(`\n${'='.repeat(80)}`);
  console.log('CROSS-WALLET PATTERN ANALYSIS');
  console.log(`${'='.repeat(80)}\n`);

  console.log('Discrepancies:');
  for (const r of results) {
    console.log(`- ${r.name}: V17=$${r.v17Pnl.toFixed(2)}, API=$${r.apiPnl?.toFixed(2) ?? 'N/A'}, Diff=$${r.difference?.toFixed(2) ?? 'N/A'}`);
  }

  console.log('\nNeg Risk Usage:');
  for (const r of results) {
    console.log(`- ${r.name}: ${r.negRiskCount} conversions`);
  }

  console.log('\nBundled Transactions:');
  for (const r of results) {
    console.log(`- ${r.name}: ${r.bundledCount} bundled txs`);
  }

  console.log('\nOversold Positions:');
  for (const r of results) {
    console.log(`- ${r.name}: ${r.oversoldCount} positions (${(r.oversoldCount/r.positions.length*100).toFixed(1)}%)`);
  }

  console.log('\nPositions with Sell Capping:');
  for (const r of results) {
    console.log(`- ${r.name}: ${r.cappedPositions.length} positions (${(r.cappedPositions.length/r.positions.length*100).toFixed(1)}%)`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('HYPOTHESIS: COMMON PATTERN');
  console.log('='.repeat(80));
  console.log(`
All 3 wallets show:
1. High bundled transaction rate (${results.reduce((s, r) => s + r.bundledCount, 0)} total bundled txs)
2. Low Neg Risk usage (${results.reduce((s, r) => s + r.negRiskCount, 0)} total conversions)
3. Multiple oversold positions (positions where sold > bought)
4. Systematic underestimation of PnL by V17

The pattern suggests these wallets use WITHIN-BUNDLE POSITION TRANSFERS
(buying/selling same condition across different outcomes in one transaction)
that our position tracking doesn't properly account for.

Unlike high Neg Risk wallets where we OVERESTIMATE due to phantom trades,
these wallets are UNDERESTIMATED due to missed position value from
cross-outcome arbitrage or hedging strategies within bundled transactions.
  `.trim());
}

main().catch(console.error);
