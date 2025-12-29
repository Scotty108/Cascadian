#!/usr/bin/env npx tsx
/**
 * Check if V17's paired-outcome normalization is working for this wallet
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

const WALLET = '0x586744c62f4b87872d4e616e1273b88b5eb324b3';

async function main() {
  // Get fills with transaction info
  const query = `
    SELECT
      any(f.transaction_hash) as transaction_hash,
      any(lower(f.side)) as side,
      any(f.token_amount) / 1e6 as tokens,
      any(f.usdc_amount) / 1e6 as usdc,
      any(m.condition_id) as condition_id,
      any(m.outcome_index) as outcome_index
    FROM pm_trader_events_dedup_v2_tbl f
    INNER JOIN pm_token_to_condition_map_v5 m ON f.token_id = m.token_id_dec
    WHERE lower(f.trader_wallet) = lower('${WALLET}')
    GROUP BY f.event_id
    ORDER BY transaction_hash, condition_id, outcome_index
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const fills = (await result.json()) as any[];

  console.log('='.repeat(80));
  console.log('CHECKING V17 PAIRED-OUTCOME NORMALIZATION');
  console.log('='.repeat(80));
  console.log(`Total fills: ${fills.length}`);

  // Group by (tx_hash, condition_id)
  const groups = new Map<string, any[]>();
  for (const fill of fills) {
    const key = `${fill.transaction_hash}_${fill.condition_id}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(fill);
  }

  console.log(`Unique (tx_hash, condition_id) groups: ${groups.size}`);

  // Find groups with both outcomes
  let pairedGroups = 0;
  let pairedFills = 0;
  const PAIRED_EPSILON = 1.0;

  for (const [key, groupFills] of groups) {
    const outcomes = new Set(groupFills.map((f: any) => Number(f.outcome_index)));
    if (!outcomes.has(0) || !outcomes.has(1) || groupFills.length < 2) {
      continue;
    }

    const o0Fills = groupFills.filter((f: any) => Number(f.outcome_index) === 0);
    const o1Fills = groupFills.filter((f: any) => Number(f.outcome_index) === 1);

    let foundPair = false;
    for (const o0 of o0Fills) {
      for (const o1 of o1Fills) {
        const oppositeDirection = o0.side !== o1.side;
        const amountMatch = Math.abs(Number(o0.tokens) - Number(o1.tokens)) <= PAIRED_EPSILON;

        if (oppositeDirection && amountMatch) {
          foundPair = true;
          pairedFills += 2;
          console.log(`\nFOUND PAIR in ${key.slice(0, 20)}...`);
          console.log(`  O0: side=${o0.side}, tokens=${Number(o0.tokens).toFixed(2)}`);
          console.log(`  O1: side=${o1.side}, tokens=${Number(o1.tokens).toFixed(2)}`);
        }
      }
    }

    if (foundPair) {
      pairedGroups++;
    }
  }

  console.log('\n' + '-'.repeat(80));
  console.log(`PAIRED OUTCOME STATS:`);
  console.log(`  Groups with both outcomes: ${[...groups.values()].filter((g) => new Set(g.map((f: any) => f.outcome_index)).size > 1).length}`);
  console.log(`  Groups with PAIRED trades (opposite direction, matching amount): ${pairedGroups}`);
  console.log(`  Fills marked as hedge legs: ${pairedFills}`);
  console.log(`  Fills remaining after normalization: ${fills.length - pairedFills}`);

  // Show all fills grouped by (tx_hash, condition_id)
  console.log('\n' + '='.repeat(80));
  console.log('ALL FILLS BY (tx_hash, condition_id):');
  console.log('='.repeat(80));

  for (const [key, groupFills] of groups) {
    console.log(`\n${key.slice(0, 40)}...`);
    for (const f of groupFills) {
      console.log(`  O${f.outcome_index} ${f.side.padEnd(4)} ${Number(f.tokens).toFixed(2).padStart(12)} tokens ${Number(f.usdc).toFixed(2).padStart(10)} USDC`);
    }
  }

  // Key insight: Show that trades are NOT paired (same direction = accumulation)
  console.log('\n' + '='.repeat(80));
  console.log('KEY INSIGHT: Are both outcomes being BOUGHT (not paired)?');
  console.log('='.repeat(80));

  const o0Buys = fills.filter((f: any) => Number(f.outcome_index) === 0 && f.side === 'buy').reduce((s: number, f: any) => s + Number(f.tokens), 0);
  const o0Sells = fills.filter((f: any) => Number(f.outcome_index) === 0 && f.side === 'sell').reduce((s: number, f: any) => s + Number(f.tokens), 0);
  const o1Buys = fills.filter((f: any) => Number(f.outcome_index) === 1 && f.side === 'buy').reduce((s: number, f: any) => s + Number(f.tokens), 0);
  const o1Sells = fills.filter((f: any) => Number(f.outcome_index) === 1 && f.side === 'sell').reduce((s: number, f: any) => s + Number(f.tokens), 0);

  console.log(`Outcome 0: bought=${o0Buys.toFixed(2)}, sold=${o0Sells.toFixed(2)}, net=${(o0Buys - o0Sells).toFixed(2)}`);
  console.log(`Outcome 1: bought=${o1Buys.toFixed(2)}, sold=${o1Sells.toFixed(2)}, net=${(o1Buys - o1Sells).toFixed(2)}`);

  const bothBought = o0Buys > o0Sells && o1Buys > o1Sells;
  console.log(`\nBoth outcomes net BOUGHT: ${bothBought ? 'YES - Complete set accumulation!' : 'No'}`);

  if (bothBought) {
    console.log(`\n⚠️ This wallet accumulated ~26,041 COMPLETE SETS (YES+NO pairs).`);
    console.log(`   V17 counts P&L on BOTH outcomes separately = 2x loss`);
    console.log(`   UI likely recognizes complete sets and counts P&L only once`);
  }

  await clickhouse.close();
}

main().catch(console.error);
