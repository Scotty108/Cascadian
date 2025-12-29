/**
 * Audit Wallet Data Coverage
 *
 * For a given wallet, prints date ranges and row counts across data sources:
 * - pm_trader_events_v2 (CLOB)
 * - pm_erc1155_transfers
 * - pm_ctf_events (redemptions, splits)
 *
 * Flags wallets with data completeness issues.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';

interface CoverageStats {
  wallet: string;
  clob: {
    earliest: string;
    latest: string;
    rowCount: number;
  };
  erc1155: {
    earliest: string;
    latest: string;
    rowCount: number;
  };
  ctf: {
    earliest: string;
    latest: string;
    rowCount: number;
    redemptions: number;
    splits: number;
  };
  flags: string[];
}

async function auditWallet(client: any, wallet: string): Promise<CoverageStats> {
  const flags: string[] = [];

  // CLOB coverage
  const clobResult = await client.query({
    query: `
      SELECT
        min(trade_time) as earliest,
        max(trade_time) as latest,
        count() as cnt
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
    `,
    format: 'JSONEachRow',
  });
  const clobStats = (await clobResult.json() as any[])[0];

  // ERC1155 coverage
  const erc1155Result = await client.query({
    query: `
      SELECT
        min(block_timestamp) as earliest,
        max(block_timestamp) as latest,
        count() as cnt
      FROM pm_erc1155_transfers
      WHERE (lower(to_address) = lower('${wallet}') OR lower(from_address) = lower('${wallet}'))
        AND is_deleted = 0
    `,
    format: 'JSONEachRow',
  });
  const erc1155Stats = (await erc1155Result.json() as any[])[0];

  // CTF coverage
  const ctfResult = await client.query({
    query: `
      SELECT
        min(event_timestamp) as earliest,
        max(event_timestamp) as latest,
        count() as cnt,
        countIf(event_type = 'PayoutRedemption') as redemptions,
        countIf(event_type = 'PositionSplit') as splits
      FROM pm_ctf_events
      WHERE lower(user_address) = lower('${wallet}') AND is_deleted = 0
    `,
    format: 'JSONEachRow',
  });
  const ctfStats = (await ctfResult.json() as any[])[0];

  // Check for gaps
  const clobLatest = new Date(clobStats.latest);
  const erc1155Latest = new Date(erc1155Stats.latest);
  const ctfLatest = new Date(ctfStats.latest);

  const threeDays = 3 * 24 * 60 * 60 * 1000;

  if (erc1155Stats.cnt > 0 && clobStats.cnt > 0) {
    if (erc1155Latest.getTime() < clobLatest.getTime() - threeDays) {
      flags.push(`ERC1155_STALE: max ERC1155 (${erc1155Stats.latest}) < max CLOB (${clobStats.latest})`);
    }
    if (new Date(erc1155Stats.earliest).getTime() > new Date(clobStats.earliest).getTime() + threeDays) {
      flags.push(`ERC1155_MISSING_EARLY: min ERC1155 (${erc1155Stats.earliest}) > min CLOB (${clobStats.earliest})`);
    }
  }

  if (erc1155Stats.cnt === 0 && clobStats.cnt > 0) {
    flags.push('NO_ERC1155_DATA');
  }

  if (ctfStats.redemptions > 0) {
    flags.push(`HAS_REDEMPTIONS: ${ctfStats.redemptions} PayoutRedemption events`);
  }

  if (ctfStats.splits > 0) {
    flags.push(`HAS_SPLITS: ${ctfStats.splits} PositionSplit events`);
  }

  return {
    wallet,
    clob: {
      earliest: clobStats.earliest,
      latest: clobStats.latest,
      rowCount: Number(clobStats.cnt),
    },
    erc1155: {
      earliest: erc1155Stats.earliest,
      latest: erc1155Stats.latest,
      rowCount: Number(erc1155Stats.cnt),
    },
    ctf: {
      earliest: ctfStats.earliest,
      latest: ctfStats.latest,
      rowCount: Number(ctfStats.cnt),
      redemptions: Number(ctfStats.redemptions),
      splits: Number(ctfStats.splits),
    },
    flags,
  };
}

function printCoverageReport(stats: CoverageStats): void {
  console.log('\n' + '='.repeat(70));
  console.log('Wallet:', stats.wallet);
  console.log('='.repeat(70));

  console.log('\nCLOB (pm_trader_events_v2):');
  console.log('  Rows:', stats.clob.rowCount.toLocaleString());
  console.log('  Range:', stats.clob.earliest, 'to', stats.clob.latest);

  console.log('\nERC1155 (pm_erc1155_transfers):');
  console.log('  Rows:', stats.erc1155.rowCount.toLocaleString());
  console.log('  Range:', stats.erc1155.earliest, 'to', stats.erc1155.latest);

  console.log('\nCTF (pm_ctf_events):');
  console.log('  Rows:', stats.ctf.rowCount.toLocaleString());
  console.log('  Redemptions:', stats.ctf.redemptions.toLocaleString());
  console.log('  Splits:', stats.ctf.splits.toLocaleString());
  console.log('  Range:', stats.ctf.earliest, 'to', stats.ctf.latest);

  if (stats.flags.length > 0) {
    console.log('\n⚠️  FLAGS:');
    for (const flag of stats.flags) {
      console.log('  •', flag);
    }
  } else {
    console.log('\n✓ No data coverage issues detected');
  }
}

async function main() {
  const client = getClickHouseClient();

  // The 5 worst wallets from earlier investigation
  const problemWallets = [
    '0x7f3c8979d0afa00007bae4747d5347122af05613', // LucasMeow - -$1.4M engine vs +$214k UI
    '0xa7cfafa0db244f760436fcf83c8b1eb98904ba10', // -$138k engine vs +$16k UI
    '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144', // -$374k engine vs +$130k UI
    '0x3c3c46c1442ddbafce15a0097d2f5a0f4d797d32', // Small wallet for sanity check
    '0x8672768b9fadf29d8ad810ae2966d4e89e9ad2c1', // Small wallet for sanity check
  ];

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   WALLET DATA COVERAGE AUDIT                                               ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');

  const allStats: CoverageStats[] = [];

  for (const wallet of problemWallets) {
    const stats = await auditWallet(client, wallet);
    allStats.push(stats);
    printCoverageReport(stats);
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));

  const withIssues = allStats.filter((s) => s.flags.length > 0);
  const withRedemptions = allStats.filter((s) => s.ctf.redemptions > 0);
  const withSplits = allStats.filter((s) => s.ctf.splits > 0);
  const withStaleErc1155 = allStats.filter((s) => s.flags.some((f) => f.startsWith('ERC1155_STALE')));

  console.log('\nTotal wallets audited:', allStats.length);
  console.log('Wallets with issues:', withIssues.length);
  console.log('Wallets with redemptions:', withRedemptions.length);
  console.log('Wallets with splits:', withSplits.length);
  console.log('Wallets with stale ERC1155:', withStaleErc1155.length);

  // Check global ERC1155 date range
  console.log('\n--- Global ERC1155 Data Range ---');
  const globalResult = await client.query({
    query: `
      SELECT
        min(block_timestamp) as earliest,
        max(block_timestamp) as latest,
        count() as cnt
      FROM pm_erc1155_transfers
    `,
    format: 'JSONEachRow',
  });
  const global = (await globalResult.json() as any[])[0];
  console.log('Range:', global.earliest, 'to', global.latest);
  console.log('Total rows:', Number(global.cnt).toLocaleString());
}

main().catch(console.error);
