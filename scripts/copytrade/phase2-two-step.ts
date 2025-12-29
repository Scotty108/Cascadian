/**
 * Phase 2 Two-Step: Break correlation into smaller queries
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '@/lib/clickhouse/client';
import * as fs from 'fs';

async function main() {
  console.log('=== PHASE 2: GROUP BY CONDITIONS (TWO-STEP) ===\n');

  // Step 1a: Create table of unmapped tokens with their tx_hashes
  console.log('Step 1a: Finding unmapped tokens...');

  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_unmapped_tokens` });

  const createTokensQ = `
    CREATE TABLE tmp_unmapped_tokens
    ENGINE = MergeTree()
    ORDER BY token_id
    AS
    WITH cohort_tokens AS (
      SELECT DISTINCT token_id
      FROM pm_trader_events_v2
      WHERE trader_wallet IN (SELECT wallet FROM pm_copytrade_candidates_v4)
        AND is_deleted = 0
    ),
    mapped_tokens AS (
      SELECT token_id_dec as token_id FROM pm_token_to_condition_map_v5
      UNION ALL
      SELECT token_id_dec as token_id FROM pm_token_to_condition_patch
    )
    SELECT ct.token_id
    FROM cohort_tokens ct
    LEFT JOIN mapped_tokens mt ON ct.token_id = mt.token_id
    WHERE mt.token_id IS NULL OR mt.token_id = ''
  `;

  await clickhouse.command({ query: createTokensQ });

  const countQ = `SELECT count() as cnt FROM tmp_unmapped_tokens`;
  const countR = await clickhouse.query({ query: countQ, format: 'JSONEachRow' });
  const { cnt } = (await countR.json() as any[])[0];
  console.log(`  Found ${cnt} unmapped tokens`);

  // Step 1b: Add tx_hash column
  console.log('\nStep 1b: Finding tx_hashes for tokens...');

  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_token_txhash` });

  const createTxHashQ = `
    CREATE TABLE tmp_token_txhash
    ENGINE = MergeTree()
    ORDER BY token_id
    AS
    SELECT
      token_id,
      any(lower(concat('0x', hex(transaction_hash)))) as tx_hash
    FROM pm_trader_events_v2
    WHERE token_id IN (SELECT token_id FROM tmp_unmapped_tokens)
      AND is_deleted = 0
    GROUP BY token_id
  `;

  await clickhouse.command({ query: createTxHashQ });

  const txCountQ = `SELECT count() as cnt, countDistinct(tx_hash) as tx_cnt FROM tmp_token_txhash`;
  const txCountR = await clickhouse.query({ query: txCountQ, format: 'JSONEachRow' });
  const txCount = (await txCountR.json() as any[])[0];
  console.log(`  ${txCount.cnt} tokens with ${txCount.tx_cnt} unique tx_hashes`);

  // Step 1c: Create split lookup table (much smaller than full pm_ctf_events)
  console.log('\nStep 1c: Creating split condition lookup...');

  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_split_conditions` });

  const createSplitsQ = `
    CREATE TABLE tmp_split_conditions
    ENGINE = MergeTree()
    ORDER BY tx_hash
    AS
    SELECT DISTINCT
      lower(tx_hash) as tx_hash,
      condition_id
    FROM pm_ctf_events
    WHERE event_type = 'PositionSplit'
      AND is_deleted = 0
      AND lower(tx_hash) IN (SELECT tx_hash FROM tmp_token_txhash)
  `;

  await clickhouse.command({ query: createSplitsQ });

  const splitCountQ = `SELECT count() as cnt FROM tmp_split_conditions`;
  const splitCountR = await clickhouse.query({ query: splitCountQ, format: 'JSONEachRow' });
  const splitCount = (await splitCountR.json() as any[])[0];
  console.log(`  Found ${splitCount.cnt} split condition mappings`);

  // Step 2: Join to get final correlation
  console.log('\nStep 2: Joining token → condition...');

  const joinQ = `
    SELECT
      t.token_id,
      coalesce(s.condition_id, '') as condition_id
    FROM tmp_token_txhash t
    LEFT JOIN tmp_split_conditions s ON t.tx_hash = s.tx_hash
  `;
  const joinR = await clickhouse.query({ query: joinQ, format: 'JSONEachRow' });
  const correlations = await joinR.json() as any[];

  console.log(`  Total correlations: ${correlations.length}`);

  // Build maps
  const tokenToCondition = new Map<string, string>();
  const conditionToTokens = new Map<string, Set<string>>();
  let tokensWithCondition = 0;
  let tokensWithoutCondition = 0;

  for (const c of correlations) {
    if (c.condition_id && c.condition_id !== '') {
      tokenToCondition.set(c.token_id, c.condition_id);
      if (!conditionToTokens.has(c.condition_id)) {
        conditionToTokens.set(c.condition_id, new Set());
      }
      conditionToTokens.get(c.condition_id)!.add(c.token_id);
      tokensWithCondition++;
    } else {
      tokensWithoutCondition++;
    }
  }

  console.log(`  Tokens with condition: ${tokensWithCondition}`);
  console.log(`  Tokens without condition: ${tokensWithoutCondition}`);
  console.log(`  Unique conditions: ${conditionToTokens.size}`);

  // Step 3: Check resolution coverage (using subquery, not inline list)
  console.log('\nStep 3: Checking resolution coverage...');
  const conditions = Array.from(conditionToTokens.keys());

  const resQ = `
    SELECT DISTINCT condition_id
    FROM vw_pm_resolution_prices
    WHERE condition_id IN (SELECT DISTINCT condition_id FROM tmp_split_conditions)
  `;
  const resR = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
  const resolvedConditions = new Set((await resR.json() as any[]).map(r => r.condition_id));

  console.log(`  Resolved conditions: ${resolvedConditions.size}`);
  console.log(`  Unresolved conditions: ${conditions.length - resolvedConditions.size}`);

  // Step 4: Count wallets per condition
  console.log('\nStep 4: Counting wallets per condition...');

  const walletCountQ = `
    SELECT
      s.condition_id,
      count(DISTINCT t.trader_wallet) as wallet_count
    FROM pm_trader_events_v2 t
    JOIN tmp_token_txhash tt ON t.token_id = tt.token_id
    JOIN tmp_split_conditions s ON tt.tx_hash = s.tx_hash
    WHERE t.trader_wallet IN (SELECT wallet FROM pm_copytrade_candidates_v4)
      AND t.is_deleted = 0
    GROUP BY s.condition_id
  `;

  const walletCountR = await clickhouse.query({ query: walletCountQ, format: 'JSONEachRow' });
  const walletCounts = await walletCountR.json() as any[];

  const walletCountMap = new Map(walletCounts.map(w => [w.condition_id, parseInt(w.wallet_count)]));

  // Build stats
  const conditionStats: Array<{condition_id: string, token_count: number, wallet_count: number, resolved: boolean}> = [];

  for (const [conditionId, tokens] of conditionToTokens.entries()) {
    conditionStats.push({
      condition_id: conditionId,
      token_count: tokens.size,
      wallet_count: walletCountMap.get(conditionId) || 0,
      resolved: resolvedConditions.has(conditionId)
    });
  }

  // Sort by wallet count descending
  conditionStats.sort((a, b) => b.wallet_count - a.wallet_count);

  // Export results
  let csv = 'condition_id,token_count,wallet_count,resolved\n';
  for (const c of conditionStats) {
    csv += `${c.condition_id},${c.token_count},${c.wallet_count},${c.resolved}\n`;
  }
  fs.writeFileSync('exports/phase2_conditions.csv', csv);
  console.log(`\nExported to exports/phase2_conditions.csv`);

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Total unmapped tokens: ${correlations.length}`);
  console.log(`Tokens mappable via tx_hash: ${tokensWithCondition}`);
  console.log(`Unique conditions to map: ${conditionToTokens.size}`);
  console.log(`Resolved conditions: ${resolvedConditions.size}`);
  console.log(`Unresolved: ${conditions.length - resolvedConditions.size}`);

  console.log('\n=== TOP 20 CONDITIONS BY WALLET COUNT ===');
  console.log('Condition ID                                         | Tokens | Wallets | Resolved');
  console.log('-'.repeat(85));
  for (const c of conditionStats.slice(0, 20)) {
    console.log(`${c.condition_id.padEnd(52)} | ${c.token_count.toString().padStart(6)} | ${c.wallet_count.toString().padStart(7)} | ${c.resolved ? 'Yes' : 'NO'}`);
  }

  // Cumulative impact
  console.log('\n=== CUMULATIVE IMPACT ANALYSIS ===');
  const resolvedStats = conditionStats.filter(c => c.resolved);
  console.log(`Total resolved conditions: ${resolvedStats.length}`);

  const thresholds = [10, 50, 100, 500, 1000, 2000, 5000, 10000];
  for (const threshold of thresholds) {
    if (threshold > resolvedStats.length) {
      const total = resolvedStats.reduce((s, c) => s + c.wallet_count, 0);
      console.log(`All ${resolvedStats.length} resolved: ${total} wallet-condition pairs`);
      break;
    }
    const topN = resolvedStats.slice(0, threshold);
    const total = topN.reduce((s, c) => s + c.wallet_count, 0);
    console.log(`Top ${threshold} conditions: ${total} wallet-condition pairs`);
  }

  // Key insight
  const totalWalletPairs = conditionStats.reduce((s, c) => s + c.wallet_count, 0);
  console.log('\n=== KEY INSIGHT ===');
  console.log(`If we map all ${conditionToTokens.size} conditions:`);
  console.log(`  - ${tokensWithCondition} tokens get mapped`);
  console.log(`  - ${totalWalletPairs} wallet-condition trading pairs covered`);

  // Cleanup
  console.log('\nCleaning up temp tables...');
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_unmapped_tokens` });
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_token_txhash` });
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_split_conditions` });
  console.log('Done');
}

main().catch(console.error);
