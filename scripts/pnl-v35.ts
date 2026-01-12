import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const AMOUNT_TOLERANCE = 0.05;

async function fetchApiPnl(wallet) {
  try {
    const url = 'https://user-pnl-api.polymarket.com/user-pnl?user_address=' + wallet.toLowerCase();
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      if (data && data.length > 0) return data[data.length - 1].p;
    }
  } catch {}
  return null;
}

async function calculatePnl(wallet) {
  console.log('\n=== PNL V35 (STRICT BUNDLE REWRITE) FOR ' + wallet.substring(0, 10) + '... ===');

  const result = await clickhouse.query({
    query: `
      SELECT
        substring(t.event_id, 1, 66) as tx_hash,
        lower(m.condition_id) as condition_id,
        m.outcome_index,
        t.side,
        sum(t.usdc_amount) / 1000000.0 as usdc,
        sum(t.token_amount) / 1000000.0 as tokens,
        max(toUnixTimestamp(t.trade_time)) as ts
      FROM pm_trader_events_v3 t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${wallet.toLowerCase()}'
        AND m.condition_id IS NOT NULL AND m.condition_id != ''
      GROUP BY tx_hash, m.condition_id, m.outcome_index, t.side
      ORDER BY ts ASC
    `,
    format: 'JSONEachRow'
  });
  const trades = await result.json() as any[];
  console.log('Total trade rows: ' + trades.length);

  const txGroups = new Map();
  for (const t of trades) {
    const key = t.condition_id + '_' + t.tx_hash;
    if (!txGroups.has(key)) txGroups.set(key, []);
    txGroups.get(key).push(t);
  }

  const positions = new Map();
  const getPos = (cid, oi) => {
    const key = cid + '_' + oi;
    if (!positions.has(key)) positions.set(key, { amount: 0, totalCost: 0, avgPrice: 0 });
    return positions.get(key);
  };

  const skipTrades = new Set();
  let bundleRewrites = 0;
  const bundleAdjustments = new Map();

  for (const [txKey, group] of txGroups) {
    const buys = group.filter(t => t.side === 'buy');
    const sells = group.filter(t => t.side === 'sell');

    if (buys.length !== 1 || sells.length !== 1) continue;

    const buyTrade = buys[0];
    const sellTrade = sells[0];

    if (buyTrade.outcome_index === sellTrade.outcome_index) continue;

    const isBinary =
      (buyTrade.outcome_index === 0 && sellTrade.outcome_index === 1) ||
      (buyTrade.outcome_index === 1 && sellTrade.outcome_index === 0);
    if (!isBinary) continue;

    const maxAmt = Math.max(buyTrade.tokens, sellTrade.tokens);
    const amountDiff = Math.abs(buyTrade.tokens - sellTrade.tokens) / maxAmt;
    if (amountDiff > AMOUNT_TOLERANCE) continue;

    bundleRewrites++;

    const adjustedCost = Math.max(0, buyTrade.usdc - sellTrade.usdc);
    bundleAdjustments.set(txKey, {
      buyOutcome: buyTrade.outcome_index,
      adjustedCost,
      sellOutcome: sellTrade.outcome_index
    });

    skipTrades.add(txKey + '_sell_' + sellTrade.outcome_index);
  }

  console.log('Bundle rewrites: ' + bundleRewrites);

  let realizedPnl = 0;
  let regularTrades = 0;

  for (const t of trades) {
    const txKey = t.condition_id + '_' + t.tx_hash;
    const pos = getPos(t.condition_id, t.outcome_index);

    const skipKey = txKey + '_sell_' + t.outcome_index;
    if (skipTrades.has(skipKey)) {
      continue;
    }

    regularTrades++;

    if (t.side === 'buy') {
      let costToAdd = t.usdc;

      const bundle = bundleAdjustments.get(txKey);
      if (bundle && bundle.buyOutcome === t.outcome_index) {
        const oppositePos = getPos(t.condition_id, bundle.sellOutcome);
        if (oppositePos.amount < 0.001) {
          costToAdd = bundle.adjustedCost;
        }
      }

      const newAmount = pos.amount + t.tokens;
      if (newAmount > 0) {
        pos.totalCost = pos.totalCost + costToAdd;
        pos.avgPrice = pos.totalCost / newAmount;
      }
      pos.amount = newAmount;
    } else {
      const sellAmount = Math.min(t.tokens, pos.amount);
      if (sellAmount > 0) {
        const sellProceeds = (sellAmount / t.tokens) * t.usdc;
        const costBasis = sellAmount * pos.avgPrice;
        realizedPnl += sellProceeds - costBasis;

        pos.amount -= sellAmount;
        pos.totalCost = pos.amount * pos.avgPrice;
      }
    }
  }

  console.log('Regular trades: ' + regularTrades);
  console.log('Realized (trades): $' + realizedPnl.toFixed(2));

  const redemptionResult = await clickhouse.query({
    query: `
      SELECT
        lower(condition_id) as condition_id,
        sum(toFloat64OrZero(amount_or_payout)) / 1000000.0 as redeemed_amount
      FROM pm_ctf_events
      WHERE lower(user_address) = '${wallet.toLowerCase()}'
        AND event_type = 'PayoutRedemption'
        AND is_deleted = 0
      GROUP BY condition_id
    `,
    format: 'JSONEachRow'
  });
  const redemptions = await redemptionResult.json() as any[];

  const redeemedConditions = redemptions.map(r => r.condition_id);
  const resolutions = new Map();

  if (redeemedConditions.length > 0) {
    const idList = redeemedConditions.map(id => "'" + id + "'").join(',');
    const resResult = await clickhouse.query({
      query: 'SELECT lower(condition_id) as condition_id, norm_prices FROM pm_condition_resolutions_norm WHERE lower(condition_id) IN (' + idList + ')',
      format: 'JSONEachRow'
    });
    for (const row of await resResult.json() as any[]) {
      resolutions.set(row.condition_id, row.norm_prices);
    }
  }

  let redemptionPnl = 0;
  for (const r of redemptions) {
    const prices = resolutions.get(r.condition_id);
    if (!prices) continue;

    const winningOutcome = prices.indexOf(1);
    if (winningOutcome === -1) continue;

    const pos = getPos(r.condition_id, winningOutcome);
    if (pos.amount > 0.001) {
      const redeemAmount = Math.min(r.redeemed_amount, pos.amount);
      const proceeds = redeemAmount * 1.0;
      const costBasis = redeemAmount * pos.avgPrice;
      redemptionPnl += proceeds - costBasis;

      pos.amount -= redeemAmount;
      pos.totalCost = pos.amount * pos.avgPrice;
    }
  }

  console.log('Realized (redemptions): $' + redemptionPnl.toFixed(2));

  const totalRealized = realizedPnl + redemptionPnl;
  const apiPnl = await fetchApiPnl(wallet);

  console.log('Total Realized: $' + totalRealized.toFixed(2));
  console.log('API: $' + (apiPnl !== null ? apiPnl.toFixed(2) : 'N/A'));

  if (apiPnl !== null) {
    const diff = totalRealized - apiPnl;
    const pct = (diff / Math.abs(apiPnl)) * 100;
    console.log('Diff: $' + diff.toFixed(2) + ' (' + pct.toFixed(1) + '%)');
  }

  return { realized: totalRealized, apiPnl };
}

async function main() {
  const results = [];
  const wallets = [
    '0x1f3178c3f82eee8e67018473b8fc33b3dc7806cb',
    '0x3eee293c5dee12a7aa692e21c4b50bb8fc3fe8b6',
  ];

  for (const w of wallets) {
    const r = await calculatePnl(w);
    results.push(r);
  }

  console.log('\n=== SUMMARY ===');
  wallets.forEach((w, i) => {
    const r = results[i];
    if (r.apiPnl !== null) {
      const pct = ((r.realized - r.apiPnl) / Math.abs(r.apiPnl) * 100).toFixed(1);
      console.log(w.substring(0, 10) + '... | Calc: $' + r.realized.toFixed(2) + ' | API: $' + r.apiPnl.toFixed(2) + ' | ' + pct + '%');
    }
  });

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
