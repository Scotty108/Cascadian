#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0x7f3c8979d0afa00007bae4747d5347122af05613';

async function main() {
  console.log(`Comparing our data vs Polymarket UI...\n`);
  console.log(`Wallet: ${WALLET}\n`);
  console.log(`Polymarket UI: https://polymarket.com/${WALLET}\n`);

  // Quick counts
  const result = await clickhouse.query({
    query: `
      WITH positions AS (
        SELECT
          condition_id_norm_v3,
          outcome_index_v3,
          sumIf(toFloat64(shares), trade_direction = 'BUY') -
          sumIf(toFloat64(shares), trade_direction = 'SELL') AS net_shares
        FROM pm_trades_canonical_v3
        WHERE lower(wallet_address) = lower('${WALLET}')
          AND condition_id_norm_v3 != ''
        GROUP BY condition_id_norm_v3, outcome_index_v3
      )
      SELECT
        (SELECT count() FROM pm_trades_canonical_v3 WHERE lower(wallet_address) = lower('${WALLET}')) AS total_fills,
        (SELECT count() FROM positions) AS total_positions,
        (SELECT count() FROM positions WHERE net_shares != 0) AS non_zero_positions,
        (SELECT count() FROM positions WHERE abs(net_shares) > 0.01) AS significant_positions
    `,
    format: 'JSONEachRow'
  });

  const data = await result.json<Array<any>>();
  const row = data[0];

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('OUR DATA:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total CLOB Fills:           ${parseInt(row.total_fills).toLocaleString()}`);
  console.log(`  Unique Positions:           ${parseInt(row.total_positions).toLocaleString()}`);
  console.log(`  Non-Zero Positions:         ${parseInt(row.non_zero_positions).toLocaleString()}`);
  console.log(`  Significant Positions:      ${parseInt(row.significant_positions).toLocaleString()}`);
  console.log();
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('POLYMARKET UI:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Predictions:                94`);
  console.log(`  Profit & Loss:              $184,862`);
  console.log();
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('ANALYSIS:');
  console.log('═══════════════════════════════════════════════════════════════');

  const fills = parseInt(row.total_fills);
  const positions = parseInt(row.total_positions);
  const nonZero = parseInt(row.non_zero_positions);
  const significant = parseInt(row.significant_positions);

  console.log(`\n1️⃣  Fills vs Positions:`);
  console.log(`    ${fills.toLocaleString()} fills = individual CLOB trades (buys/sells)`);
  console.log(`    ${positions.toLocaleString()} positions = unique (market, outcome) pairs`);
  console.log(`    → Polymarket "predictions" likely = positions, not fills`);

  console.log(`\n2️⃣  Position Counts:`);
  console.log(`    ${positions.toLocaleString()} total positions (including fully closed)`);
  console.log(`    ${nonZero.toLocaleString()} non-zero positions (not fully exited)`);
  console.log(`    ${significant.toLocaleString()} significant positions (> 0.01 shares)`);

  const match94 = [
    { name: 'Significant Positions', value: significant, match: Math.abs(significant - 94) < 5 },
    { name: 'Non-Zero Positions', value: nonZero, match: Math.abs(nonZero - 94) < 5 }
  ];

  const bestMatch = match94.find(m => m.match);

  if (bestMatch) {
    console.log(`\n    ✅ MATCH: ${bestMatch.name} (${bestMatch.value}) ≈ Polymarket predictions (94)`);
    console.log(`    → Polymarket shows only positions with > 0.01 shares or similar threshold`);
  } else {
    console.log(`\n    ⚠️  No exact match with 94 predictions`);
    console.log(`    → Need to check Polymarket's filtering logic`);
  }

  console.log(`\n3️⃣  Next Steps:`);
  console.log(`    - Fetch actual position data from Polymarket API`);
  console.log(`    - Compare their position list vs our position list`);
  console.log(`    - Verify their P&L calculation methodology`);
  console.log();
}

main().catch(console.error);
