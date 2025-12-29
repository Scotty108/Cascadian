/**
 * Wallet Ledger Reconciliation
 *
 * Goal: explain cash delta vs realized PnL using canonical ledger.
 * Uses pm_unified_ledger_v8_tbl (CLOB + CTF) and the subgraph engine.
 *
 * Usage: npx tsx scripts/copytrade/wallet-ledger-reconcile.ts <wallet>
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';
import { loadPolymarketPnlEventsForWallet } from '@/lib/pnl/polymarketEventLoader';
import { createEmptyEngineState, applyEventToState, sortEventsByTimestamp, COLLATERAL_SCALE } from '@/lib/pnl/polymarketSubgraphEngine';

const WALLET = (process.argv[2] || '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e').toLowerCase();
const LEDGER = 'pm_unified_ledger_v8_tbl';

async function getLedgerColumns(): Promise<Set<string>> {
  const res = await clickhouse.query({ query: `DESCRIBE TABLE ${LEDGER}`, format: 'JSONEachRow' });
  const rows = await res.json() as Array<{ name: string }>;
  return new Set(rows.map(r => r.name));
}

async function main(): Promise<void> {
  console.log('=== WALLET LEDGER RECONCILIATION ===');
  console.log(`Wallet: ${WALLET}`);
  console.log(`Ledger: ${LEDGER}\n`);

  const cols = await getLedgerColumns();
  const hasSourceType = cols.has('source_type');

  const ledgerAggQuery = `
    SELECT
      sum(usdc_delta) as total_usdc,
      sumIf(usdc_delta, source_type = 'CLOB') as clob_usdc,
      sumIf(usdc_delta, source_type = 'PayoutRedemption') as redemption_usdc,
      sumIf(usdc_delta, source_type NOT IN ('CLOB', 'PayoutRedemption')) as other_usdc,
      count() as total_rows,
      countIf(source_type = 'CLOB') as clob_rows,
      countIf(source_type = 'PayoutRedemption') as redemption_rows
    FROM ${LEDGER}
    WHERE lower(wallet_address) = lower({wallet:String})
  `;

  const ledgerAggRes = await clickhouse.query({
    query: ledgerAggQuery,
    query_params: { wallet: WALLET },
    format: 'JSONEachRow',
  });
  const ledgerAgg = (await ledgerAggRes.json() as any[])[0] || {};

  console.log('--- Ledger Summary ---');
  console.log(`Total USDC (all sources): ${Number(ledgerAgg.total_usdc || 0).toFixed(2)}`);
  console.log(`CLOB USDC:                ${Number(ledgerAgg.clob_usdc || 0).toFixed(2)}`);
  console.log(`Redemption USDC:          ${Number(ledgerAgg.redemption_usdc || 0).toFixed(2)}`);
  console.log(`Other USDC:               ${Number(ledgerAgg.other_usdc || 0).toFixed(2)}`);
  console.log(`Rows: total=${ledgerAgg.total_rows || 0}, clob=${ledgerAgg.clob_rows || 0}, redemption=${ledgerAgg.redemption_rows || 0}\n`);

  if (hasSourceType) {
    const bySourceQ = `
      SELECT source_type, count() as rows, sum(usdc_delta) as usdc_delta
      FROM ${LEDGER}
      WHERE lower(wallet_address) = lower({wallet:String})
      GROUP BY source_type
      ORDER BY abs(usdc_delta) DESC
    `;
    const bySourceRes = await clickhouse.query({ query: bySourceQ, query_params: { wallet: WALLET }, format: 'JSONEachRow' });
    const bySource = await bySourceRes.json() as Array<{ source_type: string; rows: string; usdc_delta: string }>;

    console.log('--- Ledger by Source Type ---');
    for (const row of bySource) {
      console.log(`${row.source_type || '(null)'}: rows=${row.rows} usdc=${Number(row.usdc_delta).toFixed(2)}`);
    }
    console.log('');
  }

  // Engine realized PnL (economic parity synthetic ALL)
  const { events } = await loadPolymarketPnlEventsForWallet(WALLET, {
    includeSyntheticRedemptions: true,
    syntheticRedemptionMode: 'all',
    includeErc1155Transfers: false,
  });

  const state = createEmptyEngineState(WALLET, { includeTransfers: false, mode: 'strict' });
  for (const e of sortEventsByTimestamp(events)) applyEventToState(state, e);

  const realizedPnl = Number(state.realizedPnlRaw) / Number(COLLATERAL_SCALE);
  const openPositions = Array.from(state.positions.values()).filter((p) => p.amount > 0n).length;

  console.log('--- Engine (Subgraph) ---');
  console.log(`Realized PnL (synthetic ALL): ${realizedPnl.toFixed(2)}`);
  console.log(`Open positions: ${openPositions}`);
  console.log('');

  // CLOB cash flow from raw trades (deduped)
  const clobCashQ = `
    SELECT
      sumIf(usdc_amount, side = 'sell') / 1e6 as sells,
      sumIf(usdc_amount, side = 'buy') / 1e6 as buys,
      (sumIf(usdc_amount, side = 'sell') - sumIf(usdc_amount, side = 'buy')) / 1e6 as net
    FROM (
      SELECT
        any(usdc_amount) as usdc_amount,
        any(side) as side
      FROM pm_trader_events_v2
      WHERE trader_wallet = {wallet:String} AND is_deleted = 0
      GROUP BY event_id
    )
  `;
  const clobCashRes = await clickhouse.query({ query: clobCashQ, query_params: { wallet: WALLET }, format: 'JSONEachRow' });
  const clobCash = (await clobCashRes.json() as any[])[0] || {};

  console.log('--- CLOB Cash Flow (deduped) ---');
  console.log(`Buys:  -${Number(clobCash.buys || 0).toFixed(2)}`);
  console.log(`Sells: +${Number(clobCash.sells || 0).toFixed(2)}`);
  console.log(`Net:   ${Number(clobCash.net || 0).toFixed(2)}`);
  console.log('');

  if (!cols.has('token_delta')) {
    console.log('Note: token_delta column not available in ledger; skipping token flow summary.');\n  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
