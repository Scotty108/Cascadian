import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const MISSING_CTFS = [
  '001dcf4c1446fcacb42af305419f7310e7c9c356b2366367c25eb7d6fb202b48',
  '00f92278bd8759aa69d9d1286f359f02f3f3615088907c8b5ac83438bda452af',
  '00abdc242048b65fa2e976bb31bf0018931768118cd3c05e87c26d1daace4beb',
  '00a972afa513fbe4fd5aa7e2dbda3149446ee40b3127f7a144cec584ae195d22',
  '001e511c90e45a81eb1783832455ebafd10785810d27daf195a2e26bdb99516e'
];

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PHASE 7.8: CHECK INTERNAL TABLES FOR MISSING CTF IDs');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Step 1: Checking api_ctf_bridge...\n');

  const bridgeQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        api_market_id AS slug,
        resolved_outcome AS outcome,
        resolved_at,
        source
      FROM api_ctf_bridge
      WHERE lower(replaceAll(condition_id, '0x', '')) IN (${MISSING_CTFS.map(c => `'${c}'`).join(', ')})
      ORDER BY condition_id
    `,
    format: 'JSONEachRow'
  });

  const bridgeResults: any[] = await bridgeQuery.json();

  console.log(`   Found ${bridgeResults.length} / 5 CTF IDs in api_ctf_bridge\n`);

  if (bridgeResults.length === 0) {
    console.log('   ❌ None found. Will need external API approach.\n');
    return;
  }

  bridgeResults.forEach((r, i) => {
    console.log(`   ${i + 1}. ${r.condition_id.substring(0, 20)}...`);
    console.log(`      Slug: ${r.slug}`);
    console.log(`      Outcome: ${r.outcome}`);
    console.log(`      Resolved at: ${r.resolved_at}`);
    console.log(`      Source: ${r.source}`);
    console.log();
  });

  console.log('Step 2: Building complete join chain...\n');

  const completeQuery = await clickhouse.query({
    query: `
      SELECT
        a.condition_id,
        a.api_market_id AS slug,
        a.resolved_outcome AS ctf_outcome,
        a.resolved_at AS ctf_resolved_at,
        k.condition_id_64,
        k.title,
        k.event_time,
        r.outcome AS market_outcome,
        r.resolved_at AS market_resolved_at
      FROM api_ctf_bridge a
      LEFT JOIN market_key_map k ON a.api_market_id = k.slug
      LEFT JOIN market_resolutions_by_market r ON a.api_market_id = r.slug
      WHERE lower(replaceAll(a.condition_id, '0x', '')) IN (${MISSING_CTFS.map(c => `'${c}'`).join(', ')})
      ORDER BY a.condition_id
    `,
    format: 'JSONEachRow'
  });

  const complete: any[] = await completeQuery.json();

  console.log(`   Complete mappings found: ${complete.length}\n`);

  complete.forEach((m, i) => {
    console.log(`   ${i + 1}. ${m.title || m.slug}`);
    console.log(`      CTF ID: ${m.condition_id.substring(0, 20)}...`);
    console.log(`      Condition ID (key_map): ${m.condition_id_64?.substring(0, 20) || 'N/A'}...`);
    console.log(`      Slug: ${m.slug}`);
    console.log(`      CTF outcome: ${m.ctf_outcome || 'NOT RESOLVED'}`);
    console.log(`      Market outcome: ${m.market_outcome || 'NOT RESOLVED'}`);
    console.log(`      CTF resolved at: ${m.ctf_resolved_at || 'N/A'}`);
    console.log(`      Market resolved at: ${m.market_resolved_at || 'N/A'}`);
    console.log();
  });

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const withResolution = complete.filter(c => c.market_outcome);
  const withConditionId = complete.filter(c => c.condition_id_64);

  console.log(`   Total found in bridge: ${bridgeResults.length} / 5`);
  console.log(`   With condition_id_64: ${withConditionId.length} / ${bridgeResults.length}`);
  console.log(`   With resolution: ${withResolution.length} / ${bridgeResults.length}\n`);

  if (withResolution.length > 0) {
    console.log(`   ✅ Can synthesize ${withResolution.length} resolutions from internal tables!`);
    console.log(`   Next: Run phase7-step9-insert-from-internal.ts\n`);
  }

  if (withConditionId.length > withResolution.length) {
    console.log(`   ⚠️  ${withConditionId.length - withResolution.length} markets have condition_id but no resolution`);
    console.log(`   Next: Query Goldsky for these condition IDs\n`);
  }

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
