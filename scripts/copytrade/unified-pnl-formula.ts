/**
 * Unified P&L Formula - Works for all wallet types
 *
 * Key insight: Different trading patterns need different split attribution:
 * - SELLER/TRADER (B/S ratio < 2): Apply sell-tx splits (tokens come from splits)
 * - BUYER (B/S ratio > 10): Don't apply splits (market maker inventory, not their cost)
 *
 * Formula: P&L = Sells + Redemptions - Buys - SplitCost + HeldValue
 * Where:
 * - SplitCost = only for SELLER pattern (splits create tokens they sell)
 * - HeldValue = net_tokens * resolved_price (unresolved = 0)
 * - Redemptions = cash from PayoutRedemption events
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';

interface WalletPnlResult {
  wallet: string;
  pattern: 'BUYER' | 'SELLER/TRADER' | 'MIXED';
  buySellRatio: number;
  tokenBalance: number;
  buys: number;
  sells: number;
  splitCost: number;
  redemptions: number;
  heldValue: number;
  pnl: number;
  components: {
    totalBuys: number;
    totalSells: number;
    sellTxSplits: number;
    mappedTokens: number;
    unmappedTokens: number;
    openPositions: number;
    resolvedPositions: number;
  };
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export async function computeUnifiedPnl(wallet: string): Promise<WalletPnlResult> {
  const normalized = wallet.toLowerCase();

  // 1) Get deduped CLOB trades
  const tradesQ = `
    WITH deduped AS (
      SELECT
        replaceRegexpAll(event_id, '-[mt]$', '') as base_id,
        any(side) as side,
        any(usdc_amount)/1e6 as usdc,
        any(token_amount)/1e6 as tokens,
        any(token_id) as token_id,
        any(transaction_hash) as transaction_hash
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${normalized}' AND is_deleted = 0
      GROUP BY base_id
    )
    SELECT
      sum(if(side = 'buy', usdc, 0)) as total_buys,
      sum(if(side = 'sell', usdc, 0)) as total_sells,
      sum(if(side = 'buy', 1, 0)) as buy_count,
      sum(if(side = 'sell', 1, 0)) as sell_count
    FROM deduped
  `;
  const tradesR = await clickhouse.query({ query: tradesQ, format: 'JSONEachRow' });
  const tradesRow = ((await tradesR.json()) as any[])[0];

  const totalBuys = parseFloat(tradesRow.total_buys || 0);
  const totalSells = parseFloat(tradesRow.total_sells || 0);
  const buyCount = parseInt(tradesRow.buy_count || 0);
  const sellCount = parseInt(tradesRow.sell_count || 0);

  // Get token balance (bought - sold) to determine pattern
  const tokenBalanceQ = `
    WITH deduped AS (
      SELECT
        replaceRegexpAll(event_id, '-[mt]$', '') as base_id,
        any(side) as side,
        any(token_amount)/1e6 as tokens
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${normalized}' AND is_deleted = 0
      GROUP BY base_id
    )
    SELECT
      sum(if(side = 'buy', tokens, 0)) - sum(if(side = 'sell', tokens, 0)) as token_balance
    FROM deduped
  `;
  const tokenBalanceR = await clickhouse.query({ query: tokenBalanceQ, format: 'JSONEachRow' });
  const tokenBalanceRow = ((await tokenBalanceR.json()) as any[])[0];
  const tokenBalance = parseFloat(tokenBalanceRow.token_balance || 0);

  // Determine trading pattern based on TOKEN BALANCE, not B/S ratio
  // Negative balance = sold more than bought = SELLER (splits create tokens)
  // Positive balance = holds more than sold = BUYER (no splits)
  const buySellRatio = sellCount > 0 ? buyCount / sellCount : Infinity;
  const pattern = tokenBalance < -100 ? 'SELLER/TRADER' : tokenBalance > 100 ? 'BUYER' : 'MIXED';

  // 2) Get net token positions
  const positionsQ = `
    WITH deduped AS (
      SELECT
        replaceRegexpAll(event_id, '-[mt]$', '') as base_id,
        any(side) as side,
        any(token_amount)/1e6 as tokens,
        any(token_id) as token_id
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${normalized}' AND is_deleted = 0
      GROUP BY base_id
    )
    SELECT
      token_id,
      sum(if(side = 'buy', tokens, -tokens)) as net_tokens
    FROM deduped
    GROUP BY token_id
    HAVING net_tokens != 0
  `;
  const posR = await clickhouse.query({ query: positionsQ, format: 'JSONEachRow' });
  const posRows = (await posR.json()) as Array<{ token_id: string; net_tokens: number }>;

  const tokenIds = posRows.map(r => r.token_id);
  const netByToken = new Map<string, number>();
  for (const row of posRows) netByToken.set(row.token_id, Number(row.net_tokens));

  // 3) Map tokens to conditions (using BOTH gamma and patch tables)
  const mapped: Array<{ token_id: string; condition_id: string; outcome_index: number }> = [];

  if (tokenIds.length > 0) {
    const chunks = chunkArray(tokenIds, 750);
    for (const chunk of chunks) {
      const mappingQ = `
        WITH patch_deduped AS (
          SELECT token_id_dec, any(condition_id) as condition_id, any(outcome_index) as outcome_index
          FROM pm_token_to_condition_patch
          GROUP BY token_id_dec
        )
        SELECT
          ids.token_id_dec as token_id,
          COALESCE(NULLIF(p.condition_id, ''), NULLIF(g.condition_id, '')) as condition_id,
          COALESCE(if(p.condition_id != '', p.outcome_index, NULL), g.outcome_index) as outcome_index
        FROM (
          SELECT token_id_dec FROM pm_token_to_condition_map_v5
          WHERE token_id_dec IN ({tokenIds:Array(String)})
          UNION ALL
          SELECT token_id_dec FROM pm_token_to_condition_patch
          WHERE token_id_dec IN ({tokenIds:Array(String)})
        ) ids
        LEFT JOIN pm_token_to_condition_map_v5 g ON ids.token_id_dec = g.token_id_dec
        LEFT JOIN patch_deduped p ON ids.token_id_dec = p.token_id_dec
        WHERE COALESCE(NULLIF(p.condition_id, ''), NULLIF(g.condition_id, '')) != ''
      `;
      const mappingR = await clickhouse.query({
        query: mappingQ,
        query_params: { tokenIds: chunk },
        format: 'JSONEachRow'
      });
      mapped.push(...(await mappingR.json()) as any[]);
    }
  }

  const mappedTokenSet = new Set(mapped.map(m => m.token_id));
  const unmappedTokens = tokenIds.filter(t => !mappedTokenSet.has(t)).length;
  const conditionIds = [...new Set(mapped.map(m => m.condition_id))];

  // 4) Get sell-tx splits (only if SELLER/TRADER pattern)
  let sellTxSplits = 0;
  if (pattern === 'SELLER/TRADER' && conditionIds.length > 0) {
    const chunks = chunkArray(conditionIds, 750);
    for (const chunk of chunks) {
      const splitQ = `
        WITH wallet_trades AS (
          SELECT
            lower(concat('0x', hex(any(transaction_hash)))) as tx_hash,
            any(side) as side,
            any(usdc_amount)/1e6 as usdc
          FROM pm_trader_events_v2
          WHERE trader_wallet = '${normalized}' AND is_deleted = 0
          GROUP BY replaceRegexpAll(event_id, '-[mt]$', '')
        ),
        sell_tx AS (
          SELECT tx_hash
          FROM wallet_trades
          GROUP BY tx_hash
          HAVING sum(if(side = 'sell', usdc, 0)) > 0
        )
        SELECT sum(toFloat64OrZero(amount_or_payout)) / 1e6 as total
        FROM pm_ctf_events
        WHERE tx_hash IN (SELECT tx_hash FROM sell_tx)
          AND is_deleted = 0
          AND condition_id IN ({conditionIds:Array(String)})
          AND event_type = 'PositionSplit'
      `;
      const splitR = await clickhouse.query({
        query: splitQ,
        query_params: { conditionIds: chunk },
        format: 'JSONEachRow'
      });
      const rows = (await splitR.json()) as any[];
      for (const row of rows) {
        sellTxSplits += parseFloat(row.total || 0);
      }
    }
  }

  // 5) Get resolution prices
  const resMap = new Map<string, Map<number, number>>();
  if (conditionIds.length > 0) {
    const chunks = chunkArray(conditionIds, 750);
    for (const chunk of chunks) {
      const resQ = `
        SELECT condition_id, outcome_index, resolved_price
        FROM vw_pm_resolution_prices
        WHERE condition_id IN ({conditionIds:Array(String)})
      `;
      const resR = await clickhouse.query({
        query: resQ,
        query_params: { conditionIds: chunk },
        format: 'JSONEachRow'
      });
      const rows = (await resR.json()) as any[];
      for (const r of rows) {
        const m = resMap.get(r.condition_id) || new Map<number, number>();
        m.set(Number(r.outcome_index), Number(r.resolved_price));
        resMap.set(r.condition_id, m);
      }
    }
  }

  // 6) Get redemptions
  let redemptions = 0;
  const redQ = `
    SELECT sum(toFloat64OrZero(amount_or_payout)) / 1e6 as total
    FROM pm_ctf_events
    WHERE lower(user_address) = '${normalized}'
      AND event_type = 'PayoutRedemption'
      AND is_deleted = 0
  `;
  const redR = await clickhouse.query({ query: redQ, format: 'JSONEachRow' });
  const redRows = (await redR.json()) as any[];
  redemptions = parseFloat(redRows[0]?.total || 0);

  // 7) Calculate heldValue (net_tokens * resolved_price for positive positions)
  let heldValue = 0;
  let openPositions = 0;
  let resolvedPositions = 0;

  for (const row of mapped) {
    const net = netByToken.get(row.token_id) || 0;
    if (net <= 0) continue;

    const prices = resMap.get(row.condition_id);
    if (!prices) {
      openPositions++;
      continue;
    }

    const price = prices.get(Number(row.outcome_index));
    if (price === undefined || price === null) {
      openPositions++;
      continue;
    }

    resolvedPositions++;
    heldValue += net * price;
  }

  // 8) Calculate final P&L
  // Formula: P&L = Sells + Redemptions - Buys - SplitCost + HeldValue
  const splitCost = pattern === 'SELLER/TRADER' ? sellTxSplits : 0;
  const pnl = totalSells + redemptions - totalBuys - splitCost + heldValue;

  return {
    wallet: normalized,
    pattern,
    buySellRatio,
    tokenBalance,
    buys: totalBuys,
    sells: totalSells,
    splitCost,
    redemptions,
    heldValue,
    pnl,
    components: {
      totalBuys,
      totalSells,
      sellTxSplits,
      mappedTokens: mappedTokenSet.size,
      unmappedTokens,
      openPositions,
      resolvedPositions
    }
  };
}

// Test wallets - ground truth P&L values
const TEST_WALLETS = [
  { address: '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e', ui: -86, name: 'calibration' },
  { address: '0x0d0e73b88444c21094421447451e15e9c4f14049', ui: 268.21, name: 'alexma11224' },  // UI P&L from session
  { address: '0xfb328b94ed05115259bbc48ba8182df1416edb85', ui: 31167.77, name: 'winner1' },  // cohort P&L
];

async function main() {
  console.log('=== Unified P&L Formula Test ===\n');
  console.log('Formula: P&L = Sells + Redemptions - Buys - SplitCost + HeldValue');
  console.log('SplitCost: Only applied for SELLER/TRADER pattern (B/S ratio < 2)\n');

  const results = [];

  for (const wallet of TEST_WALLETS) {
    console.log(`\n--- ${wallet.name.toUpperCase()} (${wallet.address.slice(0, 10)}...) ---`);

    const result = await computeUnifiedPnl(wallet.address);

    console.log(`Pattern: ${result.pattern} (Token balance: ${result.tokenBalance.toFixed(0)})`);
    console.log(`\nComponents:`);
    console.log(`  Buys:       $${result.buys.toFixed(2)}`);
    console.log(`  Sells:      $${result.sells.toFixed(2)}`);
    console.log(`  SplitCost:  $${result.splitCost.toFixed(2)} ${result.pattern !== 'SELLER/TRADER' ? '(skipped)' : ''}`);
    console.log(`  Redemptions: $${result.redemptions.toFixed(2)}`);
    console.log(`  HeldValue:  $${result.heldValue.toFixed(2)}`);
    console.log(`\nMapping: ${result.components.mappedTokens} mapped, ${result.components.unmappedTokens} unmapped`);
    console.log(`Positions: ${result.components.resolvedPositions} resolved, ${result.components.openPositions} open`);

    const error = Math.abs(result.pnl - wallet.ui);
    const errorPct = Math.abs(error / wallet.ui) * 100;

    console.log(`\n  Calculated: $${result.pnl.toFixed(2)}`);
    console.log(`  UI Target:  $${wallet.ui.toFixed(2)}`);
    console.log(`  Error:      $${error.toFixed(2)} (${errorPct.toFixed(1)}%) ${error < 100 ? '✓' : 'X'}`);

    results.push({
      name: wallet.name,
      pattern: result.pattern,
      tokenBal: result.tokenBalance,
      pnl: result.pnl,
      ui: wallet.ui,
      error
    });
  }

  console.log('\n\n=== SUMMARY ===');
  console.log('Wallet      | Pattern       | TokenBal  | PnL         | UI          | Error');
  console.log('------------|---------------|-----------|-------------|-------------|--------');
  for (const r of results) {
    const status = r.error < 100 ? '✓' : 'X';
    console.log(`${r.name.padEnd(11)} | ${r.pattern.padEnd(13)} | ${r.tokenBal.toFixed(0).padStart(9)} | $${r.pnl.toFixed(2).padStart(10)} | $${r.ui.toFixed(2).padStart(10)} | $${r.error.toFixed(2)} ${status}`);
  }
}

main().catch(console.error);
