/**
 * Phase 2: Group unmapped tokens by condition (Chunked Approach)
 *
 * Breaks the problem into smaller pieces to avoid memory issues.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '@/lib/clickhouse/client';
import * as fs from 'fs';

async function main() {
  console.log('=== PHASE 2: GROUP BY CONDITIONS (v3 - Chunked) ===\n');

  // Step 1: Get unmapped tokens in chunks
  console.log('Step 1: Finding unmapped tokens...');
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

  // Step 2: For each token, find ONE tx_hash (in small batches)
  console.log('Step 2: Finding tx_hashes for tokens (batched)...');
  const tokenToTxHash = new Map<string, string>();
  const BATCH_SIZE = 100; // Very small batch

  for (let i = 0; i < unmappedTokens.length; i += BATCH_SIZE) {
    const batch = unmappedTokens.slice(i, i + BATCH_SIZE);
    const tokenList = batch.map(t => `'${t}'`).join(',');

    const txQ = `
      SELECT
        token_id,
        any(lower(concat('0x', hex(transaction_hash)))) as tx_hash
      FROM pm_trader_events_v2
      WHERE token_id IN (${tokenList})
        AND is_deleted = 0
      GROUP BY token_id
    `;
    const txR = await clickhouse.query({ query: txQ, format: 'JSONEachRow' });
    const txs = await txR.json() as any[];
    txs.forEach(t => tokenToTxHash.set(t.token_id, t.tx_hash));

    if ((i + BATCH_SIZE) % 1000 === 0 || i + BATCH_SIZE >= unmappedTokens.length) {
      console.log(`  Processed ${Math.min(i + BATCH_SIZE, unmappedTokens.length)}/${unmappedTokens.length} tokens...`);
    }
  }

  console.log(`Found ${tokenToTxHash.size} token → tx_hash mappings`);

  // Step 3: Get unique tx_hashes and find their conditions
  console.log('\nStep 3: Finding conditions for tx_hashes...');
  const uniqueTxHashes = Array.from(new Set(tokenToTxHash.values()));
  console.log(`  Unique tx_hashes: ${uniqueTxHashes.length}`);

  const txHashToCondition = new Map<string, string>();

  for (let i = 0; i < uniqueTxHashes.length; i += BATCH_SIZE) {
    const batch = uniqueTxHashes.slice(i, i + BATCH_SIZE);
    const txList = batch.map(t => `'${t}'`).join(',');

    const condQ = `
      SELECT DISTINCT
        lower(concat('0x', hex(tx_hash))) as tx_hash,
        condition_id
      FROM pm_ctf_events
      WHERE event_type = 'PositionSplit'
        AND is_deleted = 0
        AND lower(concat('0x', hex(tx_hash))) IN (${txList})
    `;
    const condR = await clickhouse.query({ query: condQ, format: 'JSONEachRow' });
    const conditions = await condR.json() as any[];
    conditions.forEach(c => txHashToCondition.set(c.tx_hash, c.condition_id));

    if ((i + BATCH_SIZE) % 1000 === 0 || i + BATCH_SIZE >= uniqueTxHashes.length) {
      console.log(`  Processed ${Math.min(i + BATCH_SIZE, uniqueTxHashes.length)}/${uniqueTxHashes.length} tx_hashes...`);
    }
  }

  console.log(`Found ${txHashToCondition.size} tx_hash → condition_id mappings`);

  // Step 4: Build token → condition map
  console.log('\nStep 4: Building token → condition map...');
  const tokenToCondition = new Map<string, string>();
  const conditionToTokens = new Map<string, Set<string>>();

  for (const [tokenId, txHash] of tokenToTxHash.entries()) {
    const conditionId = txHashToCondition.get(txHash);
    if (conditionId) {
      tokenToCondition.set(tokenId, conditionId);
      if (!conditionToTokens.has(conditionId)) {
        conditionToTokens.set(conditionId, new Set());
      }
      conditionToTokens.get(conditionId)!.add(tokenId);
    }
  }

  const tokensWithCondition = tokenToCondition.size;
  const tokensWithoutCondition = unmappedTokens.length - tokensWithCondition;

  console.log(`Tokens with condition found: ${tokensWithCondition}`);
  console.log(`Tokens without condition: ${tokensWithoutCondition}`);
  console.log(`Unique conditions: ${conditionToTokens.size}`);

  // Step 5: Check resolution coverage
  console.log('\nStep 5: Checking resolution coverage...');
  const conditions = Array.from(conditionToTokens.keys());
  const resolvedSet = new Set<string>();

  for (let i = 0; i < conditions.length; i += 500) {
    const batch = conditions.slice(i, i + 500);
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

  console.log(`Resolved conditions: ${resolvedSet.size}`);
  console.log(`Unresolved conditions: ${conditions.length - resolvedSet.size}`);

  // Step 6: Count wallets per condition
  console.log('\nStep 6: Counting wallets per condition...');
  const conditionStats: Array<{condition_id: string, token_count: number, wallet_count: number, resolved: boolean}> = [];

  let processed = 0;
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
    const result = await walletR.json() as any[];
    const wallet_count = result[0]?.wallet_count || 0;

    conditionStats.push({
      condition_id: conditionId,
      token_count: tokens.size,
      wallet_count: parseInt(wallet_count),
      resolved: resolvedSet.has(conditionId)
    });

    processed++;
    if (processed % 500 === 0 || processed === conditionToTokens.size) {
      console.log(`  Counted ${processed}/${conditionToTokens.size} conditions...`);
    }
  }

  // Sort by wallet count descending
  conditionStats.sort((a, b) => b.wallet_count - a.wallet_count);

  // Step 7: Export results
  let csv = 'condition_id,token_count,wallet_count,resolved\n';
  for (const c of conditionStats) {
    csv += `${c.condition_id},${c.token_count},${c.wallet_count},${c.resolved}\n`;
  }
  fs.writeFileSync('exports/phase2_conditions.csv', csv);
  console.log(`\nExported to exports/phase2_conditions.csv`);

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Total unmapped tokens: ${unmappedTokens.length}`);
  console.log(`Tokens mappable via tx_hash: ${tokensWithCondition}`);
  console.log(`Unique conditions to map: ${conditionToTokens.size}`);
  console.log(`Resolved conditions: ${resolvedSet.size}`);
  console.log(`Unresolved conditions: ${conditions.length - resolvedSet.size}`);

  console.log('\n=== TOP 20 CONDITIONS BY WALLET COUNT ===');
  console.log('Condition ID                                         | Tokens | Wallets | Resolved');
  console.log('-'.repeat(85));
  for (const c of conditionStats.slice(0, 20)) {
    console.log(`${c.condition_id.padEnd(52)} | ${c.token_count.toString().padStart(6)} | ${c.wallet_count.toString().padStart(7)} | ${c.resolved ? 'Yes' : 'NO'}`);
  }

  // Calculate cumulative impact
  console.log('\n=== CUMULATIVE IMPACT ANALYSIS ===');
  const resolvedStats = conditionStats.filter(c => c.resolved);
  console.log(`Total resolved conditions: ${resolvedStats.length}`);

  const thresholds = [10, 50, 100, 500, 1000, 2000, 5000];
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
  console.log('\n=== KEY INSIGHT ===');
  const totalWalletPairs = conditionStats.reduce((s, c) => s + c.wallet_count, 0);
  console.log(`If we map all ${conditionToTokens.size} conditions:`);
  console.log(`  - ${tokensWithCondition} tokens get mapped`);
  console.log(`  - ${totalWalletPairs} wallet-condition trading pairs covered`);
}

main().catch(console.error);
