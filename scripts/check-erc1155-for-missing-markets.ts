#!/usr/bin/env npx tsx
/**
 * Check if "missing" CLOB markets have ERC1155 transfer activity
 *
 * Hypothesis: Markets missing from CLOB might still have AMM trades
 * visible in ERC1155 transfers
 */

import { clickhouse } from '../lib/clickhouse/client';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║   Checking ERC1155 Activity for "Missing" CLOB Markets       ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  // Get sample of "missing" markets (no CLOB fills)
  console.log('Step 1: Get sample of markets missing from CLOB...\n');

  const missingMarketsQuery = `
    SELECT
      condition_id,
      token_id,
      question,
      closed
    FROM gamma_markets
    WHERE lower(replaceAll(condition_id, '0x', '')) NOT IN (
      SELECT DISTINCT lower(replaceAll(condition_id, '0x', ''))
      FROM clob_fills
    )
    AND closed = 1  -- Only closed markets
    AND fetched_at >= '2024-10-01'  -- Recent markets
    LIMIT 10
  `;

  const missingResult = await clickhouse.query({
    query: missingMarketsQuery,
    format: 'JSONEachRow'
  });
  const missingMarkets = await missingResult.json<Array<{
    condition_id: string;
    token_id: string;
    question: string;
    closed: number;
  }>>();

  console.log(`Found ${missingMarkets.length} markets missing from CLOB\n`);

  // Check if these have ERC1155 activity
  console.log('Step 2: Check ERC1155 transfer activity for these markets...\n');

  let hasErc1155Activity = 0;
  let noActivity = 0;

  for (const market of missingMarkets) {
    const conditionIdClean = market.condition_id.toLowerCase().replace('0x', '');
    const question = market.question?.substring(0, 50) || 'No question';

    // Check erc1155_transfers for this condition_id
    const erc1155Query = `
      SELECT count(*) as transfer_count
      FROM erc1155_transfers
      WHERE lower(replaceAll(condition_id, '0x', '')) = '${conditionIdClean}'
    `;

    const result = await clickhouse.query({
      query: erc1155Query,
      format: 'JSONEachRow'
    });
    const data = await result.json<Array<{ transfer_count: string }>>();
    const count = parseInt(data[0].transfer_count);

    if (count > 0) {
      console.log(`✅ ${question}`);
      console.log(`   ERC1155 transfers: ${count.toLocaleString()}`);
      console.log(`   CLOB fills: 0`);
      console.log(`   → Market HAS activity (AMM trades)\n`);
      hasErc1155Activity++;
    } else {
      console.log(`⚪ ${question}`);
      console.log(`   ERC1155 transfers: 0`);
      console.log(`   CLOB fills: 0`);
      console.log(`   → Market has NO activity\n`);
      noActivity++;
    }
  }

  console.log('═'.repeat(80));
  console.log('\nRESULTS:');
  console.log(`  Markets with ERC1155 activity: ${hasErc1155Activity}/${missingMarkets.length}`);
  console.log(`  Markets with NO activity:      ${noActivity}/${missingMarkets.length}`);

  if (hasErc1155Activity > 0) {
    console.log('\n🎯 CONCLUSION:');
    console.log('   "Missing" CLOB markets DO have trading activity!');
    console.log('   → Activity is visible in ERC1155 transfers');
    console.log('   → These are likely AMM-only trades (no orderbook)');
    console.log('\n💡 RECOMMENDATION:');
    console.log('   Use erc1155_transfers for complete trade data');
    console.log('   CLOB fills are subset of total trading activity');
  } else {
    console.log('\n🔍 CONCLUSION:');
    console.log('   Sample markets truly have zero trading activity');
    console.log('   → Markets created but never traded');
  }

  console.log('\n═'.repeat(80));
}

main().catch(console.error);
