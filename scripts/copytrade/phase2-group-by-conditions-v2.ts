/**
 * Phase 2: Group unmapped tokens by condition (Memory-Optimized)
 *
 * Uses a single server-side query to correlate tokens → conditions.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '@/lib/clickhouse/client';
import * as fs from 'fs';

async function main() {
  console.log('=== PHASE 2: GROUP BY CONDITIONS (v2) ===\n');

  // Step 1: Server-side query to find all unmapped tokens and their conditions
  console.log('Step 1: Finding unmapped tokens and correlating conditions (server-side)...');

  const correlationQ = `
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
    -- Get one tx_hash per unmapped token (LIMIT per group)
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
      s.condition_id
    FROM token_one_tx t
    LEFT JOIN split_conditions s ON t.tx_hash = s.tx_hash
  `;

  console.log('  Running correlation query...');
  const correlationR = await clickhouse.query({
    query: correlationQ,
    format: 'JSONEachRow',
    clickhouse_settings: {
      max_memory_usage: '20000000000', // 20GB
      max_bytes_before_external_group_by: '5000000000', // 5GB
    }
  });
  const correlations = await correlationR.json() as any[];

  console.log(`  Found ${correlations.length} token correlations`);

  // Build maps
  const tokenToCondition = new Map<string, string>();
  const conditionToTokens = new Map<string, Set<string>>();
  let tokensWithCondition = 0;
  let tokensWithoutCondition = 0;

  for (const c of correlations) {
    if (c.condition_id) {
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

  console.log(`\nTokens with condition found: ${tokensWithCondition}`);
  console.log(`Tokens without condition (no split data): ${tokensWithoutCondition}`);
  console.log(`Unique conditions: ${conditionToTokens.size}`);

  // Step 2: Check resolution coverage
  console.log('\nStep 2: Checking resolution coverage...');
  const conditions = Array.from(conditionToTokens.keys());

  let resolvedCount = 0;
  let unresolvedConditions: string[] = [];

  if (conditions.length > 0) {
    // Process in batches to avoid query size limits
    const BATCH = 500;
    const resolvedSet = new Set<string>();

    for (let i = 0; i < conditions.length; i += BATCH) {
      const batch = conditions.slice(i, i + BATCH);
      const condList = batch.map(c => `'${c}'`).join(',');
      const resQ = `
        SELECT DISTINCT condition_id
        FROM vw_pm_resolution_prices
        WHERE condition_id IN (${condList})
      `;
      const resR = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
      const resolved = await resR.json() as any[];
      resolved.forEach(r => resolvedSet.add(r.condition_id));
    }

    for (const c of conditions) {
      if (resolvedSet.has(c)) {
        resolvedCount++;
      } else {
        unresolvedConditions.push(c);
      }
    }

    console.log(`Resolved conditions: ${resolvedCount}`);
    console.log(`Unresolved conditions: ${unresolvedConditions.length}`);
  }

  // Step 3: Count wallets per condition (batch query)
  console.log('\nStep 3: Counting wallets per condition...');

  // Build a single query to count wallets for all conditions at once
  const allTokens = new Set<string>();
  for (const tokens of conditionToTokens.values()) {
    tokens.forEach(t => allTokens.add(t));
  }

  // Build token → condition lookup for the query
  const tokenConditionList = Array.from(tokenToCondition.entries())
    .map(([t, c]) => `('${t}', '${c}')`)
    .join(',');

  const walletCountQ = `
    WITH token_condition_map AS (
      SELECT * FROM (
        SELECT * FROM VALUES('token_id String, condition_id String', ${tokenConditionList})
      )
    ),
    cohort_trades AS (
      SELECT DISTINCT trader_wallet, token_id
      FROM pm_trader_events_v2
      WHERE token_id IN (SELECT token_id FROM token_condition_map)
        AND trader_wallet IN (SELECT wallet FROM pm_copytrade_candidates_v4)
        AND is_deleted = 0
    )
    SELECT
      tcm.condition_id,
      count(DISTINCT ct.trader_wallet) as wallet_count
    FROM cohort_trades ct
    JOIN token_condition_map tcm ON ct.token_id = tcm.token_id
    GROUP BY tcm.condition_id
  `;

  console.log('  Running wallet count query...');
  const walletCountR = await clickhouse.query({ query: walletCountQ, format: 'JSONEachRow' });
  const walletCounts = await walletCountR.json() as any[];

  const conditionStats: Array<{condition_id: string, token_count: number, wallet_count: number, resolved: boolean}> = [];

  const walletCountMap = new Map(walletCounts.map(w => [w.condition_id, parseInt(w.wallet_count)]));

  for (const [conditionId, tokens] of conditionToTokens.entries()) {
    conditionStats.push({
      condition_id: conditionId,
      token_count: tokens.size,
      wallet_count: walletCountMap.get(conditionId) || 0,
      resolved: !unresolvedConditions.includes(conditionId)
    });
  }

  // Sort by wallet count descending
  conditionStats.sort((a, b) => b.wallet_count - a.wallet_count);

  // Step 4: Export results
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
  console.log(`Resolved conditions: ${resolvedCount}`);
  console.log(`Unresolved conditions: ${unresolvedConditions.length}`);

  console.log('\n=== TOP 20 CONDITIONS BY WALLET COUNT ===');
  console.log('Condition ID                              | Tokens | Wallets | Resolved');
  console.log('-'.repeat(80));
  for (const c of conditionStats.slice(0, 20)) {
    console.log(`${c.condition_id.slice(0, 40)}... | ${c.token_count.toString().padStart(6)} | ${c.wallet_count.toString().padStart(7)} | ${c.resolved ? 'Yes' : 'NO'}`);
  }

  // Calculate cumulative impact
  console.log('\n=== CUMULATIVE IMPACT ANALYSIS ===');
  const resolvedStats = conditionStats.filter(c => c.resolved);
  console.log(`Resolved conditions only: ${resolvedStats.length}`);

  let cumWallets = 0;
  const thresholds = [10, 50, 100, 500, 1000, 2000, 5000];
  for (const threshold of thresholds) {
    if (threshold > resolvedStats.length) {
      console.log(`Top ${resolvedStats.length} (all resolved): ${resolvedStats.reduce((s, c) => s + c.wallet_count, 0)} wallet-condition pairs`);
      break;
    }
    const topN = resolvedStats.slice(0, threshold);
    const total = topN.reduce((s, c) => s + c.wallet_count, 0);
    console.log(`Top ${threshold} conditions: ${total} wallet-condition pairs`);
  }
}

main().catch(console.error);
