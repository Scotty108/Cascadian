#!/usr/bin/env npx tsx
/**
 * Sync recent resolutions from Polymarket Gamma API to pm_condition_resolutions
 *
 * Faster than blockchain RPC - fetches closed markets from API
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  request_timeout: 120000,
});

const GAMMA_API = 'https://gamma-api.polymarket.com';

interface Market {
  condition_id: string;
  closed: boolean;
  end_date_iso: string;
  tokens: Array<{
    token_id: string;
    outcome: string;
    winner: boolean;
  }>;
}

async function getUnresolvedConditions(): Promise<string[]> {
  // Get conditions that have trades in the last 7 days but no resolution yet
  const result = await client.query({
    query: `
      SELECT DISTINCT condition_id
      FROM pm_canonical_fills_v4
      WHERE event_time > now() - INTERVAL 7 DAY
        AND condition_id != ''
        AND condition_id NOT IN (
          SELECT condition_id FROM pm_condition_resolutions WHERE is_deleted = 0
        )
      LIMIT 5000
    `,
    format: 'JSONEachRow',
  });
  const rows = await result.json() as any[];
  return rows.map(r => r.condition_id);
}

async function fetchMarketResolution(conditionId: string): Promise<Market | null> {
  try {
    // Try with 0x prefix
    let url = `${GAMMA_API}/markets?condition_id=0x${conditionId}`;
    let response = await fetch(url);

    if (!response.ok && response.status !== 404) {
      // Try without 0x prefix
      url = `${GAMMA_API}/markets?condition_id=${conditionId}`;
      response = await fetch(url);
    }

    if (!response.ok) return null;

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    return data[0];
  } catch {
    return null;
  }
}

async function insertResolution(conditionId: string, market: Market) {
  // Extract payout info from tokens
  const tokens = market.tokens || [];
  const payoutNumerators = tokens.map(t => t.winner ? 1 : 0);
  const payoutDenominator = 1;

  // Estimate block number from time (rough estimate: ~2 sec per block on Polygon)
  const resolvedAt = new Date(market.end_date_iso);
  const blockEstimate = Math.floor(82000000 + (resolvedAt.getTime() - new Date('2026-01-01').getTime()) / 2000);

  await client.insert({
    table: 'pm_condition_resolutions',
    values: [{
      condition_id: conditionId,
      payout_numerators: JSON.stringify(payoutNumerators),
      payout_denominator: payoutDenominator.toString(),
      resolved_at: resolvedAt.toISOString().replace('T', ' ').slice(0, 19),
      block_number: blockEstimate,
      tx_hash: '', // Unknown from API
      is_deleted: 0,
    }],
    format: 'JSONEachRow',
  });
}

async function main() {
  console.log('🔄 Syncing resolutions from Polymarket Gamma API\n');

  // Get stats
  const statsResult = await client.query({
    query: 'SELECT count() as cnt, max(resolved_at) as latest FROM pm_condition_resolutions WHERE is_deleted = 0',
    format: 'JSONEachRow',
  });
  const stats = (await statsResult.json() as any[])[0];
  console.log(`📊 Current resolutions: ${parseInt(stats.cnt).toLocaleString()}`);
  console.log(`   Latest: ${stats.latest}\n`);

  // Get unresolved conditions with recent activity
  console.log('📋 Finding conditions that need resolution data...');
  const conditions = await getUnresolvedConditions();
  console.log(`   Found ${conditions.length} conditions to check\n`);

  if (conditions.length === 0) {
    console.log('✅ No new resolutions needed');
    await client.close();
    return;
  }

  let resolved = 0;
  let open = 0;
  let errors = 0;

  for (let i = 0; i < conditions.length; i++) {
    const conditionId = conditions[i];

    if ((i + 1) % 100 === 0) {
      console.log(`  [${i + 1}/${conditions.length}] Resolved: ${resolved}, Open: ${open}, Errors: ${errors}`);
    }

    try {
      const market = await fetchMarketResolution(conditionId);

      if (!market) {
        errors++;
        continue;
      }

      if (!market.closed || !market.end_date_iso) {
        open++;
        continue;
      }

      await insertResolution(conditionId, market);
      resolved++;

    } catch (error: any) {
      errors++;
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 50));
  }

  console.log(`\n✅ Synced ${resolved} new resolutions`);
  console.log(`   Open markets: ${open}`);
  console.log(`   Errors: ${errors}`);

  // Verify
  const finalResult = await client.query({
    query: 'SELECT count() as cnt, max(resolved_at) as latest FROM pm_condition_resolutions WHERE is_deleted = 0',
    format: 'JSONEachRow',
  });
  const finalStats = (await finalResult.json() as any[])[0];
  console.log(`\n📊 Total resolutions: ${parseInt(finalStats.cnt).toLocaleString()}`);
  console.log(`   Latest: ${finalStats.latest}`);

  await client.close();
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
