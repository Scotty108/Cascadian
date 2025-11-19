#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function validateAnalyses() {
  console.log('\n==============================================');
  console.log('VALIDATION: Who Is Right?');
  console.log('==============================================\n');

  try {
    // 1. Check mapping job results
    console.log('1️⃣  MAPPING JOB RESULTS:');
    console.log('─'.repeat(50));
    const mappingResult = await clickhouse.query({
      query: 'SELECT COUNT(*) as total FROM default.legacy_token_condition_map',
      format: 'JSONEachRow'
    });
    const mappingData = await mappingResult.json();
    console.log(`   ✅ Total mappings built: ${mappingData[0].total.toLocaleString()}`);
    console.log('');

    // 2. Resolution coverage check
    console.log('2️⃣  RESOLUTION COVERAGE (Testing Claude 2\'s "171K missing" claim):');
    console.log('─'.repeat(50));
    const coverageResult = await clickhouse.query({
      query: `
        WITH
        traded_markets AS (
          SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid
          FROM default.vw_trades_canonical
          WHERE condition_id_norm != ''
        ),
        all_resolutions AS (
          SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid
          FROM default.market_resolutions_final
          UNION DISTINCT
          SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid
          FROM default.resolutions_external_ingest
        )
        SELECT
          (SELECT COUNT(*) FROM traded_markets) as total_traded_markets,
          (SELECT COUNT(*) FROM all_resolutions) as total_resolutions,
          COUNT(*) as markets_with_resolutions,
          (SELECT COUNT(*) FROM traded_markets) - COUNT(*) as missing_resolutions,
          ROUND((COUNT(*) * 100.0) / (SELECT COUNT(*) FROM traded_markets), 2) as coverage_pct
        FROM traded_markets t
        INNER JOIN all_resolutions r ON t.cid = r.cid
      `,
      format: 'JSONEachRow'
    });
    const covData = await coverageResult.json();
    console.log(`   Total traded markets: ${covData[0].total_traded_markets.toLocaleString()}`);
    console.log(`   Total resolutions available: ${covData[0].total_resolutions.toLocaleString()}`);
    console.log(`   Markets WITH resolutions: ${covData[0].markets_with_resolutions.toLocaleString()}`);
    console.log(`   Markets MISSING resolutions: ${covData[0].missing_resolutions.toLocaleString()}`);
    console.log(`   Coverage: ${covData[0].coverage_pct}%`);

    if (covData[0].missing_resolutions > 170000) {
      console.log(`   🔴 CLAUDE 2 IS RIGHT: ${covData[0].missing_resolutions.toLocaleString()} markets missing resolutions`);
    } else {
      console.log(`   🟢 CLAUDE 1 IS RIGHT: Only ${covData[0].missing_resolutions.toLocaleString()} missing (most markets not resolved yet)`);
    }
    console.log('');

    // 3. Age analysis
    console.log('3️⃣  AGE ANALYSIS (Are unresolved markets "still open" or "abandoned"?):');
    console.log('─'.repeat(50));
    const ageResult = await clickhouse.query({
      query: `
        WITH
        traded_markets AS (
          SELECT DISTINCT
            lower(replaceAll(condition_id_norm, '0x', '')) as cid,
            MIN(timestamp) as first_trade
          FROM default.vw_trades_canonical
          WHERE condition_id_norm != ''
          GROUP BY cid
        ),
        all_resolutions AS (
          SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid
          FROM default.market_resolutions_final
          UNION DISTINCT
          SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid
          FROM default.resolutions_external_ingest
        ),
        unresolved AS (
          SELECT t.cid, t.first_trade
          FROM traded_markets t
          LEFT JOIN all_resolutions r ON t.cid = r.cid
          WHERE r.cid IS NULL
        )
        SELECT
          COUNT(*) as total_unresolved,
          countIf(first_trade < now() - INTERVAL 90 DAY) as older_than_90_days,
          countIf(first_trade < now() - INTERVAL 30 DAY) as older_than_30_days,
          countIf(first_trade >= now() - INTERVAL 30 DAY) as last_30_days,
          ROUND((countIf(first_trade < now() - INTERVAL 90 DAY) * 100.0) / COUNT(*), 2) as pct_90plus_days,
          ROUND((countIf(first_trade >= now() - INTERVAL 30 DAY) * 100.0) / COUNT(*), 2) as pct_last_30_days
        FROM unresolved
      `,
      format: 'JSONEachRow'
    });
    const ageData = await ageResult.json();
    console.log(`   Total unresolved markets: ${ageData[0].total_unresolved.toLocaleString()}`);
    console.log(`   Older than 90 days: ${ageData[0].older_than_90_days.toLocaleString()} (${ageData[0].pct_90plus_days}%)`);
    console.log(`   Older than 30 days: ${ageData[0].older_than_30_days.toLocaleString()}`);
    console.log(`   Last 30 days (likely still open): ${ageData[0].last_30_days.toLocaleString()} (${ageData[0].pct_last_30_days}%)`);

    if (ageData[0].pct_90plus_days > 60) {
      console.log(`   🔴 CLAUDE 2 IS RIGHT: ${ageData[0].pct_90plus_days}% are 90+ days old (abandoned, need API backfill)`);
    } else {
      console.log(`   🟢 CLAUDE 1 IS RIGHT: ${ageData[0].pct_last_30_days}% are recent (markets still open)`);
    }
    console.log('');

    // 4. Check if cascadian_clean.vw_wallet_pnl_closed exists
    console.log('4️⃣  EXISTING P&L VIEWS (Testing Claude 1\'s "ship today" claim):');
    console.log('─'.repeat(50));
    try {
      const viewResult = await clickhouse.query({
        query: 'SELECT COUNT(*) as row_count FROM cascadian_clean.vw_wallet_pnl_closed LIMIT 1',
        format: 'JSONEachRow'
      });
      const viewData = await viewResult.json();
      console.log(`   ✅ cascadian_clean.vw_wallet_pnl_closed EXISTS`);
      console.log(`   Row count: ${viewData[0].row_count.toLocaleString()}`);
    } catch (e: any) {
      console.log(`   ❌ cascadian_clean.vw_wallet_pnl_closed DOES NOT EXIST`);
      console.log(`   Error: ${e.message}`);
    }
    console.log('');

    // 5. Test wallet 0x9155e8cf BEFORE applying mapping
    console.log('5️⃣  WALLET 0x9155e8cf COVERAGE (Before mapping applied):');
    console.log('─'.repeat(50));
    const walletResult = await clickhouse.query({
      query: `
        WITH
        wallet_trades AS (
          SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid
          FROM default.vw_trades_canonical
          WHERE lower(wallet_address_norm) = '0x9155e8cf81a3fb557639d23d43f1528675bcfcad'
        ),
        all_resolutions AS (
          SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid
          FROM default.market_resolutions_final
          UNION DISTINCT
          SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid
          FROM default.resolutions_external_ingest
        )
        SELECT
          (SELECT COUNT(*) FROM wallet_trades) as total_markets,
          COUNT(*) as with_resolutions,
          ROUND((COUNT(*) * 100.0) / (SELECT COUNT(*) FROM wallet_trades), 2) as coverage_pct
        FROM wallet_trades t
        INNER JOIN all_resolutions r ON t.cid = r.cid
      `,
      format: 'JSONEachRow'
    });
    const walletData = await walletResult.json();
    console.log(`   Total markets traded: ${walletData[0].total_markets.toLocaleString()}`);
    console.log(`   Markets with resolutions: ${walletData[0].with_resolutions.toLocaleString()}`);
    console.log(`   Coverage: ${walletData[0].coverage_pct}%`);
    console.log('');

    // 6. Sample check: What do the unmapped IDs look like?
    console.log('6️⃣  SAMPLE UNRESOLVED CONDITION IDs (Understanding the gap):');
    console.log('─'.repeat(50));
    const sampleResult = await clickhouse.query({
      query: `
        WITH
        wallet_trades AS (
          SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid
          FROM default.vw_trades_canonical
          WHERE lower(wallet_address_norm) = '0x9155e8cf81a3fb557639d23d43f1528675bcfcad'
        ),
        all_resolutions AS (
          SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid
          FROM default.market_resolutions_final
          UNION DISTINCT
          SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid
          FROM default.resolutions_external_ingest
        )
        SELECT t.cid
        FROM wallet_trades t
        LEFT JOIN all_resolutions r ON t.cid = r.cid
        WHERE r.cid IS NULL
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const sampleData = await sampleResult.json();
    console.log('   Sample of 10 unresolved condition IDs:');
    sampleData.forEach((row: any, i: number) => {
      console.log(`   ${i + 1}. ${row.cid}`);
    });
    console.log('');

    // VERDICT
    console.log('==============================================');
    console.log('📊 VERDICT:');
    console.log('==============================================\n');

    const missingPct = ((covData[0].missing_resolutions / covData[0].total_traded_markets) * 100).toFixed(2);

    console.log(`Coverage: ${covData[0].coverage_pct}% of traded markets have resolutions`);
    console.log(`Missing: ${covData[0].missing_resolutions.toLocaleString()} markets (${missingPct}%)\n`);

    if (covData[0].missing_resolutions > 100000 && ageData[0].pct_90plus_days > 50) {
      console.log('🔴 CLAUDE 2 IS CORRECT:');
      console.log('   - 100K+ markets missing resolution data');
      console.log(`   - ${ageData[0].pct_90plus_days}% of unresolved are 90+ days old`);
      console.log('   - This is NOT "markets still open" - this is missing data');
      console.log('   - NEED: API backfill of resolutions');
      console.log('');
      console.log('❌ CLAUDE 1 IS WRONG:');
      console.log('   - "85% markets not resolved yet" is FALSE');
      console.log('   - Most unresolved markets are abandoned/completed without data');
    } else {
      console.log('🟢 CLAUDE 1 IS CORRECT:');
      console.log('   - Most markets are genuinely still open');
      console.log(`   - ${ageData[0].pct_last_30_days}% of unresolved are recent (< 30 days)`);
      console.log('   - Can ship realized P&L today');
      console.log('');
      console.log('❌ CLAUDE 2 IS WRONG:');
      console.log('   - "171K missing resolutions" is an overestimate');
      console.log('   - Markets are open, not missing data');
    }

  } catch (error) {
    console.error('Error running validation:', error);
  } finally {
    await clickhouse.close();
  }
}

validateAnalyses();
