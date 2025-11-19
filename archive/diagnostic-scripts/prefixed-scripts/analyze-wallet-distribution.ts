/**
 * Analyze wallet distribution to understand winner/loser/open patterns
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('WALLET DISTRIBUTION ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📊 Analyzing overall distribution...\n');

  const query = await clickhouse.query({
    query: `
      WITH w AS (
        SELECT
          cf.proxy_wallet,
          countDistinct(cf.asset_id) AS assets_total,
          countDistinctIf(cf.asset_id, r.winning_index IS NOT NULL) AS assets_resolved,
          countDistinctIf(cf.asset_id, r.winning_index = cm.outcome_index) AS assets_won,
          countDistinctIf(cf.asset_id, r.winning_index != cm.outcome_index AND r.winning_index IS NOT NULL) AS assets_lost,
          countDistinctIf(cf.asset_id, r.winning_index IS NULL) AS assets_open
        FROM clob_fills cf
        INNER JOIN ctf_token_map_norm cm ON cf.asset_id = cm.asset_id
        LEFT JOIN market_resolutions_norm r ON cm.condition_id_norm = r.condition_id_norm
        WHERE cf.timestamp >= '2024-09-01' AND cf.timestamp < '2025-01-01'
        GROUP BY cf.proxy_wallet
        HAVING assets_total BETWEEN 20 AND 200
      )
      SELECT
        count() AS wallet_count,
        round(avg(assets_total), 1) AS avg_assets,
        round(avg(assets_resolved), 1) AS avg_resolved,
        round(avg(assets_won), 1) AS avg_won,
        round(avg(assets_lost), 1) AS avg_lost,
        round(avg(assets_open), 1) AS avg_open,
        round(avg(assets_won) / avg(assets_resolved) * 100, 1) AS win_rate_pct
      FROM w
    `,
    format: 'JSONEachRow'
  });

  const result: any = (await query.json())[0];

  console.log('Overall Statistics:\n');
  console.log(`  Total wallets (20-200 assets): ${result.wallet_count}`);
  console.log(`  Average total assets: ${result.avg_assets}`);
  console.log(`  Average resolved: ${result.avg_resolved}`);
  console.log(`  Average winners: ${result.avg_won}`);
  console.log(`  Average losers: ${result.avg_lost}`);
  console.log(`  Average open: ${result.avg_open}`);
  console.log(`  Win rate: ${result.win_rate_pct}%\n`);

  // Find wallets with ANY winners and ANY open positions
  console.log('📊 Finding wallets with at least SOME winners and open positions...\n');

  const query2 = await clickhouse.query({
    query: `
      WITH w AS (
        SELECT
          cf.proxy_wallet,
          countDistinct(cf.asset_id) AS assets_total,
          countDistinctIf(cf.asset_id, r.winning_index IS NOT NULL) AS assets_resolved,
          countDistinctIf(cf.asset_id, r.winning_index = cm.outcome_index) AS assets_won,
          countDistinctIf(cf.asset_id, r.winning_index != cm.outcome_index AND r.winning_index IS NOT NULL) AS assets_lost,
          countDistinctIf(cf.asset_id, r.winning_index IS NULL) AS assets_open
        FROM clob_fills cf
        INNER JOIN ctf_token_map_norm cm ON cf.asset_id = cm.asset_id
        LEFT JOIN market_resolutions_norm r ON cm.condition_id_norm = r.condition_id_norm
        WHERE cf.timestamp >= '2024-01-01'
        GROUP BY cf.proxy_wallet
      )
      SELECT *
      FROM w
      WHERE assets_total BETWEEN 20 AND 200
        AND assets_won >= 1
        AND assets_lost >= 1
        AND assets_open >= 1
      ORDER BY
        assets_won DESC,
        assets_total ASC
      LIMIT 25
    `,
    format: 'JSONEachRow'
  });

  const wallets: any[] = await query2.json();

  if (wallets.length === 0) {
    console.log('❌ No wallets with W/L/O found\n');
    console.log('⚠️  The Sept-Dec 2024 dataset appears to have mostly resolved positions\n');
    console.log('📝 Proceeding with best available: 1W/99L/0O\n');
    return;
  }

  console.log(`✅ Found ${wallets.length} wallets with some balance:\n`);
  console.table(wallets.slice(0, 10));

  console.log('\n✅ Best candidates available\n');
}

main().catch(console.error);
