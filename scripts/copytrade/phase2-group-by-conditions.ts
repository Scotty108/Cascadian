/**
 * Phase 2: Group unmapped tokens by condition
 *
 * Use tx_hash correlation to find condition_ids for unmapped tokens.
 * This tells us how many unique conditions need mapping.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '@/lib/clickhouse/client';
import * as fs from 'fs';

async function main() {
  console.log('=== PHASE 2: GROUP BY CONDITIONS ===\n');

  // Step 1: Get all unmapped tokens
  console.log('Step 1: Finding all unmapped tokens...');
  const unmappedQ = `
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
  const unmappedR = await clickhouse.query({ query: unmappedQ, format: 'JSONEachRow' });
  const unmappedTokens = (await unmappedR.json() as any[]).map(t => t.token_id);
  console.log(`Found ${unmappedTokens.length} unmapped tokens\n`);

  // Step 2: Find condition_ids via tx_hash correlation
  console.log('Step 2: Finding conditions via tx_hash correlation...');

  // Process in batches
  const BATCH_SIZE = 1000;
  const tokenToCondition = new Map<string, string>();
  const conditionToTokens = new Map<string, Set<string>>();

  for (let i = 0; i < unmappedTokens.length; i += BATCH_SIZE) {
    const batch = unmappedTokens.slice(i, i + BATCH_SIZE);
    const tokenList = batch.map(t => `'${t}'`).join(',');

    const correlationQ = `
      WITH token_txs AS (
        SELECT DISTINCT
          token_id,
          lower(concat('0x', hex(transaction_hash))) as tx_hash
        FROM pm_trader_events_v2
        WHERE token_id IN (${tokenList})
          AND is_deleted = 0
      ),
      split_conditions AS (
        SELECT DISTINCT tx_hash, condition_id
        FROM pm_ctf_events
        WHERE event_type = 'PositionSplit'
          AND is_deleted = 0
      )
      SELECT DISTINCT t.token_id, s.condition_id
      FROM token_txs t
      JOIN split_conditions s ON t.tx_hash = s.tx_hash
    `;

    const correlationR = await clickhouse.query({ query: correlationQ, format: 'JSONEachRow' });
    const correlations = await correlationR.json() as any[];

    for (const c of correlations) {
      tokenToCondition.set(c.token_id, c.condition_id);
      if (!conditionToTokens.has(c.condition_id)) {
        conditionToTokens.set(c.condition_id, new Set());
      }
      conditionToTokens.get(c.condition_id)!.add(c.token_id);
    }

    console.log(`  Processed ${Math.min(i + BATCH_SIZE, unmappedTokens.length)}/${unmappedTokens.length} tokens...`);
  }

  const mappedToConditions = tokenToCondition.size;
  const unmappedNoCondition = unmappedTokens.length - mappedToConditions;

  console.log(`\nTokens with condition found: ${mappedToConditions}`);
  console.log(`Tokens without condition (no split data): ${unmappedNoCondition}`);
  console.log(`Unique conditions: ${conditionToTokens.size}`);

  // Step 3: Check which conditions have resolution data
  console.log('\nStep 3: Checking resolution coverage...');
  const conditions = Array.from(conditionToTokens.keys());

  if (conditions.length > 0) {
    const condList = conditions.map(c => `'${c}'`).join(',');
    const resQ = `
      SELECT DISTINCT condition_id
      FROM vw_pm_resolution_prices
      WHERE condition_id IN (${condList})
    `;
    const resR = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
    const resolvedConditions = new Set((await resR.json() as any[]).map(r => r.condition_id));

    const resolved = conditions.filter(c => resolvedConditions.has(c)).length;
    const unresolved = conditions.length - resolved;

    console.log(`Resolved conditions: ${resolved}`);
    console.log(`Unresolved conditions: ${unresolved}`);
  }

  // Step 4: Count wallets per condition
  console.log('\nStep 4: Counting wallets per condition...');

  const conditionWalletCount: Array<{condition_id: string, token_count: number, wallet_count: number}> = [];

  for (const [conditionId, tokens] of conditionToTokens.entries()) {
    const tokenList = Array.from(tokens).map(t => `'${t}'`).join(',');
    const walletQ = `
      SELECT count(DISTINCT trader_wallet) as wallet_count
      FROM pm_trader_events_v2
      WHERE token_id IN (${tokenList})
        AND trader_wallet IN (SELECT wallet FROM pm_copytrade_candidates_v4)
        AND is_deleted = 0
    `;
    const walletR = await clickhouse.query({ query: walletQ, format: 'JSONEachRow' });
    const { wallet_count } = (await walletR.json() as any[])[0];

    conditionWalletCount.push({
      condition_id: conditionId,
      token_count: tokens.size,
      wallet_count: parseInt(wallet_count)
    });
  }

  // Sort by wallet count descending
  conditionWalletCount.sort((a, b) => b.wallet_count - a.wallet_count);

  // Step 5: Export results
  let csv = 'condition_id,token_count,wallet_count\n';
  for (const c of conditionWalletCount) {
    csv += `${c.condition_id},${c.token_count},${c.wallet_count}\n`;
  }
  fs.writeFileSync('exports/phase2_conditions.csv', csv);
  console.log(`\nExported to exports/phase2_conditions.csv`);

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Total unmapped tokens: ${unmappedTokens.length}`);
  console.log(`Tokens mappable via tx_hash: ${mappedToConditions}`);
  console.log(`Unique conditions to map: ${conditionToTokens.size}`);

  console.log('\n=== TOP 20 CONDITIONS BY WALLET COUNT ===');
  console.log('Condition ID                              | Tokens | Wallets');
  console.log('-'.repeat(70));
  for (const c of conditionWalletCount.slice(0, 20)) {
    console.log(`${c.condition_id.slice(0, 40)}... | ${c.token_count.toString().padStart(6)} | ${c.wallet_count.toString().padStart(7)}`);
  }

  // Calculate coverage if we map top N conditions
  console.log('\n=== IMPACT ANALYSIS ===');
  let cumulativeWallets = new Set<string>();
  const impactThresholds = [10, 50, 100, 500, 1000];

  for (const threshold of impactThresholds) {
    if (threshold > conditionWalletCount.length) break;

    // This is approximate - we'd need to actually query wallets per condition
    const topConditions = conditionWalletCount.slice(0, threshold);
    const maxWallets = topConditions.reduce((sum, c) => sum + c.wallet_count, 0);
    console.log(`Top ${threshold} conditions: up to ${maxWallets} wallet-condition pairs impacted`);
  }
}

main().catch(console.error);
