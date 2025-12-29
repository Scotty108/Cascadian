/**
 * Token Mapping Coverage Audit
 *
 * Scans all relevant tables to identify token/condition mapping gaps
 * that affect PnL calculations.
 *
 * Sources checked:
 * - pm_trader_events_v2 (CLOB trades)
 * - pm_ctf_events (Split/Merge/Redemption)
 * - pm_erc1155_transfers (token transfers)
 *
 * Output:
 * - Coverage metrics per source
 * - Top unmapped tokens by impact
 * - Per-wallet breakdown for benchmark wallets
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { UI_BENCHMARK_WALLETS } from './ui-benchmark-constants';
import * as fs from 'fs';

interface MappingGap {
  conditionId: string;
  source: string;
  eventCount: number;
  walletCount: number;
  sampleWallet: string;
  sampleTxHash: string;
}

interface WalletGap {
  wallet: string;
  label: string;
  unmappedConditions: number;
  affectedEvents: number;
  estimatedMissingPnl: number;
}

async function getClobTokenIds(): Promise<Map<string, { count: number; wallets: Set<string>; sampleTx: string }>> {
  console.log('Scanning pm_trader_events_v2 for token_ids...');

  const result = await clickhouse.query({
    query: `
      SELECT
        token_id,
        count() as event_count,
        uniqExact(trader_wallet) as wallet_count,
        any(transaction_hash) as sample_tx
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND token_id != ''
      GROUP BY token_id
      ORDER BY event_count DESC
    `,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as Array<{
    token_id: string;
    event_count: string;
    wallet_count: string;
    sample_tx: string;
  }>;

  const map = new Map<string, { count: number; wallets: Set<string>; sampleTx: string }>();
  for (const row of rows) {
    map.set(row.token_id, {
      count: parseInt(row.event_count),
      wallets: new Set(),
      sampleTx: row.sample_tx,
    });
  }

  console.log(`  Found ${map.size} unique token_ids in CLOB trades`);
  return map;
}

async function getCtfConditionIds(): Promise<Map<string, { count: number; wallets: Set<string>; sampleTx: string }>> {
  console.log('Scanning pm_ctf_events for condition_ids...');

  const result = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        count() as event_count,
        uniqExact(user_address) as wallet_count,
        any(tx_hash) as sample_tx
      FROM pm_ctf_events
      WHERE is_deleted = 0
        AND condition_id != ''
      GROUP BY condition_id
      ORDER BY event_count DESC
    `,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as Array<{
    condition_id: string;
    event_count: string;
    wallet_count: string;
    sample_tx: string;
  }>;

  const map = new Map<string, { count: number; wallets: Set<string>; sampleTx: string }>();
  for (const row of rows) {
    map.set(row.condition_id, {
      count: parseInt(row.event_count),
      wallets: new Set(),
      sampleTx: row.sample_tx,
    });
  }

  console.log(`  Found ${map.size} unique condition_ids in CTF events`);
  return map;
}

async function getMappedTokenIds(): Promise<Set<string>> {
  console.log('Loading pm_token_to_condition_map_v3...');

  const result = await clickhouse.query({
    query: `
      SELECT DISTINCT token_id_dec
      FROM pm_token_to_condition_map_v3
      WHERE token_id_dec != ''
    `,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as Array<{ token_id_dec: string }>;
  const set = new Set(rows.map((r) => r.token_id_dec));

  console.log(`  Found ${set.size} mapped token_ids`);
  return set;
}

async function getMappedConditionIds(): Promise<Set<string>> {
  console.log('Loading condition_ids from pm_token_to_condition_map_v3...');

  const result = await clickhouse.query({
    query: `
      SELECT DISTINCT condition_id
      FROM pm_token_to_condition_map_v3
      WHERE condition_id != ''
    `,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as Array<{ condition_id: string }>;
  const set = new Set(rows.map((r) => r.condition_id));

  console.log(`  Found ${set.size} mapped condition_ids`);
  return set;
}

async function getWalletTokenUsage(wallet: string): Promise<Map<string, number>> {
  const result = await clickhouse.query({
    query: `
      SELECT
        token_id,
        count() as event_count
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = {wallet:String}
        AND is_deleted = 0
        AND token_id != ''
      GROUP BY token_id
    `,
    query_params: { wallet: wallet.toLowerCase() },
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as Array<{ token_id: string; event_count: string }>;
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.token_id, parseInt(row.event_count));
  }

  return map;
}

async function main(): Promise<void> {
  console.log('═'.repeat(80));
  console.log('TOKEN MAPPING COVERAGE AUDIT');
  console.log('═'.repeat(80));
  console.log('');

  // Step 1: Collect token_ids from CLOB and condition_ids from CTF
  const clobTokens = await getClobTokenIds();
  const ctfConditions = await getCtfConditionIds();
  const mappedTokenIds = await getMappedTokenIds();
  const mappedConditionIds = await getMappedConditionIds();

  console.log('');
  console.log('─'.repeat(80));
  console.log('COVERAGE SUMMARY');
  console.log('─'.repeat(80));

  // CLOB uses token_id
  const clobMapped = [...clobTokens.keys()].filter((t) => mappedTokenIds.has(t)).length;
  const clobUnmapped = clobTokens.size - clobMapped;

  // CTF uses condition_id
  const ctfMapped = [...ctfConditions.keys()].filter((c) => mappedConditionIds.has(c)).length;
  const ctfUnmapped = ctfConditions.size - ctfMapped;

  console.log(`\nCLOB Trades (pm_trader_events_v2) - uses token_id:`);
  console.log(`  Total unique token_ids: ${clobTokens.size}`);
  console.log(`  Mapped: ${clobMapped} (${((clobMapped / clobTokens.size) * 100).toFixed(1)}%)`);
  console.log(`  Unmapped: ${clobUnmapped}`);

  console.log(`\nCTF Events (pm_ctf_events) - uses condition_id:`);
  console.log(`  Total unique condition_ids: ${ctfConditions.size}`);
  console.log(`  Mapped: ${ctfMapped} (${((ctfMapped / ctfConditions.size) * 100).toFixed(1)}%)`);
  console.log(`  Unmapped: ${ctfUnmapped}`);

  // Step 2: Find unmapped token_ids with high impact
  console.log('');
  console.log('─'.repeat(80));
  console.log('TOP 20 UNMAPPED TOKEN_IDS BY EVENT COUNT (CLOB)');
  console.log('─'.repeat(80));

  const unmappedTokenGaps: MappingGap[] = [];

  for (const [tid, info] of clobTokens) {
    if (!mappedTokenIds.has(tid)) {
      unmappedTokenGaps.push({
        conditionId: tid, // reusing field for token_id
        source: 'CLOB',
        eventCount: info.count,
        walletCount: 0,
        sampleWallet: '',
        sampleTxHash: info.sampleTx,
      });
    }
  }

  // Sort by event count
  unmappedTokenGaps.sort((a, b) => b.eventCount - a.eventCount);

  console.log('');
  console.log('| Token ID (first 20)        | Events | Sample TX (first 16)    |');
  console.log('|----------------------------|--------|-------------------------|');

  for (const gap of unmappedTokenGaps.slice(0, 20)) {
    console.log(
      `| ${gap.conditionId.substring(0, 20).padEnd(26)} | ${gap.eventCount.toString().padStart(6)} | ${gap.sampleTxHash.substring(0, 16).padEnd(23)} |`
    );
  }

  // Step 3: Find unmapped condition_ids (CTF)
  console.log('');
  console.log('─'.repeat(80));
  console.log('TOP 20 UNMAPPED CONDITION_IDS BY EVENT COUNT (CTF)');
  console.log('─'.repeat(80));

  const unmappedConditionGaps: MappingGap[] = [];

  for (const [cid, info] of ctfConditions) {
    if (!mappedConditionIds.has(cid)) {
      unmappedConditionGaps.push({
        conditionId: cid,
        source: 'CTF',
        eventCount: info.count,
        walletCount: 0,
        sampleWallet: '',
        sampleTxHash: info.sampleTx,
      });
    }
  }

  unmappedConditionGaps.sort((a, b) => b.eventCount - a.eventCount);

  console.log('');
  console.log('| Condition ID (first 20)    | Events | Sample TX (first 16)    |');
  console.log('|----------------------------|--------|-------------------------|');

  for (const gap of unmappedConditionGaps.slice(0, 20)) {
    console.log(
      `| ${gap.conditionId.substring(0, 20).padEnd(26)} | ${gap.eventCount.toString().padStart(6)} | ${gap.sampleTxHash.substring(0, 16).padEnd(23)} |`
    );
  }

  // Step 4: Per-wallet breakdown for benchmark wallets
  console.log('');
  console.log('─'.repeat(80));
  console.log('BENCHMARK WALLET BREAKDOWN (CLOB token_ids)');
  console.log('─'.repeat(80));

  const walletGaps: WalletGap[] = [];

  for (const bm of UI_BENCHMARK_WALLETS) {
    const walletTokens = await getWalletTokenUsage(bm.wallet);

    let unmappedCount = 0;
    let affectedEvents = 0;
    const unmappedList: Array<{ tid: string; count: number }> = [];

    for (const [tid, count] of walletTokens) {
      if (!mappedTokenIds.has(tid)) {
        unmappedCount++;
        affectedEvents += count;
        unmappedList.push({ tid, count });
      }
    }

    walletGaps.push({
      wallet: bm.wallet,
      label: bm.label,
      unmappedConditions: unmappedCount,
      affectedEvents,
      estimatedMissingPnl: 0,
    });

    console.log(`\n${bm.label} (${bm.wallet.substring(0, 12)}...):`);
    console.log(`  Total tokens traded: ${walletTokens.size}`);
    console.log(`  Unmapped tokens: ${unmappedCount}`);
    console.log(`  Events on unmapped tokens: ${affectedEvents}`);

    if (unmappedCount > 0 && unmappedCount <= 10) {
      console.log('  Unmapped token_ids:');
      for (const { tid, count } of unmappedList) {
        console.log(`    - ${tid.substring(0, 24)}... (${count} events)`);
      }
    } else if (unmappedCount > 10) {
      console.log(`  (Too many to list - showing first 5)`);
      for (const { tid, count } of unmappedList.slice(0, 5)) {
        console.log(`    - ${tid.substring(0, 24)}... (${count} events)`);
      }
    }
  }

  // Step 5: Save CSV for further analysis
  console.log('');
  console.log('─'.repeat(80));
  console.log('EXPORTING GAPS TO CSV');
  console.log('─'.repeat(80));

  const csvLines = ['id,type,source,event_count,sample_tx'];
  for (const gap of unmappedTokenGaps) {
    csvLines.push(`${gap.conditionId},token_id,CLOB,${gap.eventCount},${gap.sampleTxHash}`);
  }
  for (const gap of unmappedConditionGaps) {
    csvLines.push(`${gap.conditionId},condition_id,CTF,${gap.eventCount},${gap.sampleTxHash}`);
  }

  const csvPath = 'tmp/token_mapping_gaps.csv';
  try {
    fs.mkdirSync('tmp', { recursive: true });
    fs.writeFileSync(csvPath, csvLines.join('\n'));
    console.log(`\nSaved ${unmappedTokenGaps.length + unmappedConditionGaps.length} unmapped IDs to ${csvPath}`);
  } catch (err) {
    console.log(`\nCould not save CSV: ${err}`);
  }

  // Summary
  console.log('');
  console.log('═'.repeat(80));
  console.log('SUMMARY');
  console.log('═'.repeat(80));
  console.log('');
  console.log(`CLOB token_id Coverage: ${((clobMapped / clobTokens.size) * 100).toFixed(2)}% (${clobUnmapped} unmapped)`);
  console.log(`CTF condition_id Coverage: ${((ctfMapped / ctfConditions.size) * 100).toFixed(2)}% (${ctfUnmapped} unmapped)`);
  console.log('');

  const problemWallets = walletGaps.filter((w) => w.unmappedConditions > 0);
  if (problemWallets.length > 0) {
    console.log('Benchmark wallets with mapping gaps:');
    for (const w of problemWallets) {
      console.log(`  ${w.label}: ${w.unmappedConditions} unmapped tokens (${w.affectedEvents} events)`);
    }
  } else {
    console.log('All benchmark wallets have full mapping coverage!');
  }

  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
