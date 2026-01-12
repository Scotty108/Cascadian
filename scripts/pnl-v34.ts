
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

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
  console.log('\n=== PNL V34 (TX-LEVEL BUNDLED SPLITS) FOR ' + wallet.substring(0, 10) + '... ===');

  const result = await clickhouse.query({
    query: `
      SELECT
        substring(t.event_id, 1, 66) as tx_hash,
        lower(m.condition_id) as condition_id,
        m.outcome_index,
        t.side,
        max(t.usdc_amount) / 1000000.0 as usdc,
        max(t.token_amount) / 1000000.0 as tokens,
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
  const trades = await result.json();
  console.log('Total trades: ' + trades.length);

  // Group by (condition_id, tx_hash) for bundled detection
  const txGroups = new Map();
  for (const t of trades) {
    const key = t.condition_id + '_' + t.tx_hash;
    if (!txGroups.has(key)) txGroups.set(key, []);
    txGroups.get(key).push(t);
  }

  // Identify bundled splits - KEY FIX: track by (condition_id, tx_hash) not just condition_id
  const txOffsets = new Map();  // key: condition_id_tx_hash -> sell offset
  let bundledCount = 0;

  for (const [key, group] of txGroups) {
    const buys = group.filter(t => t.side === 'buy');
    const sells = group.filter(t => t.side === 'sell');
    
    if (buys.length > 0 && sells.length > 0) {
      const buyOutcomes = new Set(buys.map(t => t.outcome_index));
      const sellOutcomes = new Set(sells.map(t => t.outcome_index));
      
      let hasOppositeSell = false;
      for (const so of sellOutcomes) {
        if (!buyOutcomes.has(so)) {
          hasOppositeSell = true;
          break;
        }
      }
      
      if (hasOppositeSell) {
        bundledCount++;
        
        // Calculate sell offset (only for opposite outcomes)
        let sellOffset = 0;
        for (const s of sells) {
          if (!buyOutcomes.has(s.outcome_index)) {
            sellOffset += s.usdc;
          }
        }
        
        // Store by tx key (will be applied to buys in this same tx)
        txOffsets.set(key, sellOffset);
      }
    }
  }
  
  const totalOffset = Array.from(txOffsets.values()).reduce((a, b) => a + b, 0);
  console.log('Bundled splits: ' + bundledCount + ', total offset: $' + totalOffset.toFixed(2));

  // Track positions
  const positions = new Map();
  let realizedPnl = 0;

  for (const t of trades) {
    const posKey = t.condition_id + '_' + t.outcome_index;
    if (!positions.has(posKey)) {
      positions.set(posKey, { amount: 0, totalCost: 0, avgPrice: 0 });
    }
    const pos = positions.get(posKey);
    const txKey = t.condition_id + '_' + t.tx_hash;
    
    if (t.side === 'buy') {
      let adjustedCost = t.usdc;
      
      // Apply offset only if this specific tx has a bundled sell
      if (txOffsets.has(txKey)) {
        const offset = txOffsets.get(txKey);
        adjustedCost = Math.max(0, t.usdc - offset);
        txOffsets.delete(txKey);  // Use offset only once
      }
      
      pos.amount += t.tokens;
      pos.totalCost += adjustedCost;
      pos.avgPrice = pos.amount > 0 ? pos.totalCost / pos.amount : 0;
    } else {
      // Sell - check if this is a bundled opposite sell (already handled as offset)
      const buyOutcomes = [];
      const group = txGroups.get(txKey) || [];
      for (const g of group) {
        if (g.side === 'buy') buyOutcomes.push(g.outcome_index);
      }
      
      // If selling opposite outcome in bundled tx, skip (already counted as cost offset)
      if (buyOutcomes.length > 0 && !buyOutcomes.includes(t.outcome_index)) {
        continue;  // This sell was used as cost offset
      }
      
      // Regular sell - realize against position
      const sellAmt = Math.min(t.tokens, pos.amount);
      if (sellAmt > 0) {
        const sellProceeds = (sellAmt / t.tokens) * t.usdc;
        const costBasis = sellAmt * pos.avgPrice;
        realizedPnl += sellProceeds - costBasis;
        pos.amount -= sellAmt;
        pos.totalCost = pos.amount * pos.avgPrice;
      }
    }
  }

  console.log('Realized: $' + realizedPnl.toFixed(2));

  // Get resolutions
  const conditionIds = [...new Set([...positions.keys()].map(k => k.split('_')[0]))];
  const resolutions = new Map();
  
  if (conditionIds.length > 0) {
    const idList = conditionIds.slice(0, 500).map(id => "'" + id + "'").join(',');
    const resResult = await clickhouse.query({
      query: 'SELECT lower(condition_id) as condition_id, norm_prices FROM pm_condition_resolutions_norm WHERE lower(condition_id) IN (' + idList + ')',
      format: 'JSONEachRow'
    });
    for (const row of await resResult.json()) {
      resolutions.set(row.condition_id, row.norm_prices);
    }
  }

  // Unrealized
  let unrealizedPnl = 0;
  for (const [key, pos] of positions) {
    if (pos.amount > 0.001) {
      const [cid, ois] = key.split('_');
      const oi = parseInt(ois);
      const prices = resolutions.get(cid);
      
      if (prices && prices[oi] !== undefined) {
        unrealizedPnl += pos.amount * prices[oi] - pos.totalCost;
      } else {
        unrealizedPnl -= pos.totalCost;
      }
    }
  }

  const total = realizedPnl + unrealizedPnl;
  const apiPnl = await fetchApiPnl(wallet);

  console.log('Unrealized: $' + unrealizedPnl.toFixed(2));
  console.log('Total: $' + total.toFixed(2));
  console.log('API: $' + (apiPnl !== null ? apiPnl.toFixed(2) : 'N/A'));

  if (apiPnl !== null) {
    const diff = total - apiPnl;
    const pct = (diff / Math.abs(apiPnl)) * 100;
    console.log('Diff: $' + diff.toFixed(2) + ' (' + pct.toFixed(1) + '%)');
  }
  
  return { total, apiPnl };
}

async function main() {
  const results = [];
  const wallets = [
    '0x1f3178c3f82eee8e67018473b8fc33b3dc7806cb',
    '0x3eee293c5dee12a7aa692e21c4b50bb8fc3fe8b6',
    '0x04d2e30b0d6f29976c6ce11bab2a87d5bad756cd',
  ];
  
  for (const w of wallets) {
    const r = await calculatePnl(w);
    results.push(r);
  }
  
  console.log('\n=== SUMMARY ===');
  wallets.forEach((w, i) => {
    const r = results[i];
    if (r.apiPnl !== null) {
      const pct = ((r.total - r.apiPnl) / Math.abs(r.apiPnl) * 100).toFixed(1);
      console.log(w.substring(0, 10) + '... | Calc: $' + r.total.toFixed(2) + ' | API: $' + r.apiPnl.toFixed(2) + ' | ' + pct + '%');
    }
  });
  
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
