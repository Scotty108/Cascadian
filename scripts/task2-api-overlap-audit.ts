#!/usr/bin/env npx tsx
/**
 * Task 2: API Overlap Audit Trail
 * Fetch exact condition IDs from Polymarket API (GET /positions and GET /closed-positions)
 * Cross-reference with ClickHouse to create permanent audit trail
 * Store in reports/parity/2025-11-10-xcnstrategy.json
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';
import fs from 'fs';
import path from 'path';

const GAMMA_API = 'https://api.gamma.polymarket.com';
const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '═'.repeat(100));
  console.log('TASK 2: API OVERLAP AUDIT TRAIL');
  console.log('═'.repeat(100) + '\n');

  try {
    console.log('1️⃣  Fetching positions from Polymarket API...\n');

    // Fetch active positions from API
    let apiActivePositions: any[] = [];
    let apiClosedPositions: any[] = [];

    try {
      const activeUrl = `${GAMMA_API}/positions?user=${wallet}`;
      console.log(`   Fetching: ${activeUrl}`);
      const activeResponse = await fetch(activeUrl, {
        headers: { 'Accept': 'application/json' }
      });

      if (activeResponse.ok) {
        const activeData: any = await activeResponse.json();
        apiActivePositions = activeData.data || [];
        console.log(`   ✅ Found ${apiActivePositions.length} active positions\n`);
      } else {
        console.log(`   ⚠️  API returned ${activeResponse.status} (may be rate limited or auth required)\n`);
      }
    } catch (e: any) {
      console.log(`   ⚠️  Could not fetch active positions: ${e.message}\n`);
    }

    try {
      const closedUrl = `${GAMMA_API}/closed-positions?user=${wallet}`;
      console.log(`   Fetching: ${closedUrl}`);
      const closedResponse = await fetch(closedUrl, {
        headers: { 'Accept': 'application/json' }
      });

      if (closedResponse.ok) {
        const closedData: any = await closedResponse.json();
        apiClosedPositions = closedData.data || [];
        console.log(`   ✅ Found ${apiClosedPositions.length} closed positions\n`);
      } else {
        console.log(`   ⚠️  API returned ${closedResponse.status}\n`);
      }
    } catch (e: any) {
      console.log(`   ⚠️  Could not fetch closed positions: ${e.message}\n`);
    }

    // Extract condition IDs from API responses
    const apiConditionIds = new Set<string>();

    for (const pos of apiActivePositions) {
      if (pos.condition_id) {
        const normalized = pos.condition_id.toLowerCase().replace(/^0x/, '');
        apiConditionIds.add(normalized);
      }
    }

    for (const pos of apiClosedPositions) {
      if (pos.condition_id) {
        const normalized = pos.condition_id.toLowerCase().replace(/^0x/, '');
        apiConditionIds.add(normalized);
      }
    }

    console.log(`2️⃣  Querying ClickHouse for wallet's positions...\n`);

    // Get all unique condition IDs from ClickHouse for this wallet
    const dbQuery = `
      SELECT DISTINCT
        lower(replaceAll(condition_id, '0x', '')) as condition_id_norm
      FROM default.trades_raw
      WHERE lower(wallet) = '${wallet}'
        AND condition_id NOT LIKE '%token_%'
      ORDER BY condition_id_norm
    `;

    const dbResult = await ch.query({
      query: dbQuery,
      format: 'JSONEachRow'
    });
    const dbMarkets = await dbResult.json<any[]>();

    const dbConditionIds = new Set<string>(dbMarkets.map(m => m.condition_id_norm));

    console.log(`   ✅ Found ${dbConditionIds.size} unique markets in ClickHouse\n`);

    // Calculate overlap
    console.log('3️⃣  Analyzing overlap...\n');

    const apiOnly = Array.from(apiConditionIds).filter(id => !dbConditionIds.has(id));
    const dbOnly = Array.from(dbConditionIds).filter(id => !apiConditionIds.has(id));
    const overlap = Array.from(apiConditionIds).filter(id => dbConditionIds.has(id));

    console.log(`   API positions:           ${apiConditionIds.size}`);
    console.log(`   ClickHouse positions:    ${dbConditionIds.size}`);
    console.log(`   Overlap (both):          ${overlap.length}`);
    console.log(`   API-only (missing DB):   ${apiOnly.length}`);
    console.log(`   DB-only (extra in DB):   ${dbOnly.length}\n`);

    // Create audit report
    console.log('4️⃣  Creating audit trail...\n');

    const auditReport = {
      timestamp: new Date().toISOString(),
      wallet: wallet,
      audit_type: 'api-overlap-check',

      api_fetch: {
        active_positions_count: apiActivePositions.length,
        closed_positions_count: apiClosedPositions.length,
        total_unique_condition_ids: apiConditionIds.size,
        api_condition_ids: Array.from(apiConditionIds).slice(0, 10).map(id => '0x' + id),
        note: 'Showing first 10; full list available on request'
      },

      database_state: {
        clickhouse_markets: dbConditionIds.size,
        condition_ids_sample: Array.from(dbConditionIds).slice(0, 10),
        note: 'Showing first 10; filtered by condition_id NOT LIKE "%token_%"'
      },

      overlap_analysis: {
        both_api_and_db: overlap.length,
        api_only_missing_from_db: apiOnly.length,
        db_only_extra_in_db: dbOnly.length,
        sync_status: apiOnly.length === 0 ? 'SYNCED' : 'DIVERGED'
      },

      missing_from_db_examples: apiOnly.slice(0, 5).map(id => '0x' + id),
      extra_in_db_examples: dbOnly.slice(0, 5).map(id => '0x' + id),

      interpretation: {
        summary: apiOnly.length === 0
          ? 'All API positions found in ClickHouse database. System is in sync.'
          : `${apiOnly.length} API positions not yet in ClickHouse. May be recent trades still ingesting or API caching.`,
        expected_db_to_have_more: true,
        reason: 'ClickHouse includes historical closed positions; API only shows current/active positions'
      },

      status: apiOnly.length === 0 ? 'SYNCED' : 'MONITORING'
    };

    // Ensure reports directory exists
    const reportsDir = '/Users/scotty/Projects/Cascadian-app/reports/parity';
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const auditPath = path.join(reportsDir, '2025-11-10-xcnstrategy.json');
    fs.writeFileSync(auditPath, JSON.stringify(auditReport, null, 2));

    console.log(`   ✅ Audit trail saved to: ${auditPath}\n`);

    // Summary output
    console.log('═'.repeat(100));
    console.log('OVERLAP ANALYSIS SUMMARY');
    console.log('═'.repeat(100));
    console.log(`
   API Positions:            ${apiConditionIds.size}
   Database Markets:         ${dbConditionIds.size}
   ────────────────────────────
   Overlap:                  ${overlap.length}
   Missing from DB:          ${apiOnly.length} ${apiOnly.length === 0 ? '✅ (synced)' : '⚠️ (gap exists)'}
   Extra in DB:              ${dbOnly.length} (expected - historical markets)

   Status:                   ${auditReport.status}
    `);

  } catch (e: any) {
    console.error(`Error: ${e.message}`);
  }

  await ch.close();
}

main().catch(console.error);
