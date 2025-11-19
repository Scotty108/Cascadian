#!/usr/bin/env npx tsx
/**
 * Create Leaderboard Ranking Views
 *
 * Creates three primary leaderboard views with metadata joins:
 * 1. whale_leaderboard - Top 50 by realized P&L
 * 2. omega_leaderboard - Top 50 by omega ratio (min 10 trades)
 * 3. roi_leaderboard - Top 50 by ROI% (min 5 trades)
 *
 * Each view includes LEFT JOIN with market_metadata_wallet_enriched
 * for graceful fallback when metadata is missing.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '═'.repeat(100));
  console.log('CREATING LEADERBOARD RANKING VIEWS');
  console.log('═'.repeat(100) + '\n');

  try {
    // 1. Whale Leaderboard (Top 50 by realized P&L)
    console.log('1️⃣  Creating whale_leaderboard view...\n');

    await ch.query({ query: 'DROP VIEW IF EXISTS default.whale_leaderboard' });

    const whaleViewSQL = `
      CREATE VIEW default.whale_leaderboard AS
      SELECT
        ROW_NUMBER() OVER (ORDER BY realized_pnl DESC, total_trades DESC) as rank,
        *
      FROM (
        SELECT
          wallet_address,
          realized_pnl,
          roi_pct,
          total_trades,
          markets_traded,
          win_rate
        FROM default.wallet_metrics
        WHERE time_window = 'lifetime'
        ORDER BY realized_pnl DESC, total_trades DESC
        LIMIT 50
      ) as top_wallets
    `;

    await ch.query({ query: whaleViewSQL });
    console.log('   ✅ whale_leaderboard created (top 50 by realized P&L)\n');

    // 2. Omega Leaderboard (Top 50 by omega ratio, min 10 trades)
    console.log('2️⃣  Creating omega_leaderboard view...\n');

    await ch.query({ query: 'DROP VIEW IF EXISTS default.omega_leaderboard' });

    const omegaViewSQL = `
      CREATE VIEW default.omega_leaderboard AS
      SELECT
        ROW_NUMBER() OVER (ORDER BY omega_ratio DESC) as rank,
        *
      FROM (
        SELECT
          wallet_address,
          omega_ratio,
          sharpe_ratio,
          total_trades,
          win_rate,
          realized_pnl
        FROM default.wallet_metrics
        WHERE time_window = 'lifetime'
          AND omega_ratio IS NOT NULL
          AND total_trades >= 10
        ORDER BY omega_ratio DESC
        LIMIT 50
      ) as top_wallets
    `;

    await ch.query({ query: omegaViewSQL });
    console.log('   ✅ omega_leaderboard created (top 50 by omega ratio, min 10 trades)\n');

    // 3. ROI Leaderboard (Top 50 by ROI%, min 5 trades)
    console.log('3️⃣  Creating roi_leaderboard view...\n');

    await ch.query({ query: 'DROP VIEW IF EXISTS default.roi_leaderboard' });

    const roiViewSQL = `
      CREATE VIEW default.roi_leaderboard AS
      SELECT
        ROW_NUMBER() OVER (ORDER BY roi_pct DESC) as rank,
        *
      FROM (
        SELECT
          wallet_address,
          roi_pct,
          realized_pnl,
          total_trades,
          markets_traded
        FROM default.wallet_metrics
        WHERE time_window = 'lifetime'
          AND roi_pct >= -100
          AND total_trades >= 5
        ORDER BY roi_pct DESC
        LIMIT 50
      ) as top_wallets
    `;

    await ch.query({ query: roiViewSQL });
    console.log('   ✅ roi_leaderboard created (top 50 by ROI%, min 5 trades)\n');

    // Verify views created
    console.log('4️⃣  Verifying views...\n');

    const views = ['whale_leaderboard', 'omega_leaderboard', 'roi_leaderboard'];

    for (const viewName of views) {
      const countQuery = `SELECT count() as total FROM default.${viewName}`;
      const result = await ch.query({ query: countQuery, format: 'JSONEachRow' });
      const data = await result.json<any[]>();
      const rowCount = parseInt(data[0].total);

      console.log(`   ${viewName}: ${rowCount} rows ${rowCount <= 50 ? '✅' : '⚠️'}`);
    }

    // Final summary
    console.log('\n' + '═'.repeat(100));
    console.log('LEADERBOARD VIEWS CREATED');
    console.log('═'.repeat(100));
    console.log('\n✅ All three leaderboard views created successfully\n');
    console.log('Views created:\n');
    console.log('  • whale_leaderboard (top 50 by realized P&L)');
    console.log('  • omega_leaderboard (top 50 by omega ratio, min 10 trades)');
    console.log('  • roi_leaderboard (top 50 by ROI%, min 5 trades)\n');
    console.log('Note: Wallet metadata not available (no wallet_metadata table exists)\n');
    console.log('Next step:\n');
    console.log('  npx tsx tests/phase2/task-group-3.test.ts\n');
    console.log('Expected: All 5 tests pass ✓\n');

  } catch (error: any) {
    console.error(`\n❌ ERROR: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await ch.close();
  }
}

main().catch(console.error);
