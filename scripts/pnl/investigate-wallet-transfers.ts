/**
 * Investigate Wallet Transfers
 *
 * Deep dive into transfer patterns for benchmark wallets to understand
 * why some wallets have large PnL discrepancies.
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { UI_BENCHMARK_WALLETS } from './ui-benchmark-constants';

async function investigateWallet(wallet: string, label: string): Promise<void> {
  console.log('═'.repeat(80));
  console.log(`Investigating ${label} (${wallet.substring(0, 12)}...)`);
  console.log('═'.repeat(80));

  // Query ERC1155 transfer events for this wallet
  // Table schema: tx_hash, log_index, block_number, block_timestamp, contract, token_id, from_address, to_address, value, operator
  const xferQuery = await clickhouse.query({
    query: `
      SELECT
        CASE
          WHEN to_address = {wallet:String} THEN 'TRANSFER_IN'
          ELSE 'TRANSFER_OUT'
        END as event_type,
        CASE
          WHEN to_address = {wallet:String} THEN from_address
          ELSE to_address
        END as counterparty,
        token_id,
        reinterpretAsUInt256(reverse(unhex(substring(value, 3)))) / 1e6 as tokens,
        block_timestamp
      FROM pm_erc1155_transfers
      WHERE (from_address = {wallet:String} OR to_address = {wallet:String})
        AND is_deleted = 0
      ORDER BY block_timestamp
    `,
    query_params: { wallet },
    format: 'JSONEachRow',
  });

  const xfers = (await xferQuery.json()) as Array<{
    event_type: string;
    counterparty: string;
    token_id: string;
    tokens: number;
    block_timestamp: string;
  }>;

  console.log(`Total ERC1155 Transfer Events: ${xfers.length}`);
  console.log('');

  if (xfers.length === 0) {
    console.log('No transfers found.');
    return;
  }

  // Group by counterparty and event type
  const byCounterparty = new Map<string, { in_count: number; out_count: number; totalIn: number; totalOut: number }>();

  for (const x of xfers) {
    const cp = x.counterparty;
    if (!byCounterparty.has(cp)) {
      byCounterparty.set(cp, { in_count: 0, out_count: 0, totalIn: 0, totalOut: 0 });
    }
    const stats = byCounterparty.get(cp);
    if (stats) {
      if (x.event_type === 'TRANSFER_IN') {
        stats.in_count++;
        stats.totalIn += x.tokens;
      } else {
        stats.out_count++;
        stats.totalOut += x.tokens;
      }
    }
  }

  console.log('Transfer Summary by Counterparty:');
  console.log('─'.repeat(90));
  console.log('| Counterparty                                       | IN   | OUT  | Total IN      | Total OUT     |');
  console.log('|' + '─'.repeat(52) + '|' + '─'.repeat(6) + '|' + '─'.repeat(6) + '|' + '─'.repeat(15) + '|' + '─'.repeat(15) + '|');

  for (const [cp, stats] of byCounterparty) {
    console.log(
      `| ${cp.padEnd(50)} | ${String(stats.in_count).padStart(4)} | ${String(stats.out_count).padStart(4)} | ${stats.totalIn.toFixed(2).padStart(13)} | ${stats.totalOut.toFixed(2).padStart(13)} |`
    );
  }

  // Check if counterparties are CLOB traders
  console.log('');
  console.log('Counterparty Identity Check:');
  console.log('─'.repeat(90));

  for (const [cp] of byCounterparty) {
    const traderCheck = await clickhouse.query({
      query: `
        SELECT
          count() as trade_count,
          sum(usdc_amount) / 1e6 as total_volume
        FROM (
          SELECT event_id, any(usdc_amount) as usdc_amount
          FROM pm_trader_events_v2
          WHERE trader_wallet = {cp:String}
            AND is_deleted = 0
          GROUP BY event_id
        )
      `,
      query_params: { cp },
      format: 'JSONEachRow',
    });

    const rows = (await traderCheck.json()) as Array<{ trade_count: number; total_volume: number }>;
    if (rows.length > 0 && rows[0].trade_count > 0) {
      console.log(`  ${cp}: TRADER (${rows[0].trade_count} trades, $${rows[0].total_volume.toFixed(0)} volume)`);
    } else {
      console.log(`  ${cp}: NOT A CLOB TRADER - likely infrastructure/contract/P2P`);
    }
  }

  // Check token distribution
  console.log('');
  console.log('Tokens Involved in Transfers:');
  console.log('─'.repeat(90));

  const byToken = new Map<string, { in_count: number; out_count: number; totalIn: number; totalOut: number }>();
  for (const x of xfers) {
    const key = x.token_id;
    if (!byToken.has(key)) {
      byToken.set(key, { in_count: 0, out_count: 0, totalIn: 0, totalOut: 0 });
    }
    const stats = byToken.get(key);
    if (stats) {
      if (x.event_type === 'TRANSFER_IN') {
        stats.in_count++;
        stats.totalIn += x.tokens;
      } else {
        stats.out_count++;
        stats.totalOut += x.tokens;
      }
    }
  }

  console.log(`  Unique token_ids with transfers: ${byToken.size}`);

  // Show top 5 by total transfer amount
  const sorted = Array.from(byToken.entries())
    .sort((a, b) => (b[1].totalIn + b[1].totalOut) - (a[1].totalIn + a[1].totalOut))
    .slice(0, 5);

  console.log('  Top 5 tokens by transfer volume:');
  for (const [tokenId, stats] of sorted) {
    console.log(`    ${tokenId.substring(0, 20)}... IN: ${stats.totalIn.toFixed(2)} | OUT: ${stats.totalOut.toFixed(2)}`);
  }

  console.log('');
}

async function main(): Promise<void> {
  console.log('═'.repeat(80));
  console.log('WALLET TRANSFER INVESTIGATION');
  console.log('═'.repeat(80));
  console.log('');

  // Focus on the wallets with largest gaps: W1, W4, W6
  const walletsToInvestigate = UI_BENCHMARK_WALLETS.filter(
    (w) => w.label === 'W1' || w.label === 'W4' || w.label === 'W6'
  );

  for (const bm of walletsToInvestigate) {
    await investigateWallet(bm.wallet, bm.label);
  }

  // Summary
  console.log('═'.repeat(80));
  console.log('INVESTIGATION SUMMARY');
  console.log('═'.repeat(80));
  console.log('');
  console.log('Key findings:');
  console.log('1. If counterparties are NOT CLOB traders, transfers may represent:');
  console.log('   - Direct P2P token transfers');
  console.log('   - Wallet migration/consolidation');
  console.log('   - MEV bot activity');
  console.log('   - Polymarket rewards/airdrops');
  console.log('');
  console.log('2. The Polymarket UI may handle these differently:');
  console.log('   - May use market price at time of transfer');
  console.log('   - May exclude certain contract interactions');
  console.log('   - May have special handling for known contracts');
  console.log('');
}

main().catch(console.error);
