#!/usr/bin/env npx tsx
/**
 * Fix Market Backfill - Fetch ALL markets including historical
 *
 * Issue: Previous backfill got 161K markets but missed old historical ones
 * Solution: Query with different filters to get complete history
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

interface GammaMarket {
  conditionId: string;
  question: string;
  slug: string;
  description?: string;
  outcomes: string | string[];
  active: boolean;
  closed: boolean;
  archived?: boolean;
  volume?: string;
  liquidity?: string;
  endDate?: string;
}

async function main() {
  console.log('\n🔍 FIXING MARKET BACKFILL - Getting Missing Markets\n');

  // Get list of condition_ids we're trading but don't have market data for
  console.log('Step 1: Finding missing markets...');

  const missing = await ch.query({
    query: `
      SELECT DISTINCT
        t.cid_hex as condition_id,
        COUNT(DISTINCT t.wallet_address) as wallet_count,
        COUNT(*) as trade_count
      FROM cascadian_clean.fact_trades_clean t
      LEFT JOIN default.api_markets_staging m
        ON lower(replaceAll(t.cid_hex, '0x', '')) = m.condition_id
      WHERE m.condition_id IS NULL
      GROUP BY t.cid_hex
      ORDER BY wallet_count DESC
      LIMIT 1000
    `,
    format: 'JSONEachRow'
  });

  const missingMarkets = await missing.json<Array<{
    condition_id: string;
    wallet_count: string;
    trade_count: string;
  }>>();

  console.log(`Found ${missingMarkets.length} missing markets`);
  console.log(`Top 10 by wallet count:`);
  missingMarkets.slice(0, 10).forEach((m, i) => {
    console.log(`  ${i+1}. ${m.condition_id.substring(0, 16)}... | ${m.wallet_count} wallets | ${m.trade_count} trades`);
  });

  // Fetch them from Gamma API
  console.log(`\nStep 2: Fetching from Gamma API...`);

  const fetchedMarkets: GammaMarket[] = [];
  let fetchCount = 0;

  for (const missing of missingMarkets.slice(0, 100)) { // Start with first 100
    try {
      const conditionId = missing.condition_id.toLowerCase().replace(/^0x/, '');
      const url = `https://gamma-api.polymarket.com/markets?condition_id=0x${conditionId}`;

      const response = await fetch(url);
      if (!response.ok) continue;

      const markets: GammaMarket[] = await response.json();

      if (markets.length > 0) {
        fetchedMarkets.push(markets[0]);
        fetchCount++;

        if (fetchCount % 10 === 0) {
          process.stdout.write(`\r  Fetched: ${fetchCount}/${Math.min(100, missingMarkets.length)}`);
        }
      }

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 50));

    } catch (error) {
      // Skip errors
    }
  }

  console.log(`\n  ✅ Successfully fetched ${fetchedMarkets.length} markets\n`);

  // Insert into ClickHouse
  if (fetchedMarkets.length > 0) {
    console.log('Step 3: Inserting into api_markets_staging...');

    const rows = fetchedMarkets.map(m => {
      let outcomes: string[] = [];
      if (typeof m.outcomes === 'string') {
        try {
          outcomes = JSON.parse(m.outcomes);
        } catch {
          outcomes = [];
        }
      } else {
        outcomes = m.outcomes || [];
      }

      return {
        condition_id: m.conditionId.toLowerCase().replace('0x', ''),
        market_slug: m.slug || '',
        question: m.question || '',
        description: m.description || '',
        outcomes: outcomes,
        active: m.active ?? false,
        closed: m.closed ?? false,
        resolved: false,
        winning_outcome: null,
        end_date: m.endDate ? new Date(m.endDate) : null,
        volume: parseFloat(m.volume || '0'),
        liquidity: parseFloat(m.liquidity || '0'),
        timestamp: new Date(),
      };
    });

    await ch.insert({
      table: 'default.api_markets_staging',
      values: rows,
      format: 'JSONEachRow',
    });

    console.log(`  ✅ Inserted ${rows.length} markets\n`);
  }

  // Verify
  console.log('Step 4: Verification...');

  const verify = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_markets,
        COUNT(DISTINCT condition_id) as unique_conditions
      FROM default.api_markets_staging
    `,
    format: 'JSONEachRow'
  });

  const stats = await verify.json<any>();
  console.log(`  Total markets in staging: ${parseInt(stats[0].total_markets).toLocaleString()}`);
  console.log(`  Unique conditions: ${parseInt(stats[0].unique_conditions).toLocaleString()}\n`);

  // Check how many are still missing
  const stillMissing = await ch.query({
    query: `
      SELECT COUNT(DISTINCT t.cid_hex) as still_missing
      FROM cascadian_clean.fact_trades_clean t
      LEFT JOIN default.api_markets_staging m
        ON lower(replaceAll(t.cid_hex, '0x', '')) = m.condition_id
      WHERE m.condition_id IS NULL
    `,
    format: 'JSONEachRow'
  });

  const remaining = await stillMissing.json<any>();
  console.log(`Markets still missing: ${parseInt(remaining[0].still_missing).toLocaleString()}\n`);

  console.log('═'.repeat(80));
  console.log('📊 RECOMMENDATION\n');

  const remainingCount = parseInt(remaining[0].still_missing);

  if (remainingCount > 1000) {
    console.log(`Still have ${remainingCount.toLocaleString()} missing markets.`);
    console.log(`\nNeed to run full backfill with better strategy:`);
    console.log(`1. Fetch ALL traded condition_ids (not paginated markets)`);
    console.log(`2. Query Gamma for each: /markets?condition_id=0x...`);
    console.log(`3. This ensures we get every market we actually traded\n`);
    console.log(`Script: backfill-missing-markets-complete.ts`);
    console.log(`Runtime: ~2-4 hours for ${remainingCount.toLocaleString()} markets`);
  } else {
    console.log(`✅ Good progress! Only ${remainingCount.toLocaleString()} markets remaining`);
    console.log(`\nCan finish with: npx tsx fix-market-backfill.ts (run again)`);
  }

  console.log('═'.repeat(80) + '\n');

  await ch.close();
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
