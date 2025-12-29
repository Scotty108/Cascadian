/**
 * Find CLOB-only Wallets
 *
 * Search for wallets that are likely CLOB-only (no splits/merges, minimal ERC1155 transfers)
 * to test the wallet classifier.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  console.log('='.repeat(90));
  console.log('FINDING POTENTIAL CLOB-ONLY WALLETS');
  console.log('='.repeat(90));
  console.log('');

  // Find wallets with decent CLOB activity but minimal ERC1155 activity
  const query = `
    WITH clob_active AS (
      SELECT
        trader_wallet,
        count() as trade_count
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      GROUP BY trader_wallet
      HAVING trade_count >= 50
    ),
    erc_activity AS (
      SELECT
        address,
        count() as transfer_count
      FROM (
        SELECT from_address as address FROM pm_erc1155_transfers
        UNION ALL
        SELECT to_address as address FROM pm_erc1155_transfers
      )
      GROUP BY address
    ),
    ctf_activity AS (
      SELECT
        lower(user_address) as address,
        countIf(event_type IN ('PositionSplit', 'PositionsMerge')) as split_merge_count
      FROM pm_ctf_events
      WHERE is_deleted = 0
      GROUP BY lower(user_address)
    )
    SELECT
      c.trader_wallet,
      c.trade_count as clob_trades,
      coalesce(e.transfer_count, 0) as erc1155_transfers,
      coalesce(t.split_merge_count, 0) as split_merges
    FROM clob_active c
    LEFT JOIN erc_activity e ON lower(c.trader_wallet) = lower(e.address)
    LEFT JOIN ctf_activity t ON lower(c.trader_wallet) = t.address
    WHERE coalesce(e.transfer_count, 0) <= 10
      AND coalesce(t.split_merge_count, 0) = 0
    ORDER BY c.trade_count DESC
    LIMIT 10
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  console.log('Potential CLOB-only wallets (≥50 trades, ≤10 ERC1155, 0 split/merge):');
  console.log('');
  console.log('| Wallet                                     | CLOB Trades | ERC1155 | Split/Merge |');
  console.log('|--------------------------------------------|-------------|---------|-------------|');

  for (const r of rows) {
    console.log(
      `| ${r.trader_wallet} | ${String(r.clob_trades).padStart(11)} | ${String(r.erc1155_transfers).padStart(7)} | ${String(r.split_merges).padStart(11)} |`
    );
  }

  console.log('');

  if (rows.length > 0) {
    console.log('Top 5 wallet addresses for testing:');
    for (const r of rows.slice(0, 5)) {
      console.log(`  '${r.trader_wallet}',`);
    }
  }

  console.log('');
  console.log('='.repeat(90));
}

main().catch(console.error);
