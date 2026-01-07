import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function addSystemWalletFlag() {
  console.log('Adding is_system_wallet column to eligibility table...\n');

  // Step 1: Add column if not exists
  try {
    await clickhouse.command({
      query: `
        ALTER TABLE pm_wallet_clob_eligibility_v1
        ADD COLUMN IF NOT EXISTS is_system_wallet UInt8 DEFAULT 0
      `,
    });
    console.log('✓ Added is_system_wallet column');
  } catch (e: any) {
    if (e.message?.includes('already exists')) {
      console.log('✓ Column already exists');
    } else {
      throw e;
    }
  }

  // Step 2: Mark system wallets (trade_count >= 10000)
  // In ClickHouse ReplacingMergeTree, we do this by inserting new rows
  // with updated values - the engine will merge and keep latest
  console.log('\nMarking system wallets (10K+ trades)...');

  const markQ = `
    INSERT INTO pm_wallet_clob_eligibility_v1
    SELECT
      wallet_address,
      tokens_bought,
      tokens_sold,
      token_deficit,
      deficit_ratio,
      usdc_spent,
      usdc_received,
      net_pnl_simple,
      trade_count,
      unique_tokens,
      first_trade,
      last_trade,
      is_clob_only,
      eligibility_reason,
      now() as computed_at,
      if(trade_count >= 10000, 1, 0) as is_system_wallet
    FROM pm_wallet_clob_eligibility_v1
    WHERE trade_count >= 10000
  `;

  await clickhouse.command({ query: markQ });

  // Force merge to apply updates
  await clickhouse.command({
    query: 'OPTIMIZE TABLE pm_wallet_clob_eligibility_v1 FINAL',
  });
  console.log('✓ Marked system wallets and optimized table');

  // Step 3: Show results
  const statsQ = `
    SELECT
      countIf(is_clob_only = 1 AND is_system_wallet = 0) as eligible_non_system,
      countIf(is_clob_only = 1 AND is_system_wallet = 1) as eligible_system,
      countIf(is_clob_only = 1 AND is_system_wallet = 0 AND last_trade >= now() - INTERVAL 30 DAY) as eligible_active_30d
    FROM pm_wallet_clob_eligibility_v1
  `;

  const r = await clickhouse.query({ query: statsQ, format: 'JSONEachRow' });
  const rows = await r.json() as any[];
  const stats = rows[0];

  console.log('\n' + '='.repeat(60));
  console.log('LEADERBOARD ELIGIBILITY SUMMARY');
  console.log('='.repeat(60));
  console.log(`CLOB-only eligible (non-system): ${Number(stats.eligible_non_system).toLocaleString()}`);
  console.log(`CLOB-only system wallets (excluded): ${Number(stats.eligible_system).toLocaleString()}`);
  console.log(`\n✅ FINAL: Active 30d, CLOB-only, Non-system: ${Number(stats.eligible_active_30d).toLocaleString()}`);

  // Show top performers
  console.log('\n' + '='.repeat(60));
  console.log('TOP 10 PERFORMERS (eligible for leaderboard)');
  console.log('='.repeat(60));

  const topQ = `
    SELECT
      wallet_address,
      round(net_pnl_simple, 0) as pnl,
      trade_count,
      unique_tokens
    FROM pm_wallet_clob_eligibility_v1
    WHERE is_clob_only = 1
      AND is_system_wallet = 0
      AND last_trade >= now() - INTERVAL 30 DAY
    ORDER BY net_pnl_simple DESC
    LIMIT 10
  `;

  const topR = await clickhouse.query({ query: topQ, format: 'JSONEachRow' });
  const topRows = await topR.json() as any[];

  for (let i = 0; i < topRows.length; i++) {
    const row = topRows[i];
    console.log(`${i + 1}. ${row.wallet_address} | PnL: $${Number(row.pnl).toLocaleString().padStart(12)} | ${row.trade_count} trades`);
  }
}

addSystemWalletFlag();
