#!/usr/bin/env npx tsx
/**
 * PHASE 0: CRITICAL VALIDATION
 *
 * This script answers 4 critical questions that determine our path forward:
 *
 * Q1: Is the "22.8M missing transactions" number real or phantom?
 * Q2: Can we derive condition_ids from token_id in trades_raw?
 * Q3: What's the ACTUAL recoverable gap?
 * Q4: What schema does trades_raw actually have?
 *
 * Based on results, we'll choose:
 * - Phase 1 (UNION approach, 4-6 hours) if gap is <10M or derivable
 * - Phase 2 (Full backfill, 12-16 hours) if gap is 10M+ and not derivable
 *
 * Estimated runtime: 20-30 minutes
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

interface ValidationResult {
  question: string;
  answer: string;
  recommendation: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

const results: ValidationResult[] = [];

async function main() {
console.log('═══════════════════════════════════════════════════════════════════');
console.log('PHASE 0: CRITICAL VALIDATION');
console.log('═══════════════════════════════════════════════════════════════════');
console.log();

// ============================================================================
// Q1: What's the REAL transaction overlap/gap?
// ============================================================================

console.log('Q1: What is the REAL transaction overlap and gap between tables?');
console.log('─'.repeat(70));

try {
  const q1Result = await client.query({
    query: `
      WITH twd_txs AS (
        SELECT DISTINCT tx_hash FROM trades_with_direction
        WHERE tx_hash != ''
      ),
      raw_txs AS (
        SELECT DISTINCT transaction_hash AS tx_hash FROM trades_raw
        WHERE transaction_hash != ''
      ),
      raw_valid_txs AS (
        SELECT DISTINCT transaction_hash AS tx_hash FROM trades_raw
        WHERE condition_id != ''
          AND condition_id != concat('0x', repeat('0',64))
          AND transaction_hash != ''
      )
      SELECT
        'trades_with_direction unique txs' AS metric,
        toString((SELECT count() FROM twd_txs)) AS value
      UNION ALL
      SELECT 'trades_raw total unique txs',
        toString((SELECT count() FROM raw_txs))
      UNION ALL
      SELECT 'trades_raw with VALID condition_id',
        toString((SELECT count() FROM raw_valid_txs))
      UNION ALL
      SELECT 'Only in trades_with_direction (not in raw)',
        toString((SELECT count() FROM twd_txs WHERE tx_hash NOT IN (SELECT tx_hash FROM raw_txs)))
      UNION ALL
      SELECT 'Only in trades_raw (not in twd)',
        toString((SELECT count() FROM raw_txs WHERE tx_hash NOT IN (SELECT tx_hash FROM twd_txs)))
      UNION ALL
      SELECT 'Overlap (in both tables)',
        toString((SELECT count() FROM twd_txs WHERE tx_hash IN (SELECT tx_hash FROM raw_txs)))
      UNION ALL
      SELECT 'trades_raw with BLANK condition_id',
        toString((SELECT count() FROM raw_txs WHERE tx_hash NOT IN (SELECT tx_hash FROM raw_valid_txs)))
    `,
    format: 'JSONEachRow',
  });

  const q1Data = await q1Result.json<Array<{ metric: string; value: string }>>();

  console.log('\nResults:');
  q1Data.forEach(row => {
    console.log(`  ${row.metric.padEnd(45)} ${row.value.padStart(12)}`);
  });

  const onlyInRaw = parseInt(q1Data.find(r => r.metric === 'Only in trades_raw (not in twd)')?.value || '0');
  const blankInRaw = parseInt(q1Data.find(r => r.metric === 'trades_raw with BLANK condition_id')?.value || '0');

  console.log();
  console.log('Analysis:');
  if (onlyInRaw > 20_000_000) {
    console.log(`  ⚠️  LARGE GAP: ${(onlyInRaw / 1_000_000).toFixed(1)}M transactions in trades_raw not in trades_with_direction`);
    console.log(`  ⚠️  Of those, ${(blankInRaw / 1_000_000).toFixed(1)}M have blank condition_ids`);
    results.push({
      question: 'Q1: Is the 22.8M gap real?',
      answer: `YES - ${(onlyInRaw / 1_000_000).toFixed(1)}M real gap exists`,
      recommendation: 'Proceed to Q2 to check if recoverable from token_id',
      confidence: 'HIGH'
    });
  } else if (onlyInRaw > 5_000_000) {
    console.log(`  ⚠️  MEDIUM GAP: ${(onlyInRaw / 1_000_000).toFixed(1)}M transactions in trades_raw not in trades_with_direction`);
    results.push({
      question: 'Q1: Is the 22.8M gap real?',
      answer: `PARTIAL - ${(onlyInRaw / 1_000_000).toFixed(1)}M gap (not 22.8M)`,
      recommendation: 'Proceed to Q2 to check if recoverable',
      confidence: 'HIGH'
    });
  } else {
    console.log(`  ✅ SMALL GAP: Only ${(onlyInRaw / 1_000_000).toFixed(1)}M transactions in trades_raw not in trades_with_direction`);
    results.push({
      question: 'Q1: Is the 22.8M gap real?',
      answer: `NO - Only ${(onlyInRaw / 1_000_000).toFixed(1)}M gap (terminal 2 miscounted)`,
      recommendation: 'Phase 1 UNION should work well',
      confidence: 'HIGH'
    });
  }

} catch (error) {
  console.error('❌ Q1 Failed:', error);
  results.push({
    question: 'Q1: Transaction gap analysis',
    answer: 'FAILED - Query error',
    recommendation: 'Fix query and retry',
    confidence: 'LOW'
  });
}

console.log();
console.log('═'.repeat(70));
console.log();

// ============================================================================
// Q2: What schema does trades_raw actually have?
// ============================================================================

console.log('Q2: What schema does trades_raw actually have?');
console.log('─'.repeat(70));

try {
  const q2Result = await client.query({
    query: `DESCRIBE TABLE trades_raw`,
    format: 'JSONEachRow',
  });

  const schema = await q2Result.json<Array<{ name: string; type: string; default_type: string }>>();

  console.log('\nSchema:');
  schema.forEach(col => {
    console.log(`  ${col.name.padEnd(30)} ${col.type}`);
  });

  const hasTokenId = schema.some(col => col.name === 'token_id');
  const hasOutcomeIndex = schema.some(col => col.name === 'outcome_index');

  console.log();
  console.log('Analysis:');
  console.log(`  token_id column: ${hasTokenId ? '✅ EXISTS' : '❌ MISSING'}`);
  console.log(`  outcome_index column: ${hasOutcomeIndex ? '✅ EXISTS' : '❌ MISSING'}`);

  if (hasTokenId) {
    results.push({
      question: 'Q2: Does trades_raw have token_id?',
      answer: 'YES - Can derive condition_ids using CTF formula',
      recommendation: 'Phase 1 safe recovery possible',
      confidence: 'HIGH'
    });
  } else {
    results.push({
      question: 'Q2: Does trades_raw have token_id?',
      answer: 'NO - Cannot derive condition_ids in-place',
      recommendation: 'Must rely on erc1155_transfers JOIN or Phase 2',
      confidence: 'HIGH'
    });
  }

} catch (error) {
  console.error('❌ Q2 Failed:', error);
  results.push({
    question: 'Q2: Schema check',
    answer: 'FAILED - Query error',
    recommendation: 'Fix query and retry',
    confidence: 'LOW'
  });
}

console.log();
console.log('═'.repeat(70));
console.log();

// ============================================================================
// Q3: Can we recover from token_id (if it exists)?
// ============================================================================

console.log('Q3: How many blank condition_ids can we recover from token_id?');
console.log('─'.repeat(70));

try {
  const q3Result = await client.query({
    query: `
      SELECT
        'Total rows with blank condition_id' AS metric,
        toString(countIf(condition_id IN ('', concat('0x', repeat('0',64))))) AS value
      FROM trades_raw
      UNION ALL
      SELECT 'Of those, have non-null token_id',
        toString(countIf(
          condition_id IN ('', concat('0x', repeat('0',64)))
          AND token_id IS NOT NULL
          AND token_id != 0
        ))
      FROM trades_raw
      UNION ALL
      SELECT 'Recovery potential %',
        toString(round(
          countIf(condition_id IN ('', concat('0x', repeat('0',64))) AND token_id IS NOT NULL AND token_id != 0) * 100.0 /
          nullIf(countIf(condition_id IN ('', concat('0x', repeat('0',64)))), 0),
          1
        ))
      FROM trades_raw
    `,
    format: 'JSONEachRow',
  });

  const q3Data = await q3Result.json<Array<{ metric: string; value: string }>>();

  console.log('\nResults:');
  q3Data.forEach(row => {
    console.log(`  ${row.metric.padEnd(45)} ${row.value.padStart(12)}`);
  });

  const recoveryPct = parseFloat(q3Data.find(r => r.metric === 'Recovery potential %')?.value || '0');

  console.log();
  console.log('Analysis:');
  if (recoveryPct >= 80) {
    console.log(`  ✅ EXCELLENT: ${recoveryPct}% of blank condition_ids can be derived from token_id`);
    results.push({
      question: 'Q3: Can we derive from token_id?',
      answer: `YES - ${recoveryPct}% recoverable in-place`,
      recommendation: 'Phase 1 will achieve high coverage',
      confidence: 'HIGH'
    });
  } else if (recoveryPct >= 50) {
    console.log(`  ⚠️  PARTIAL: ${recoveryPct}% of blank condition_ids can be derived from token_id`);
    results.push({
      question: 'Q3: Can we derive from token_id?',
      answer: `PARTIAL - ${recoveryPct}% recoverable`,
      recommendation: 'Phase 1 + erc1155_transfers JOIN needed',
      confidence: 'MEDIUM'
    });
  } else {
    console.log(`  ❌ LOW: Only ${recoveryPct}% of blank condition_ids can be derived from token_id`);
    results.push({
      question: 'Q3: Can we derive from token_id?',
      answer: `NO - Only ${recoveryPct}% recoverable`,
      recommendation: 'Phase 2 blockchain backfill required',
      confidence: 'HIGH'
    });
  }

} catch (error) {
  console.error('❌ Q3 Failed (likely no token_id column):', error);
  results.push({
    question: 'Q3: Recovery from token_id',
    answer: 'FAILED - Likely no token_id column exists',
    recommendation: 'Must use erc1155_transfers JOIN or Phase 2',
    confidence: 'HIGH'
  });
}

console.log();
console.log('═'.repeat(70));
console.log();

// ============================================================================
// Q4: How many can we recover from erc1155_transfers JOIN?
// ============================================================================

console.log('Q4: How many can we recover via erc1155_transfers JOIN?');
console.log('─'.repeat(70));

try {
  const q4Result = await client.query({
    query: `
      WITH blank_txs AS (
        SELECT DISTINCT transaction_hash AS tx_hash
        FROM trades_raw
        WHERE condition_id IN ('', concat('0x', repeat('0',64)))
          AND transaction_hash != ''
      ),
      erc_txs AS (
        SELECT DISTINCT tx_hash
        FROM erc1155_transfers
        WHERE tx_hash != ''
      )
      SELECT
        'Unique tx_hashes with blank condition_id' AS metric,
        toString((SELECT count() FROM blank_txs)) AS value
      UNION ALL
      SELECT 'Available in erc1155_transfers',
        toString((SELECT count() FROM blank_txs WHERE tx_hash IN (SELECT tx_hash FROM erc_txs)))
      UNION ALL
      SELECT 'Total erc1155_transfers rows',
        toString(count())
      FROM erc1155_transfers
      UNION ALL
      SELECT 'Recovery potential via JOIN %',
        toString(round(
          (SELECT count() FROM blank_txs WHERE tx_hash IN (SELECT tx_hash FROM erc_txs)) * 100.0 /
          nullIf((SELECT count() FROM blank_txs), 0),
          1
        ))
    `,
    format: 'JSONEachRow',
  });

  const q4Data = await q4Result.json<Array<{ metric: string; value: string }>>();

  console.log('\nResults:');
  q4Data.forEach(row => {
    console.log(`  ${row.metric.padEnd(45)} ${row.value.padStart(12)}`);
  });

  const joinRecoveryPct = parseFloat(q4Data.find(r => r.metric === 'Recovery potential via JOIN %')?.value || '0');
  const totalErc = parseInt(q4Data.find(r => r.metric === 'Total erc1155_transfers rows')?.value || '0');

  console.log();
  console.log('Analysis:');
  if (joinRecoveryPct >= 80) {
    console.log(`  ✅ EXCELLENT: ${joinRecoveryPct}% recoverable via erc1155_transfers JOIN`);
    console.log(`  ✅ erc1155_transfers has ${(totalErc / 1_000_000).toFixed(2)}M rows`);
    results.push({
      question: 'Q4: Can we recover via erc1155_transfers?',
      answer: `YES - ${joinRecoveryPct}% recoverable (${(totalErc / 1_000_000).toFixed(1)}M events)`,
      recommendation: 'Phase 1 will achieve high coverage',
      confidence: 'HIGH'
    });
  } else if (joinRecoveryPct >= 10) {
    console.log(`  ⚠️  PARTIAL: ${joinRecoveryPct}% recoverable via erc1155_transfers JOIN`);
    console.log(`  ⚠️  erc1155_transfers has ${(totalErc / 1_000_000).toFixed(2)}M rows (incomplete)`);
    results.push({
      question: 'Q4: Can we recover via erc1155_transfers?',
      answer: `PARTIAL - ${joinRecoveryPct}% recoverable`,
      recommendation: 'Phase 1 will give 70-85% coverage, Phase 2 needed for 95%+',
      confidence: 'MEDIUM'
    });
  } else {
    console.log(`  ❌ LOW: Only ${joinRecoveryPct}% recoverable via erc1155_transfers JOIN`);
    console.log(`  ❌ erc1155_transfers has ${(totalErc / 1_000_000).toFixed(2)}M rows (severely incomplete)`);
    results.push({
      question: 'Q4: Can we recover via erc1155_transfers?',
      answer: `NO - Only ${joinRecoveryPct}% recoverable`,
      recommendation: 'Phase 2 blockchain backfill REQUIRED',
      confidence: 'HIGH'
    });
  }

} catch (error) {
  console.error('❌ Q4 Failed:', error);
  results.push({
    question: 'Q4: erc1155_transfers recovery',
    answer: 'FAILED - Query error',
    recommendation: 'Fix query and retry',
    confidence: 'LOW'
  });
}

console.log();
console.log('═'.repeat(70));
console.log();

// ============================================================================
// FINAL RECOMMENDATION
// ============================================================================

console.log('═'.repeat(70));
console.log('VALIDATION RESULTS SUMMARY');
console.log('═'.repeat(70));
console.log();

results.forEach((result, i) => {
  console.log(`${i + 1}. ${result.question}`);
  console.log(`   Answer: ${result.answer}`);
  console.log(`   Recommendation: ${result.recommendation}`);
  console.log(`   Confidence: ${result.confidence}`);
  console.log();
});

console.log('═'.repeat(70));
console.log('FINAL PATH FORWARD RECOMMENDATION');
console.log('═'.repeat(70));
console.log();

// Decision logic
const hasTokenId = results.find(r => r.question.includes('token_id'))?.answer.startsWith('YES');
const highJoinRecovery = results.find(r => r.question.includes('erc1155_transfers'))?.answer.includes('YES');
const smallGap = results.find(r => r.question.includes('gap real'))?.answer.startsWith('NO');

if (smallGap || hasTokenId || highJoinRecovery) {
  console.log('✅ RECOMMENDATION: PHASE 1 (UNION Approach)');
  console.log();
  console.log('Why:');
  if (smallGap) console.log('  • Gap is small (<5M transactions)');
  if (hasTokenId) console.log('  • Can derive condition_ids from token_id in-place');
  if (highJoinRecovery) console.log('  • erc1155_transfers has high coverage for JOIN recovery');
  console.log();
  console.log('Expected outcome:');
  console.log('  • Timeline: 4-6 hours');
  console.log('  • Cost: $0');
  console.log('  • Coverage: 80-95% per-wallet');
  console.log('  • Ship: Tomorrow');
  console.log();
  console.log('Next steps:');
  console.log('  1. Run Phase 1 safe recovery script');
  console.log('  2. Build fact_trades_complete via UNION');
  console.log('  3. Validate with quality gates');
  console.log('  4. If gates pass: Ship PnL feature');
  console.log('  5. If gates fail: Fall back to Phase 2');
} else {
  console.log('⚠️  RECOMMENDATION: PHASE 2 (Full Blockchain Backfill)');
  console.log();
  console.log('Why:');
  console.log('  • Large gap exists (>10M transactions)');
  console.log('  • Cannot derive from token_id');
  console.log('  • erc1155_transfers has low coverage');
  console.log();
  console.log('Expected outcome:');
  console.log('  • Timeline: 12-16 hours');
  console.log('  • Cost: $50-200 (paid RPC)');
  console.log('  • Coverage: 95-100% per-wallet (guaranteed)');
  console.log('  • Ship: 2-3 days');
  console.log();
  console.log('Next steps:');
  console.log('  1. Run measurement script to calculate exact ETA');
  console.log('  2. Set up optimized eth_getLogs backfill (16 workers)');
  console.log('  3. Run overnight');
  console.log('  4. Build fact_trades_complete with blockchain data');
  console.log('  5. Ship PnL feature with 95-100% coverage');
}

console.log();
console.log('═'.repeat(70));

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
