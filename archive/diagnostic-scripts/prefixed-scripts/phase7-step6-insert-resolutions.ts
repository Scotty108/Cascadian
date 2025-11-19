import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import { readFileSync } from 'fs';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PHASE 7.6: INSERT RESOLUTIONS WITH CORRECT MAPPING');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load mapping results
  const mapping = JSON.parse(readFileSync('tmp/phase7-complete-mapping.json', 'utf8'));

  console.log(`Loaded ${mapping.length} markets with mappings\n`);

  // Step 1: Update bridge for target CTFs
  console.log('Step 1: Updating bridge mappings...\n');

  for (const market of mapping) {
    const targetCtfs = market.decodedCtfIds.filter((c: any) => c.is_target);

    if (targetCtfs.length === 0) continue;

    const marketId64 = market.conditionId.toLowerCase().replace('0x', '').padStart(64, '0');

    for (const ctf of targetCtfs) {
      console.log(`   Updating ${ctf.ctf_hex64.substring(0, 20)}...`);
      console.log(`      Old market_hex64: ${ctf.ctf_hex64.substring(0, 20)}... (identity fallback)`);
      console.log(`      New market_hex64: ${marketId64.substring(0, 20)}... (correct mapping)`);

      // Update bridge (ReplacingMergeTree will handle the replacement)
      await clickhouse.command({
        query: `
          INSERT INTO ctf_to_market_bridge_mat (ctf_hex64, market_hex64, source, vote_count)
          VALUES (
            '${ctf.ctf_hex64}',
            '${marketId64}',
            'polymarket_api',
            100
          )
        `
      });

      console.log(`      ✅ Bridge updated\n`);
    }
  }

  // Step 2: Insert resolutions
  console.log('Step 2: Inserting resolution data...\n');

  for (const market of mapping) {
    const marketId64 = market.conditionId.toLowerCase().replace('0x', '').padStart(64, '0');

    // Check if already exists
    const existsQuery = await clickhouse.query({
      query: `
        SELECT count() AS cnt
        FROM market_resolutions_final
        WHERE lower(condition_id_norm) = lower('${marketId64}')
      `,
      format: 'JSONEachRow'
    });
    const exists = await existsQuery.json();

    if (Number(exists[0].cnt) > 0) {
      console.log(`   ${market.question}`);
      console.log(`      ⚠️  Already exists, skipping\n`);
      continue;
    }

    console.log(`   ${market.question}`);
    console.log(`      Market ID: ${marketId64.substring(0, 20)}...`);
    console.log(`      Outcomes: ${market.outcomes.join(', ')}`);
    console.log(`      Prices: ${market.outcomePrices.join(', ')}`);

    // Insert resolution
    await clickhouse.command({
      query: `
        INSERT INTO market_resolutions_final (
          condition_id_norm,
          payout_numerators,
          payout_denominator,
          resolved_at
        ) VALUES (
          '${marketId64}',
          [${market.outcomePrices.join(', ')}],
          1,
          '${market.endDateIso}T00:00:00Z'
        )
      `
    });

    console.log(`      ✅ Resolution inserted\n`);
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PHASE 7.6 COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`   ✅ Bridge updated for ${mapping.reduce((sum, m) => sum + m.decodedCtfIds.filter((c: any) => c.is_target).length, 0)} CTF IDs`);
  console.log(`   ✅ ${mapping.length} resolutions inserted\n`);

  console.log('   Next steps:');
  console.log('   1. Re-run Phase 3 (PPS rebuild): npx tsx phase3-rebuild-pps.ts');
  console.log('   2. Re-run Phase 4 (Burns valuation): npx tsx phase4-burns-valuation.ts');
  console.log('   3. Check if gap closed\n');

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
