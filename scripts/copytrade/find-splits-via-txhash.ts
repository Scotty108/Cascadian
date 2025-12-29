/**
 * Find PositionSplit events via tx hash join
 *
 * Key insight from investigation: PositionSplit events are recorded under
 * the EXCHANGE contract address, not the user wallet. We need to join by
 * tx_hash to link them.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== FINDING POSITION SPLITS VIA TX HASH JOIN ===\n');

  // Get unique tx hashes from wallet's CLOB trades (limit to avoid query size issues)
  const q1 = `
    SELECT DISTINCT lower(hex(transaction_hash)) as tx_hash
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}'
      AND is_deleted = 0
  `;

  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  const txRows = (await r1.json()) as { tx_hash: string }[];
  const txHashes = txRows.map((r) => '0x' + r.tx_hash);

  console.log(`Found ${txHashes.length} unique tx hashes from CLOB trades`);

  // Process in batches to avoid query size limits
  const batchSize = 100;
  let totalSplits = 0;
  let totalSplitCost = 0;
  const splitsByAddress: Record<string, { cnt: number; cost: number }> = {};

  for (let i = 0; i < txHashes.length; i += batchSize) {
    const batch = txHashes.slice(i, i + batchSize);
    const txList = batch.map((h) => `'${h}'`).join(',');

    const q2 = `
      SELECT
        event_type,
        user_address,
        toFloat64OrZero(amount_or_payout) / 1e6 as amount
      FROM pm_ctf_events
      WHERE tx_hash IN (${txList})
        AND event_type = 'PositionSplit'
        AND is_deleted = 0
    `;

    const r2 = await clickhouse.query({ query: q2, format: 'JSONEachRow' });
    const rows = (await r2.json()) as { event_type: string; user_address: string; amount: string }[];

    for (const row of rows) {
      totalSplits++;
      const amt = parseFloat(row.amount);
      totalSplitCost += amt;

      const addr = row.user_address.toLowerCase();
      if (!splitsByAddress[addr]) {
        splitsByAddress[addr] = { cnt: 0, cost: 0 };
      }
      splitsByAddress[addr].cnt++;
      splitsByAddress[addr].cost += amt;
    }
  }

  console.log(`\nTotal PositionSplit events: ${totalSplits}`);
  console.log(`Total split cost: $${totalSplitCost.toFixed(2)}`);

  console.log('\nSplits by user_address:');
  const sorted = Object.entries(splitsByAddress).sort((a, b) => b[1].cnt - a[1].cnt);
  for (const [addr, data] of sorted.slice(0, 5)) {
    console.log(`  ${addr}: ${data.cnt} splits, $${data.cost.toFixed(2)}`);
  }

  // Calculate P&L with the actual split cost
  console.log('\n=== P&L CALCULATION WITH ACTUAL SPLIT COST ===');

  const buys = 1214.14;
  const sells = 3848.35;
  const redemptions = 358.54;

  console.log(`Buys: $${buys.toFixed(2)}`);
  console.log(`Sells: $${sells.toFixed(2)}`);
  console.log(`Redemptions: $${redemptions.toFixed(2)}`);
  console.log(`Split cost: $${totalSplitCost.toFixed(2)}`);

  // Formula: P&L = Sells + Redemptions - Buys - SplitCost + HeldValue
  const pnlBeforeHeld = sells + redemptions - buys - totalSplitCost;
  console.log(`\nP&L (before held tokens): $${pnlBeforeHeld.toFixed(2)}`);
  console.log(`Ground truth: -$86.66`);

  const impliedHeldValue = -86.66 - pnlBeforeHeld;
  console.log(`Implied held token value: $${impliedHeldValue.toFixed(2)}`);

  // The held tokens are the LONG positions (2015.81 tokens)
  const heldTokens = 2015.81;
  console.log(`\nHeld tokens: ${heldTokens.toFixed(2)}`);
  console.log(`Implied value per token: $${(impliedHeldValue / heldTokens).toFixed(4)}`);
}

main().catch(console.error);
