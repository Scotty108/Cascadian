/**
 * Check wallet positions and resolution status
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';

async function main() {
  const client = getClickHouseClient();
  const wallet = '0x16ea6d68c8305c1c8f95d247d0845d19c9cf6df7';

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║   CHECKING WALLET POSITIONS & RESOLUTIONS                      ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Get all positions with resolution status
  const query = `
    SELECT
      m.condition_id,
      m.outcome_index,
      meta.question,
      r.payout_numerators,
      r.resolved_at,
      count() as trade_count,
      sum(CASE WHEN t.side = 'buy' THEN -t.usdc_amount ELSE t.usdc_amount END) / 1000000.0 as cash_flow,
      sum(CASE WHEN t.side = 'buy' THEN t.token_amount ELSE -t.token_amount END) / 1000000.0 as final_shares
    FROM pm_trader_events_dedup_v2_tbl t
    INNER JOIN pm_token_to_condition_map_v4 m
      ON toString(t.token_id) = toString(m.token_id_dec)
    LEFT JOIN pm_market_metadata meta
      ON lower(m.condition_id) = lower(meta.condition_id)
    LEFT JOIN pm_condition_resolutions r
      ON lower(m.condition_id) = lower(r.condition_id)
      AND r.is_deleted = 0
    WHERE lower(t.trader_wallet) = lower('${wallet}')
    GROUP BY m.condition_id, m.outcome_index, meta.question, r.payout_numerators, r.resolved_at
    ORDER BY final_shares DESC
    LIMIT 30
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  console.log('Wallet:', wallet);
  console.log('Top positions by share size:\n');
  console.log('─'.repeat(120));
  console.log('Status | Question'.padEnd(60) + ' | Shares'.padStart(12) + ' | Cash Flow'.padStart(12) + ' | Payout');
  console.log('─'.repeat(120));

  let unresolvedPnl = 0;
  let resolvedPnl = 0;
  let unresolvedCount = 0;
  let resolvedCount = 0;

  for (const row of rows) {
    const question = (row.question?.slice(0, 50) || 'Unknown market').padEnd(52);
    const isResolved = row.payout_numerators ? '✅' : '❌';
    const shares = Number(row.final_shares);
    const cashFlow = Number(row.cash_flow);

    // Calculate payout_norm
    let payoutNorm = 0;
    if (row.payout_numerators) {
      const outcome = row.outcome_index;
      if (row.payout_numerators.startsWith('[0,')) {
        payoutNorm = outcome === 0 ? 0 : 1;
      } else if (row.payout_numerators.startsWith('[1,')) {
        payoutNorm = outcome === 0 ? 1 : 0;
      }
    }

    const positionPnl = cashFlow + shares * payoutNorm;

    if (row.payout_numerators) {
      resolvedCount++;
      resolvedPnl += positionPnl;
    } else {
      unresolvedCount++;
      unresolvedPnl += cashFlow; // unresolved = mark at 0 for realized
    }

    console.log(`${isResolved}     | ${question} | ${shares.toFixed(2).padStart(10)} | ${cashFlow.toFixed(2).padStart(10)} | ${row.payout_numerators || 'NONE'}`);
  }

  console.log('─'.repeat(120));
  console.log(`\nResolved positions: ${resolvedCount} | Unresolved: ${unresolvedCount}`);
  console.log(`Realized PnL (resolved only): $${resolvedPnl.toFixed(2)}`);
  console.log(`Potential unrealized: $${unresolvedPnl.toFixed(2)} (cash flow from unresolved)`);

  // Check if any positions look like they should be resolved (high final_shares with no resolution)
  console.log('\n🔍 CHECKING FOR MISSING RESOLUTIONS:');
  const suspiciousPositions = rows.filter((r: any) => {
    return !r.payout_numerators && Math.abs(Number(r.final_shares)) > 100;
  });

  if (suspiciousPositions.length > 0) {
    console.log('Found positions with large shares but NO resolution:');
    for (const pos of suspiciousPositions) {
      console.log(`  - ${pos.question?.slice(0, 60)} | Shares: ${Number(pos.final_shares).toFixed(2)} | condition_id: ${pos.condition_id}`);
    }

    // For each suspicious position, check if it might be recently resolved
    console.log('\n🔍 CHECKING LATEST RESOLUTIONS IN DB:');
    const latestResQuery = `
      SELECT condition_id, payout_numerators, resolved_at
      FROM pm_condition_resolutions
      WHERE is_deleted = 0
      ORDER BY resolved_at DESC
      LIMIT 10
    `;
    const latestRes = await client.query({ query: latestResQuery, format: 'JSONEachRow' });
    const latestRows = await latestRes.json() as any[];
    console.log('Latest 10 resolutions in DB:');
    for (const r of latestRows) {
      console.log(`  ${r.resolved_at} | ${r.condition_id.slice(0, 20)}... | ${r.payout_numerators}`);
    }
  } else {
    console.log('All large positions appear resolved or no suspicious unresolved positions found.');
  }
}

main().catch(console.error);
