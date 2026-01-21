#!/usr/bin/env npx tsx
/**
 * Backfill Unknown Markets
 *
 * Attempts to find metadata for high-volume condition_ids that are missing from our tables.
 * Uses multiple strategies:
 * 1. Search by condition_id with 0x prefix
 * 2. Look up via event/market relationships
 * 3. Check if they're NegRisk child markets
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const GAMMA_API = 'https://gamma-api.polymarket.com';
const BATCH_SIZE = 100;
const DELAY_MS = 100;

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchMarketByConditionId(conditionId: string): Promise<any | null> {
  // Try with 0x prefix
  const url = `${GAMMA_API}/markets?condition_id=0x${conditionId}`;
  try {
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      // Filter to find exact match (API returns all markets when condition_id doesn't match)
      const match = (data as any[]).find(m =>
        m.conditionId?.toLowerCase().replace('0x', '') === conditionId.toLowerCase()
      );
      if (match) {
        return match;
      }
    }
  } catch (e) {
    // Ignore
  }
  return null;
}

async function getUnmappedConditions(): Promise<{cid: string, volume: number}[]> {
  const q = await clickhouse.query({
    query: `
      SELECT f.condition_id as cid, round(sum(abs(f.usdc_delta)), 2) as volume
      FROM pm_canonical_fills_v4 f
      LEFT JOIN pm_market_metadata m ON f.condition_id = m.condition_id
      LEFT JOIN pm_token_to_condition_map_v5 v5 ON f.condition_id = v5.condition_id
      LEFT JOIN pm_token_to_condition_patch p ON f.condition_id = p.condition_id
      WHERE f.source != 'negrisk'
        AND NOT (f.is_self_fill = 1 AND f.is_maker = 1)
        AND f.condition_id != ''
        AND COALESCE(nullIf(m.question, ''), nullIf(v5.question, ''), nullIf(p.question, ''), '') = ''
      GROUP BY f.condition_id
      HAVING sum(abs(f.usdc_delta)) > 10000
      ORDER BY sum(abs(f.usdc_delta)) DESC
      LIMIT ${BATCH_SIZE}
    `,
    format: 'JSONEachRow',
  });
  return await q.json() as any[];
}

function escape(str: string): string {
  return str.replace(/'/g, "\\'").replace(/\n/g, ' ').replace(/\\/g, '\\\\');
}

async function insertToPatch(market: any, conditionId: string): Promise<boolean> {
  const question = market.question || '';
  const category = market.category || '';

  // Get token_ids from the market
  let tokenIds: string[] = [];
  if (market.clobTokenIds) {
    try {
      tokenIds = JSON.parse(market.clobTokenIds);
    } catch {}
  }

  if (!question) return false;

  // Insert into patch table for each outcome
  for (let i = 0; i < (tokenIds.length || 2); i++) {
    const tokenId = tokenIds[i] || '';
    await clickhouse.command({
      query: `
        INSERT INTO pm_token_to_condition_patch
        (token_id_dec, condition_id, outcome_index, question, category)
        VALUES ('${escape(tokenId)}', '${escape(conditionId)}', ${i}, '${escape(question)}', '${escape(category)}')
      `,
    });
  }

  return true;
}

async function main() {
  console.log('🔍 Backfilling Unknown Markets');
  console.log('='.repeat(60));

  // Get unmapped condition_ids
  const unmapped = await getUnmappedConditions();
  console.log(`Found ${unmapped.length} unmapped condition_ids with >$10k volume`);

  let found = 0;
  let notFound = 0;

  for (const { cid, volume } of unmapped) {
    const market = await fetchMarketByConditionId(cid);

    if (market && market.question) {
      const inserted = await insertToPatch(market, cid);
      if (inserted) {
        found++;
        console.log(`  ✅ ${cid.slice(0, 16)}... -> "${market.question.slice(0, 50)}..." ($${(volume / 1000).toFixed(0)}k)`);
      }
    } else {
      notFound++;
      if (notFound <= 5) {
        console.log(`  ❌ ${cid.slice(0, 16)}... not found ($${(volume / 1000).toFixed(0)}k)`);
      }
    }

    await sleep(DELAY_MS);
  }

  console.log('\n' + '='.repeat(60));
  console.log(`✅ Found: ${found}`);
  console.log(`❌ Not found: ${notFound}`);
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
