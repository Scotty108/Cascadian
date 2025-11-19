import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function baselineMetrics() {
  console.log('\n📊 PHASE 2: TOKEN MAP EXPANSION - BASELINE METRICS\n');
  console.log('='.repeat(80));

  console.log('\n1️⃣ Unique asset_ids in clob_fills:\n');

  const clobTokensQuery = `
    SELECT uniq(asset_id) AS clob_unique_tokens
    FROM clob_fills
    WHERE asset_id != ''
  `;

  const clobResult = await clickhouse.query({
    query: clobTokensQuery,
    format: 'JSONEachRow'
  });

  const clobTokens = await clobResult.json();
  const clobUnique = parseInt(clobTokens[0].clob_unique_tokens);
  console.log(`   Unique asset_ids: ${clobUnique.toLocaleString()}`);

  console.log('\n2️⃣ Currently mapped tokens in ctf_token_map:\n');

  const mappedQuery = `
    SELECT
      count() AS total_tokens,
      countIf(condition_id_norm != '') AS mapped_tokens,
      round(mapped_tokens / total_tokens * 100, 2) AS pct_mapped
    FROM ctf_token_map
  `;

  const mappedResult = await clickhouse.query({
    query: mappedQuery,
    format: 'JSONEachRow'
  });

  const mapped = await mappedResult.json();
  console.log(`   Total rows: ${parseInt(mapped[0].total_tokens).toLocaleString()}`);
  console.log(`   Mapped tokens: ${parseInt(mapped[0].mapped_tokens).toLocaleString()}`);
  console.log(`   Coverage: ${mapped[0].pct_mapped}%`);

  console.log('\n3️⃣ Gap Analysis - Unmapped fills:\n');

  const gapQuery = `
    SELECT
      count() AS total_fills,
      countIf(cf.asset_id IN (
        SELECT token_id FROM ctf_token_map WHERE condition_id_norm != ''
      )) AS mapped_fills,
      count() - mapped_fills AS unmapped_fills,
      round(mapped_fills / total_fills * 100, 2) AS current_coverage
    FROM clob_fills cf
    WHERE cf.asset_id != ''
  `;

  const gapResult = await clickhouse.query({
    query: gapQuery,
    format: 'JSONEachRow'
  });

  const gap = await gapResult.json();
  console.log(`   Total fills: ${parseInt(gap[0].total_fills).toLocaleString()}`);
  console.log(`   Mapped fills: ${parseInt(gap[0].mapped_fills).toLocaleString()}`);
  console.log(`   Unmapped fills: ${parseInt(gap[0].unmapped_fills).toLocaleString()}`);
  console.log(`   Current coverage: ${gap[0].current_coverage}%`);

  console.log('\n4️⃣ Token gap (unique asset_ids not in ctf_token_map):\n');

  const tokenGapQuery = `
    SELECT
      uniq(cf.asset_id) AS unmapped_tokens
    FROM clob_fills cf
    LEFT JOIN ctf_token_map c ON cf.asset_id = c.token_id
    WHERE cf.asset_id != ''
      AND (c.token_id IS NULL OR c.condition_id_norm = '')
  `;

  const tokenGapResult = await clickhouse.query({
    query: tokenGapQuery,
    format: 'JSONEachRow'
  });

  const tokenGap = await tokenGapResult.json();
  const unmappedTokens = parseInt(tokenGap[0].unmapped_tokens);
  console.log(`   Unmapped unique tokens: ${unmappedTokens.toLocaleString()}`);
  console.log(`   Token coverage: ${((clobUnique - unmappedTokens) / clobUnique * 100).toFixed(2)}%`);

  console.log('\n' + '='.repeat(80));
  console.log('\n🎯 TARGET:\n');
  console.log(`   Need to add: ~${unmappedTokens.toLocaleString()} tokens`);
  console.log(`   To achieve: ≥95% fill coverage`);
  console.log(`   Current: ${gap[0].current_coverage}%`);
  console.log(`   Gap: ${(95 - parseFloat(gap[0].current_coverage)).toFixed(2)}% to target\n`);

  return {
    clobUnique,
    mappedTokens: parseInt(mapped[0].mapped_tokens),
    unmappedTokens,
    currentCoverage: parseFloat(gap[0].current_coverage),
    totalFills: parseInt(gap[0].total_fills),
    unmappedFills: parseInt(gap[0].unmapped_fills)
  };
}

baselineMetrics().catch(console.error);
