/**
 * Derive Backfill Plan
 *
 * Combines global coverage analysis with wallet-level data gaps to produce
 * a concrete Goldsky backfill plan with:
 * - Exact block ranges needed
 * - Contract addresses
 * - Priority ordering
 * - Estimated impact
 *
 * Usage:
 *   npx tsx scripts/pnl/derive-backfill-plan.ts
 */

import { clickhouse } from '../../lib/clickhouse/client';
import {
  getBlockStats,
  formatBlock,
  POLYMARKET_CONTRACTS,
} from './lib/blockCoverage';

interface DataSource {
  name: string;
  table: string;
  contract: string;
  currentMinBlock: number;
  currentMaxBlock: number;
  totalRows: number;
  backfillNeeded: boolean;
  backfillStartBlock: number;
  backfillEndBlock: number;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  impact: string;
}

interface WalletImpactStats {
  totalWallets: number;
  walletsWithEarlyActivity: number;
  tradesBefore37M: number;
  tokensBefore37M: number;
  usdcBefore37M: number;
}

const ERC1155_START_BLOCK = 37000001;

async function getERC1155Stats(): Promise<DataSource | null> {
  try {
    const stats = await getBlockStats('pm_erc1155_transfers', 'block_number');
    return {
      name: 'ERC1155 Transfers (Conditional Tokens)',
      table: 'pm_erc1155_transfers',
      contract: POLYMARKET_CONTRACTS.CONDITIONAL_TOKENS,
      currentMinBlock: stats.minBlock,
      currentMaxBlock: stats.maxBlock,
      totalRows: stats.totalRows,
      backfillNeeded: stats.minBlock > 1000000,
      backfillStartBlock: 0,
      backfillEndBlock: stats.minBlock - 1,
      priority: 'CRITICAL',
      impact: 'Required for accurate token acquisition records and cost basis',
    };
  } catch {
    return null;
  }
}

async function getERC20Stats(): Promise<DataSource | null> {
  try {
    const stats = await getBlockStats('pm_erc20_usdc_flows', 'block_number');
    return {
      name: 'ERC20 USDC Flows',
      table: 'pm_erc20_usdc_flows',
      contract: POLYMARKET_CONTRACTS.USDC,
      currentMinBlock: stats.minBlock,
      currentMaxBlock: stats.maxBlock,
      totalRows: stats.totalRows,
      backfillNeeded: stats.minBlock > 1000000 || stats.totalRows < 1000000,
      backfillStartBlock: 0,
      backfillEndBlock: Math.max(stats.minBlock - 1, ERC1155_START_BLOCK),
      priority: 'HIGH',
      impact: 'Needed for complete USDC deposit/withdrawal tracking',
    };
  } catch {
    // Table may not exist or have different schema
    return {
      name: 'ERC20 USDC Flows',
      table: 'pm_erc20_usdc_flows',
      contract: POLYMARKET_CONTRACTS.USDC,
      currentMinBlock: 0,
      currentMaxBlock: 0,
      totalRows: 0,
      backfillNeeded: true,
      backfillStartBlock: 0,
      backfillEndBlock: ERC1155_START_BLOCK,
      priority: 'HIGH',
      impact: 'Table missing or incomplete - needs full data',
    };
  }
}

async function getCLOBStats(): Promise<DataSource | null> {
  try {
    const stats = await getBlockStats('pm_trader_events_v2', 'block_number');
    return {
      name: 'CLOB Trader Events',
      table: 'pm_trader_events_v2',
      contract: `${POLYMARKET_CONTRACTS.CTF_EXCHANGE}, ${POLYMARKET_CONTRACTS.NEG_RISK_CTF_EXCHANGE}`,
      currentMinBlock: stats.minBlock,
      currentMaxBlock: stats.maxBlock,
      totalRows: stats.totalRows,
      backfillNeeded: false, // CLOB data is usually complete
      backfillStartBlock: 0,
      backfillEndBlock: 0,
      priority: 'LOW',
      impact: 'Already has good coverage',
    };
  } catch {
    return null;
  }
}

async function getCTFStats(): Promise<DataSource | null> {
  try {
    const stats = await getBlockStats('pm_ctf_events', 'block_number');
    return {
      name: 'CTF Events (Split/Merge/Redemption)',
      table: 'pm_ctf_events',
      contract: POLYMARKET_CONTRACTS.CONDITIONAL_TOKENS,
      currentMinBlock: stats.minBlock,
      currentMaxBlock: stats.maxBlock,
      totalRows: stats.totalRows,
      backfillNeeded: stats.minBlock > 1000000,
      backfillStartBlock: 0,
      backfillEndBlock: stats.minBlock - 1,
      priority: 'MEDIUM',
      impact: 'Needed for complete split/merge/redemption history',
    };
  } catch {
    return null;
  }
}

async function getWalletImpactStats(): Promise<WalletImpactStats> {
  const result = await clickhouse.query({
    query: `
      SELECT
        uniqExact(trader_wallet) as total_wallets,
        uniqExactIf(trader_wallet, min_block < ${ERC1155_START_BLOCK}) as wallets_early,
        sumIf(trade_count, min_block < ${ERC1155_START_BLOCK}) as trades_before_37m,
        sumIf(token_total, min_block < ${ERC1155_START_BLOCK}) as tokens_before_37m,
        sumIf(usdc_total, min_block < ${ERC1155_START_BLOCK}) as usdc_before_37m
      FROM (
        SELECT
          trader_wallet,
          min(block_number) as min_block,
          count() as trade_count,
          sum(token_amount) / 1e6 as token_total,
          sum(usdc_amount) / 1e6 as usdc_total
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND trader_wallet != ''
        GROUP BY trader_wallet
      )
    `,
    format: 'JSONEachRow',
  });

  const row = (await result.json())[0] as any;
  return {
    totalWallets: Number(row.total_wallets || 0),
    walletsWithEarlyActivity: Number(row.wallets_early || 0),
    tradesBefore37M: Number(row.trades_before_37m || 0),
    tokensBefore37M: Number(row.tokens_before_37m || 0),
    usdcBefore37M: Number(row.usdc_before_37m || 0),
  };
}

function printSeparator(char: string = '─', length: number = 80): void {
  console.log(char.repeat(length));
}

async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    GOLDSKY BACKFILL PLAN DERIVATION                        ║');
  console.log('║              Concrete Recommendations for Data Completeness                ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log(`\nGenerated: ${new Date().toISOString()}\n`);

  // Gather data source stats
  console.log('Gathering data source statistics...\n');

  const [erc1155, erc20, clob, ctf, walletImpact] = await Promise.all([
    getERC1155Stats(),
    getERC20Stats(),
    getCLOBStats(),
    getCTFStats(),
    getWalletImpactStats(),
  ]);

  const sources = [erc1155, erc20, clob, ctf].filter((s) => s !== null) as DataSource[];

  // Print current coverage
  console.log('═'.repeat(80));
  console.log('1. CURRENT DATA COVERAGE');
  console.log('═'.repeat(80));

  console.log(
    '\n' +
      'Data Source'.padEnd(35) +
      ' | ' +
      'Min Block'.padStart(12) +
      ' | ' +
      'Max Block'.padStart(12) +
      ' | ' +
      'Rows'.padStart(15)
  );
  printSeparator();

  for (const s of sources) {
    console.log(
      s.name.padEnd(35) +
        ' | ' +
        formatBlock(s.currentMinBlock).padStart(12) +
        ' | ' +
        formatBlock(s.currentMaxBlock).padStart(12) +
        ' | ' +
        formatBlock(s.totalRows).padStart(15)
    );
  }

  // Print wallet impact
  console.log('\n' + '═'.repeat(80));
  console.log('2. WALLET IMPACT ANALYSIS');
  console.log('═'.repeat(80));

  console.log(`
  Total wallets in CLOB:               ${formatBlock(walletImpact.totalWallets)}
  Wallets with pre-37M activity:       ${formatBlock(walletImpact.walletsWithEarlyActivity)} (${((walletImpact.walletsWithEarlyActivity / walletImpact.totalWallets) * 100).toFixed(2)}%)

  Pre-37M activity totals:
    Trades:  ${formatBlock(walletImpact.tradesBefore37M)}
    Tokens:  ${formatBlock(walletImpact.tokensBefore37M)}
    USDC:    $${formatBlock(walletImpact.usdcBefore37M)}
`);

  // Print backfill recommendations
  console.log('═'.repeat(80));
  console.log('3. BACKFILL RECOMMENDATIONS');
  console.log('═'.repeat(80));

  const needsBackfill = sources.filter((s) => s.backfillNeeded);

  if (needsBackfill.length === 0) {
    console.log('\n✅ No backfill needed - all data sources have good coverage.');
  } else {
    // Sort by priority
    const priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    needsBackfill.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    for (const s of needsBackfill) {
      console.log(`
┌──────────────────────────────────────────────────────────────────────────────┐
│ ${s.name.padEnd(76)} │
├──────────────────────────────────────────────────────────────────────────────┤
│ Priority: ${s.priority.padEnd(66)} │
│ Contract: ${s.contract.padEnd(66)} │
│ Table: ${s.table.padEnd(69)} │
├──────────────────────────────────────────────────────────────────────────────┤
│ Current Coverage:                                                            │
│   Block ${formatBlock(s.currentMinBlock)} → ${formatBlock(s.currentMaxBlock)}${' '.repeat(Math.max(0, 52 - formatBlock(s.currentMinBlock).length - formatBlock(s.currentMaxBlock).length))} │
│   Rows: ${formatBlock(s.totalRows).padEnd(68)} │
├──────────────────────────────────────────────────────────────────────────────┤
│ BACKFILL NEEDED:                                                             │
│   Block ${formatBlock(s.backfillStartBlock)} → ${formatBlock(s.backfillEndBlock)}${' '.repeat(Math.max(0, 52 - formatBlock(s.backfillStartBlock).length - formatBlock(s.backfillEndBlock).length))} │
│   Estimated blocks: ${formatBlock(s.backfillEndBlock - s.backfillStartBlock + 1).padEnd(56)} │
├──────────────────────────────────────────────────────────────────────────────┤
│ Impact: ${s.impact.slice(0, 68).padEnd(68)} │
└──────────────────────────────────────────────────────────────────────────────┘`);
    }
  }

  // Print copy-pasteable Goldsky config
  console.log('\n' + '═'.repeat(80));
  console.log('4. GOLDSKY CONFIGURATION (Copy-Pasteable)');
  console.log('═'.repeat(80));

  console.log('\n```yaml');
  console.log('# Goldsky Backfill Configuration');
  console.log('# Generated: ' + new Date().toISOString());
  console.log('');
  console.log('sources:');

  for (const s of needsBackfill) {
    if (s.priority === 'LOW') continue;

    console.log(`  - name: ${s.table.replace('pm_', '')}`);
    console.log(`    contract: "${s.contract.split(',')[0].trim()}"`);
    console.log(`    network: polygon`);
    console.log(`    start_block: ${s.backfillStartBlock}`);
    console.log(`    end_block: ${s.backfillEndBlock}`);
    console.log(`    # Priority: ${s.priority}`);
    console.log(`    # ${s.impact}`);
    console.log('');
  }

  console.log('```');

  // Print summary action items
  console.log('\n' + '═'.repeat(80));
  console.log('5. ACTION ITEMS');
  console.log('═'.repeat(80));

  const critical = needsBackfill.filter((s) => s.priority === 'CRITICAL');
  const high = needsBackfill.filter((s) => s.priority === 'HIGH');
  const medium = needsBackfill.filter((s) => s.priority === 'MEDIUM');

  if (critical.length > 0) {
    console.log('\n🔴 CRITICAL (Do First):');
    for (const s of critical) {
      console.log(`   □ Backfill ${s.table} from block 0 to ${formatBlock(s.backfillEndBlock)}`);
      console.log(`     Contract: ${s.contract}`);
    }
  }

  if (high.length > 0) {
    console.log('\n🟡 HIGH (Do Second):');
    for (const s of high) {
      console.log(`   □ Backfill ${s.table} from block 0 to ${formatBlock(s.backfillEndBlock)}`);
      console.log(`     Contract: ${s.contract}`);
    }
  }

  if (medium.length > 0) {
    console.log('\n🟢 MEDIUM (Nice to Have):');
    for (const s of medium) {
      console.log(`   □ Backfill ${s.table} from block 0 to ${formatBlock(s.backfillEndBlock)}`);
      console.log(`     Contract: ${s.contract}`);
    }
  }

  // Expected outcomes
  console.log('\n' + '═'.repeat(80));
  console.log('6. EXPECTED OUTCOMES AFTER BACKFILL');
  console.log('═'.repeat(80));

  console.log(`
After completing the CRITICAL backfill:

1. Token Acquisition Records
   - ERC1155 transfers will show all token movements from block 0
   - Cost basis can be calculated for all positions
   - No more "ghost tokens" (tokens sold without visible acquisition)

2. PnL Accuracy
   - Fills completeness check should improve from ~65% to ~95%+
   - V17 PnL engine will have complete data for accurate calculations
   - Market-maker wallets will still need special handling

3. Data Volume Estimates
   - ERC1155: ~37M blocks × ~1.1 transfers/block = ~40M rows
   - ERC20: ~37M blocks × variable = ~10-50M rows
   - Total ingestion time: 2-8 hours depending on Goldsky throughput

4. Validation Steps After Backfill
   - Re-run: npx tsx scripts/pnl/sample-wallets-quality.ts
   - Re-run: npx tsx scripts/pnl/log-block-coverage.ts
   - Verify fills completeness improves significantly
`);

  console.log('═'.repeat(80));
  console.log('END OF BACKFILL PLAN');
  console.log('═'.repeat(80) + '\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
