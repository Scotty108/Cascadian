import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

interface Trade {
  tx_hash: string;
  condition_id: string;
  outcome_index: number;
  side: string;
  price: number;
  tokens: number;
  usdc: number;
  ts: number;
}

async function getTrades(wallet: string): Promise<Trade[]> {
  const w = wallet.toLowerCase();

  const query = `
    SELECT
      substring(t.event_id, 1, 66) as tx_hash,
      m.condition_id,
      m.outcome_index,
      t.side,
      max(t.usdc_amount) / max(t.token_amount) as price,
      max(t.token_amount) / 1000000.0 as tokens,
      max(t.usdc_amount) / 1000000.0 as usdc,
      max(toUnixTimestamp(t.trade_time)) as ts
    FROM pm_trader_events_v3 t
    LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    WHERE lower(t.trader_wallet) = '${w}'
      AND m.condition_id IS NOT NULL
      AND m.condition_id != ''
    GROUP BY tx_hash, m.condition_id, m.outcome_index, t.side
    ORDER BY ts ASC, tx_hash ASC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];
  return rows.map(r => ({
    tx_hash: r.tx_hash,
    condition_id: r.condition_id.toLowerCase(),
    outcome_index: Number(r.outcome_index),
    side: r.side.toLowerCase(),
    price: Number(r.price),
    tokens: Number(r.tokens),
    usdc: Number(r.usdc),
    ts: Number(r.ts),
  }));
}

async function main() {
  const wallet = process.argv[2] || '0x1f3178c3f82eee8e67018473b8fc33b3dc7806cb';

  console.log(`\n=== TRACING PAIRED TRADES FOR ${wallet} ===\n`);

  const trades = await getTrades(wallet);

  // Focus on condition dd22472e... which has the largest discrepancy
  const targetCondition = 'dd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917';
  const condTrades = trades.filter(t => t.condition_id === targetCondition);

  console.log(`Condition: ${targetCondition}`);
  console.log(`Total trades: ${condTrades.length}\n`);

  // Group by timestamp
  const byTs = new Map<number, Trade[]>();
  for (const trade of condTrades) {
    if (!byTs.has(trade.ts)) {
      byTs.set(trade.ts, []);
    }
    byTs.get(trade.ts)!.push(trade);
  }

  console.log('Trades grouped by timestamp:');
  console.log('time       | O0 side/tokens/usdc | O1 side/tokens/usdc | Pattern');
  console.log('-'.repeat(90));

  let o0Running = 0;  // running token balance for O0
  let o1Running = 0;  // running token balance for O1
  let cashRunning = 0;  // running cash balance

  for (const [ts, group] of Array.from(byTs).sort((a, b) => a[0] - b[0])) {
    const time = new Date(ts * 1000).toISOString().substring(11, 19);
    const o0 = group.filter(t => t.outcome_index === 0);
    const o1 = group.filter(t => t.outcome_index === 1);

    let o0Str = 'none';
    let o1Str = 'none';
    let pattern = '';

    let o0Delta = 0;
    let o1Delta = 0;
    let cashDelta = 0;

    if (o0.length > 0) {
      const t = o0[0];
      o0Str = `${t.side} ${t.tokens.toFixed(1)} @ $${t.usdc.toFixed(2)}`;
      if (t.side === 'buy') {
        o0Delta = t.tokens;
        cashDelta -= t.usdc;
      } else {
        o0Delta = -t.tokens;
        cashDelta += t.usdc;
      }
    }

    if (o1.length > 0) {
      const t = o1[0];
      o1Str = `${t.side} ${t.tokens.toFixed(1)} @ $${t.usdc.toFixed(2)}`;
      if (t.side === 'buy') {
        o1Delta = t.tokens;
        cashDelta -= t.usdc;
      } else {
        o1Delta = -t.tokens;
        cashDelta += t.usdc;
      }
    }

    // Detect patterns
    if (o0.length > 0 && o1.length > 0) {
      if (o0[0].side === 'sell' && o1[0].side === 'buy') {
        pattern = 'SPLIT (sell O0 + buy O1)';
      } else if (o0[0].side === 'buy' && o1[0].side === 'sell') {
        pattern = 'MERGE (buy O0 + sell O1)';
      } else {
        pattern = 'BOTH ' + o0[0].side;
      }
    } else {
      pattern = 'SINGLE';
    }

    o0Running += o0Delta;
    o1Running += o1Delta;
    cashRunning += cashDelta;

    console.log(
      `${time} | ${o0Str.padEnd(25)} | ${o1Str.padEnd(25)} | ${pattern}`
    );
  }

  console.log('\n=== FINAL STATE ===');
  console.log(`O0 tokens: ${o0Running.toFixed(2)}`);
  console.log(`O1 tokens: ${o1Running.toFixed(2)}`);
  console.log(`Net cash: $${cashRunning.toFixed(2)}`);

  // Now the key question: where did the "extra" sold tokens come from?
  // If O0 balance is negative, we sold more than we bought
  // For this to work, we must have received tokens from somewhere other than CLOB buys

  // Theory: When you do SPLIT via Neg Risk Adapter:
  // 1. You send USDC
  // 2. You receive tokens of BOTH outcomes
  // 3. CLOB records it as "sell O0" and "buy O1" (or vice versa)
  // But actually, no USDC changes hands in the CLOB - it's all internal

  // Let me check the prices more carefully
  console.log('\n=== CHECKING IF PRICES SUM TO 1 ===');

  for (const [ts, group] of Array.from(byTs).sort((a, b) => a[0] - b[0])) {
    const o0 = group.filter(t => t.outcome_index === 0);
    const o1 = group.filter(t => t.outcome_index === 1);

    if (o0.length > 0 && o1.length > 0) {
      const time = new Date(ts * 1000).toISOString().substring(11, 19);
      const p0 = o0[0].price;
      const p1 = o1[0].price;
      const sum = p0 + p1;
      console.log(`${time}: O0 price=${p0.toFixed(4)}, O1 price=${p1.toFixed(4)}, sum=${sum.toFixed(4)}`);
    }
  }

  process.exit(0);
}

main().catch(console.error);
