#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

// Step 4: Create collision-free clean read view for dashboards
// Excludes:
//   1. Empty or NULL condition IDs
//   2. Transaction hashes with multiple wallet addresses (collisions)

async function main() {
  console.log('═'.repeat(80));
  console.log('STEP 4: CREATE CLEAN GLOBAL VIEW');
  console.log('═'.repeat(80));
  console.log('');
  console.log('Creating collision-free trades view for dashboards...');
  console.log('');

  try {
    const sql = `
      CREATE OR REPLACE VIEW vw_trades_clean_global AS
      SELECT
        t.*,
        lower(t.wallet_address) AS wallet_clean,
        lower(replaceRegexpAll(t.condition_id_norm_v3, '^0x', '')) AS cid_norm
      FROM pm_trades_canonical_v3 t
      WHERE
        -- Exclude empty/null CIDs
        t.condition_id_norm_v3 IS NOT NULL
        AND t.condition_id_norm_v3 != ''
        -- Exclude tx_hashes with collisions
        AND t.transaction_hash NOT IN (
          SELECT transaction_hash
          FROM (
            SELECT
              transaction_hash,
              countDistinct(wallet_address) AS wallet_count
            FROM pm_trades_canonical_v3
            GROUP BY transaction_hash
            HAVING wallet_count > 1
          )
        )
    `;

    await clickhouse.exec({ query: sql });

    console.log('✅ View created successfully');
    console.log('');

    // Verify coverage
    const verifyQuery = `
      SELECT
        (SELECT count() FROM vw_trades_clean_global) AS clean_trades,
        (SELECT count() FROM pm_trades_canonical_v3) AS total_trades,
        round(clean_trades / total_trades * 100, 2) AS coverage_pct
    `;

    const result = await clickhouse.query({ query: verifyQuery, format: 'JSONEachRow' });
    const data = await result.json() as any[];
    const row = data[0];

    console.log('COVERAGE STATS:');
    console.log('─'.repeat(80));
    console.log(`  Total Trades:      ${parseInt(row.total_trades).toLocaleString()}`);
    console.log(`  Clean Trades:      ${parseInt(row.clean_trades).toLocaleString()}`);
    console.log(`  Coverage:          ${parseFloat(row.coverage_pct).toFixed(2)}%`);
    console.log('');

    if (parseFloat(row.coverage_pct) >= 95) {
      console.log('✅ Coverage >95% - view is ready for dashboard use');
    } else {
      console.log('⚠️  Coverage <95% - more collisions than expected');
    }

    console.log('');
    console.log('VIEW METADATA:');
    console.log('─'.repeat(80));
    console.log('  Name:    vw_trades_clean_global');
    console.log('  Purpose: Collision-free trades for dashboards during repair phase');
    console.log('  Usage:   SELECT * FROM vw_trades_clean_global WHERE wallet_clean = ?');
    console.log('');
    console.log('═'.repeat(80));
    console.log('✅ STEP 4 COMPLETE: Clean global view created');
    console.log('═'.repeat(80));

  } catch (error: any) {
    console.error('❌ ERROR:', error.message);
    console.error('');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
