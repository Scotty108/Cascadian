#!/usr/bin/env tsx
/**
 * Backfill ALL Resolved Payouts from Goldsky Subgraph
 *
 * Instead of querying specific condition IDs, this fetches EVERY resolved
 * condition from Goldsky and inserts into resolutions_external_ingest.
 *
 * This complements market_resolutions_final with a second source of truth.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const GOLDSKY_ENDPOINT =
  'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/positions-subgraph/0.0.7/gn';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  request_timeout: 120000, // 2 minute timeout for large inserts
});

interface Condition {
  id: string;
  payouts: string[];
}

async function fetchResolvedConditions(first: number, skip: number): Promise<Condition[]> {
  const query = `{
    conditions(
      first: ${first}
      skip: ${skip}
      where: {payouts_not: null}
      orderBy: id
      orderDirection: asc
    ) {
      id
      payouts
    }
  }`;

  const response = await fetch(GOLDSKY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    throw new Error(`Goldsky error: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  return result.data.conditions;
}

async function main() {
  console.log('================================================================================');
  console.log('🚀 BACKFILL ALL RESOLVED PAYOUTS FROM GOLDSKY');
  console.log('================================================================================\n');

  let skip = 0;
  const first = 1000;
  let totalFetched = 0;
  let totalInserted = 0;

  while (true) {
    console.log(`📡 Fetching batch (skip: ${skip}, limit: ${first})...`);

    const conditions = await fetchResolvedConditions(first, skip);

    if (conditions.length === 0) {
      console.log('✅ No more conditions to fetch.');
      break;
    }

    console.log(`   Found ${conditions.length} conditions`);
    totalFetched += conditions.length;

    // Parse and insert
    const rows = conditions
      .map((c) => {
        try {
          const payouts = c.payouts.map((p) => {
            const num = parseFloat(p);
            if (isNaN(num)) throw new Error(`Invalid payout: ${p}`);
            return num;
          });

          // Skip invalid payouts
          if (payouts.length === 0) {
            return null;
          }

          const maxPayout = Math.max(...payouts);
          const winningIndex = payouts.findIndex((p) => p === maxPayout);
          const denominator = payouts.reduce((sum, p) => sum + p, 0);

          if (denominator === 0) {
            return null; // Skip zero-sum payouts
          }

          return {
            condition_id: c.id.toLowerCase().replace(/^0x/, ''),
            payout_numerators: payouts,
            payout_denominator: denominator,
            winning_index: winningIndex,
            resolved_at: new Date().toISOString(),
            source: 'goldsky-api',
          };
        } catch (e) {
          console.warn(`   ⚠️  Skipping invalid condition ${c.id}: ${e}`);
          return null;
        }
      })
      .filter((r) => r !== null);

    if (rows.length > 0) {
      // Use raw INSERT query to avoid JSONEachRow decimal array bug
      const values = rows
        .map((row) => {
          const arrayStr = `[${row.payout_numerators.join(',')}]`;
          return `('${row.condition_id}', ${arrayStr}, ${row.payout_denominator}, ${row.winning_index}, '${row.resolved_at}', '${row.source}')`;
        })
        .join(',\n        ');

      const query = `
        INSERT INTO default.resolutions_external_ingest
        (condition_id, payout_numerators, payout_denominator, winning_index, resolved_at, source)
        VALUES
        ${values}
      `;

      await ch.command({ query });
      totalInserted += rows.length;
      console.log(`   ✅ Inserted ${rows.length} payouts`);
    }

    console.log(`   Progress: ${totalFetched} fetched, ${totalInserted} inserted\n`);

    if (conditions.length < first) {
      console.log('✅ Reached end of results.');
      break;
    }

    skip += first;

    // Rate limiting
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log('\n================================================================================');
  console.log('✅ BACKFILL COMPLETE');
  console.log('================================================================================');
  console.log(`📊 Total conditions fetched: ${totalFetched}`);
  console.log(`📊 Total payouts inserted: ${totalInserted}`);
  console.log('\n✅ Next step: Refresh vw_resolutions_truth to union this data');

  await ch.close();
}

main().catch(console.error);
