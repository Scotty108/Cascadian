/**
 * Phase 2 FAST: Use server-side correlation with temp table
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '@/lib/clickhouse/client';
import * as fs from 'fs';

async function main() {
  console.log('=== PHASE 2: GROUP BY CONDITIONS (FAST) ===\n');

  // Step 1: Create a temporary correlation table server-side
  console.log('Step 1: Creating correlation table (this may take a minute)...');

  // Drop if exists
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS tmp_unmapped_token_conditions`
  });

  // Create and populate in one shot
  const createQ = `
    CREATE TABLE tmp_unmapped_token_conditions
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
    ),
    unmapped AS (
      SELECT ct.token_id
      FROM cohort_tokens ct
      LEFT JOIN mapped_tokens mt ON ct.token_id = mt.token_id
      WHERE mt.token_id IS NULL OR mt.token_id = ''
    ),
    token_one_tx AS (
      SELECT
        token_id,
        any(lower(concat('0x', hex(transaction_hash)))) as tx_hash
      FROM pm_trader_events_v2
      WHERE token_id IN (SELECT token_id FROM unmapped)
        AND is_deleted = 0
      GROUP BY token_id
    ),
    split_conditions AS (
      SELECT DISTINCT
        lower(concat('0x', hex(tx_hash))) as tx_hash,
        condition_id
      FROM pm_ctf_events
      WHERE event_type = 'PositionSplit'
        AND is_deleted = 0
    )
    SELECT
      t.token_id,
      coalesce(s.condition_id, '') as condition_id
    FROM token_one_tx t
    LEFT JOIN split_conditions s ON t.tx_hash = s.tx_hash
    SETTINGS max_memory_usage = 40000000000, max_bytes_before_external_group_by = 10000000000
  `;

  try {
    await clickhouse.command({ query: createQ });
    console.log('  Correlation table created successfully');
  } catch (e: any) {
    console.error('  Error creating correlation table:', e.message);
    return;
  }

  // Step 2: Query the results
  console.log('\nStep 2: Reading correlation results...');
  const readQ = `
    SELECT token_id, condition_id
    FROM tmp_unmapped_token_conditions
  `;
  const readR = await clickhouse.query({ query: readQ, format: 'JSONEachRow' });
  const correlations = await readR.json() as any[];

  console.log(`  Total tokens: ${correlations.length}`);

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

  // Step 3: Check resolution coverage (single query)
  console.log('\nStep 3: Checking resolution coverage...');
  const conditions = Array.from(conditionToTokens.keys());

  const resQ = `
    SELECT condition_id
    FROM vw_pm_resolution_prices
    WHERE condition_id IN (
      SELECT DISTINCT condition_id FROM tmp_unmapped_token_conditions WHERE condition_id != ''
    )
  `;
  const resR = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
  const resolvedConditions = new Set((await resR.json() as any[]).map(r => r.condition_id));

  console.log(`  Resolved conditions: ${resolvedConditions.size}`);
  console.log(`  Unresolved conditions: ${conditions.length - resolvedConditions.size}`);

  // Step 4: Count wallets per condition (single query)
  console.log('\nStep 4: Counting wallets per condition...');

  const walletCountQ = `
    SELECT
      tcc.condition_id,
      count(DISTINCT t.trader_wallet) as wallet_count
    FROM pm_trader_events_v2 t
    JOIN tmp_unmapped_token_conditions tcc ON t.token_id = tcc.token_id
    WHERE t.trader_wallet IN (SELECT wallet FROM pm_copytrade_candidates_v4)
      AND t.is_deleted = 0
      AND tcc.condition_id != ''
    GROUP BY tcc.condition_id
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
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_unmapped_token_conditions` });
  console.log('\nTemp table cleaned up');
}

main().catch(console.error);
