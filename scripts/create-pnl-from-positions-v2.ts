#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
  console.log('Creating Lightweight PnL View from outcome_positions_v2');
  console.log('═'.repeat(80));
  console.log();

  console.log('Creating cascadian_clean.vw_wallet_pnl_simple...');

  // Create a simple PnL view using pre-computed positions
  await client.exec({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_wallet_pnl_simple AS
      SELECT
        p.wallet,
        p.condition_id_norm,
        lower(concat('0x', p.condition_id_norm)) AS cid_hex,
        p.outcome_idx,
        p.net_shares,
        r.winning_index,
        r.payout_numerators,
        r.payout_denominator,
        r.winning_outcome,

        -- PnL calculation
        -- Note: We don't have cost_basis in outcome_positions_v2,
        -- so this is simplified to show just payout value
        multiIf(
          r.winning_index IS NOT NULL AND p.outcome_idx = r.winning_index,
          toFloat64(p.net_shares) * (toFloat64(arrayElement(r.payout_numerators, p.outcome_idx + 1)) / toFloat64(r.payout_denominator)),
          r.winning_index IS NOT NULL,
          0,  -- Lost position
          NULL  -- Unresolved
        ) AS payout_value,

        r.winning_index IS NOT NULL AS is_resolved

      FROM default.outcome_positions_v2 p
      LEFT JOIN cascadian_clean.vw_resolutions_all r
        ON lower(concat('0x', p.condition_id_norm)) = r.cid_hex
    `,
  });

  console.log('✅ View created successfully');
  console.log();

  // Test the view with a simple query
  console.log('Testing view with simple query (1 wallet)...');
  const test = await client.query({
    query: `
      SELECT
        wallet,
        count() AS total_positions,
        countIf(is_resolved = 1) AS resolved,
        countIf(is_resolved = 0) AS unresolved,
        sum(payout_value) AS total_payout_value
      FROM cascadian_clean.vw_wallet_pnl_simple
      WHERE wallet != ''
      GROUP BY wallet
      ORDER BY resolved DESC
      LIMIT 1
    `,
    format: 'JSONEachRow',
  });

  const result = (await test.json<Array<any>>())[0];

  if (result) {
    console.log('Sample wallet stats:');
    console.log(`  Wallet:        ${result.wallet}`);
    console.log(`  Total:         ${result.total_positions.toLocaleString()} positions`);
    console.log(`  Resolved:      ${result.resolved.toLocaleString()}`);
    console.log(`  Unresolved:    ${result.unresolved.toLocaleString()}`);
    console.log(`  Payout value:  $${result.total_payout_value?.toLocaleString() || 'NULL'}`);
    console.log();
    console.log('✅ View is working! No memory errors.');
    console.log();
    console.log('Note: This view shows payout value, not full PnL');
    console.log('      (outcome_positions_v2 doesn\'t have cost_basis data)');
  } else {
    console.log('⚠️  No results - view might be empty');
  }

  await client.close();
}

main().catch(console.error);
