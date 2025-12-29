/**
 * Phase 3: Compare Wallet Activity - Polymarket API vs Our DB
 *
 * This script fetches activity from Polymarket's data API and compares it
 * to our pm_trader_events_v2 table to identify attribution differences.
 *
 * Usage:
 *   npx tsx scripts/pnl/compare-wallet-activity-vs-ui.ts [wallet]
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { createV17Engine } from '../../lib/pnl/uiActivityEngineV17';

const TRUMP_WALLET = '0x418db17eaa8f25eaf2085657d0becd82462c6786';

interface NormalizedTrade {
  market_id: string; // condition_id or asset_id
  outcome_index: number;
  side: string;
  size: number;
  usdc: number;
  timestamp: number;
  role: string;
  source: 'UI' | 'DB';
}

interface MatchResult {
  only_in_ui: NormalizedTrade[];
  only_in_db: NormalizedTrade[];
  matched: NormalizedTrade[];
}

async function fetchUIActivity(wallet: string): Promise<NormalizedTrade[]> {
  const url = `https://data-api.polymarket.com/activity?user=${wallet}&limit=500`;
  console.log(`Fetching UI activity from: ${url}`);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.log(`API returned ${response.status}`);
      return [];
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      console.log('API response is not an array');
      return [];
    }

    console.log(`Fetched ${data.length} activities from Polymarket API`);

    // Normalize the activity data
    const trades: NormalizedTrade[] = [];

    for (const activity of data) {
      // Each activity has: side, size, usdcSize, timestamp, asset (with condition_id)
      const trade: NormalizedTrade = {
        market_id: activity.conditionId || activity.asset?.conditionId || 'unknown',
        outcome_index: activity.outcomeIndex ?? activity.asset?.outcomeIndex ?? 0,
        side: activity.side?.toLowerCase() || 'unknown',
        size: parseFloat(activity.size) || 0,
        usdc: parseFloat(activity.usdcSize) || 0,
        timestamp: new Date(activity.timestamp || 0).getTime(),
        role: 'taker', // UI activity typically shows taker perspective
        source: 'UI',
      };
      trades.push(trade);
    }

    return trades;
  } catch (err: any) {
    console.log(`Error fetching UI activity: ${err.message}`);
    return [];
  }
}

async function fetchDBTrades(wallet: string): Promise<NormalizedTrade[]> {
  // Get trades with condition_id via join
  const query = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(role) as role,
        any(token_amount) / 1000000.0 as tokens,
        any(usdc_amount) / 1000000.0 as usdc,
        any(trade_time) as trade_time
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      m.condition_id as market_id,
      m.outcome_index,
      d.side,
      d.role,
      d.tokens as size,
      d.usdc,
      toUnixTimestamp(d.trade_time) * 1000 as timestamp
    FROM deduped d
    INNER JOIN pm_token_to_condition_map_v3 m ON d.token_id = m.token_id_dec
    ORDER BY d.trade_time
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  console.log(`Fetched ${rows.length} trades from ClickHouse`);

  return rows.map((r) => ({
    market_id: r.market_id.toLowerCase(),
    outcome_index: r.outcome_index,
    side: r.side.toLowerCase(),
    size: r.size,
    usdc: r.usdc,
    timestamp: r.timestamp,
    role: r.role,
    source: 'DB' as const,
  }));
}

function matchTrades(uiTrades: NormalizedTrade[], dbTrades: NormalizedTrade[]): MatchResult {
  const matched: NormalizedTrade[] = [];
  const only_in_ui: NormalizedTrade[] = [];
  const only_in_db: NormalizedTrade[] = [...dbTrades];

  // For each UI trade, try to find a match in DB
  for (const uiTrade of uiTrades) {
    // Find matching DB trade by market_id, side, and approximate size/time
    const matchIndex = only_in_db.findIndex((dbTrade) => {
      const marketMatch = dbTrade.market_id === uiTrade.market_id;
      const sideMatch = dbTrade.side === uiTrade.side;
      // Allow 5% size tolerance
      const sizeTolerance = Math.max(uiTrade.size * 0.05, 0.1);
      const sizeMatch = Math.abs(dbTrade.size - uiTrade.size) < sizeTolerance;
      // Allow 60 second time tolerance
      const timeMatch = Math.abs(dbTrade.timestamp - uiTrade.timestamp) < 60000;

      return marketMatch && sideMatch && sizeMatch && timeMatch;
    });

    if (matchIndex >= 0) {
      matched.push(uiTrade);
      only_in_db.splice(matchIndex, 1); // Remove matched trade from DB list
    } else {
      only_in_ui.push(uiTrade);
    }
  }

  return { matched, only_in_ui, only_in_db };
}

async function computePnLByFilter(
  wallet: string,
  filter: 'all' | 'taker_only' | 'maker_only'
): Promise<{ realized: number; unrealized: number }> {
  // Compute PnL with different trade filters
  const roleFilter = filter === 'all' ? '' : filter === 'taker_only' ? "AND role = 'taker'" : "AND role = 'maker'";

  const query = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(token_amount) / 1000000.0 as tokens,
        any(usdc_amount) / 1000000.0 as usdc
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
        ${roleFilter}
      GROUP BY event_id
    )
    SELECT
      m.condition_id,
      m.outcome_index,
      sum(CASE WHEN d.side = 'buy' THEN abs(d.tokens) ELSE 0 END) as buy_tokens,
      sum(CASE WHEN d.side = 'sell' THEN abs(d.tokens) ELSE 0 END) as sell_tokens,
      sum(CASE WHEN d.side = 'buy' THEN abs(d.usdc) ELSE 0 END) as buy_usdc,
      sum(CASE WHEN d.side = 'sell' THEN abs(d.usdc) ELSE 0 END) as sell_usdc
    FROM deduped d
    INNER JOIN pm_token_to_condition_map_v3 m ON d.token_id = m.token_id_dec
    GROUP BY m.condition_id, m.outcome_index
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const positions = (await result.json()) as any[];

  // Load resolutions
  const resQuery = 'SELECT condition_id, payout_numerators FROM pm_condition_resolutions';
  const resResult = await clickhouse.query({ query: resQuery, format: 'JSONEachRow' });
  const resolutions = (await resResult.json()) as any[];

  const resMap = new Map<string, number[]>();
  for (const r of resolutions) {
    const payouts = JSON.parse(r.payout_numerators);
    resMap.set(r.condition_id.toLowerCase(), payouts);
  }

  let realized = 0;
  let unrealized = 0;

  for (const pos of positions) {
    const cashFlow = pos.sell_usdc - pos.buy_usdc;
    const finalShares = pos.buy_tokens - pos.sell_tokens;
    const payouts = resMap.get(pos.condition_id.toLowerCase());
    const isResolved = payouts && payouts.length > pos.outcome_index;
    const resPrice = isResolved ? payouts[pos.outcome_index] : null;

    if (isResolved && resPrice !== null) {
      realized += cashFlow + finalShares * resPrice;
    } else {
      unrealized += cashFlow + finalShares * 0.5;
    }
  }

  return { realized, unrealized };
}

async function main() {
  const wallet = process.argv[2] || TRUMP_WALLET;

  console.log('='.repeat(120));
  console.log('PHASE 3: ACTIVITY COMPARISON - Polymarket API vs Our DB');
  console.log('='.repeat(120));
  console.log(`Wallet: ${wallet}`);
  console.log('');

  // Step 1: Fetch UI activity
  const uiTrades = await fetchUIActivity(wallet);
  const dbTrades = await fetchDBTrades(wallet);

  console.log('');
  console.log('='.repeat(80));
  console.log('TRADE COUNT COMPARISON');
  console.log('='.repeat(80));
  console.log(`UI Activity API: ${uiTrades.length} trades`);
  console.log(`DB (pm_trader_events_v2): ${dbTrades.length} unique trades`);
  console.log(`Difference: ${dbTrades.length - uiTrades.length} extra trades in DB`);

  // Step 2: Match trades
  console.log('');
  console.log('='.repeat(80));
  console.log('TRADE MATCHING');
  console.log('='.repeat(80));

  const { matched, only_in_ui, only_in_db } = matchTrades(uiTrades, dbTrades);

  console.log(`MATCHED (in both):     ${matched.length} trades`);
  console.log(`ONLY_IN_UI:            ${only_in_ui.length} trades`);
  console.log(`ONLY_IN_DB:            ${only_in_db.length} trades`);

  // Step 3: Analyze ONLY_IN_DB trades
  console.log('');
  console.log('='.repeat(80));
  console.log('ONLY_IN_DB ANALYSIS');
  console.log('='.repeat(80));

  const makerOnlyInDB = only_in_db.filter((t) => t.role === 'maker');
  const takerOnlyInDB = only_in_db.filter((t) => t.role === 'taker');

  console.log(`Total ONLY_IN_DB:      ${only_in_db.length} trades`);
  console.log(`  - Maker trades:      ${makerOnlyInDB.length} (${((makerOnlyInDB.length / only_in_db.length) * 100).toFixed(1)}%)`);
  console.log(`  - Taker trades:      ${takerOnlyInDB.length} (${((takerOnlyInDB.length / only_in_db.length) * 100).toFixed(1)}%)`);

  const onlyInDBVolume = only_in_db.reduce((sum, t) => sum + t.usdc, 0);
  const makerVolume = makerOnlyInDB.reduce((sum, t) => sum + t.usdc, 0);
  const takerVolume = takerOnlyInDB.reduce((sum, t) => sum + t.usdc, 0);

  console.log(`ONLY_IN_DB Volume:     $${onlyInDBVolume.toFixed(2)}`);
  console.log(`  - Maker volume:      $${makerVolume.toFixed(2)}`);
  console.log(`  - Taker volume:      $${takerVolume.toFixed(2)}`);

  // Markets in ONLY_IN_DB
  const marketsInOnlyDB = new Set(only_in_db.map((t) => t.market_id));
  console.log(`Markets in ONLY_IN_DB: ${marketsInOnlyDB.size}`);

  // Check if Trump market is in ONLY_IN_DB
  const trumpCondition = 'dd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917';
  const trumpInOnlyDB = only_in_db.filter((t) => t.market_id === trumpCondition);
  if (trumpInOnlyDB.length > 0) {
    const trumpMaker = trumpInOnlyDB.filter((t) => t.role === 'maker').length;
    const trumpTaker = trumpInOnlyDB.filter((t) => t.role === 'taker').length;
    console.log(`Trump trades in ONLY_IN_DB: ${trumpInOnlyDB.length} (maker: ${trumpMaker}, taker: ${trumpTaker})`);
  }

  // Step 4: Compute PnL under different attribution policies
  console.log('');
  console.log('='.repeat(80));
  console.log('PNL UNDER DIFFERENT ATTRIBUTION POLICIES');
  console.log('='.repeat(80));

  const pnlAll = await computePnLByFilter(wallet, 'all');
  const pnlTakerOnly = await computePnLByFilter(wallet, 'taker_only');
  const pnlMakerOnly = await computePnLByFilter(wallet, 'maker_only');

  const uiPnl = wallet.toLowerCase() === TRUMP_WALLET.toLowerCase() ? 5.44 : 0;

  console.log(`UI PnL (benchmark):    $${uiPnl.toFixed(2)}`);
  console.log('');
  console.log(`PnL_all:               $${pnlAll.realized.toFixed(2)} realized, $${pnlAll.unrealized.toFixed(2)} unrealized`);
  console.log(`PnL_taker_only:        $${pnlTakerOnly.realized.toFixed(2)} realized, $${pnlTakerOnly.unrealized.toFixed(2)} unrealized`);
  console.log(`PnL_maker_only:        $${pnlMakerOnly.realized.toFixed(2)} realized, $${pnlMakerOnly.unrealized.toFixed(2)} unrealized`);
  console.log('');
  console.log('Error vs UI:');
  console.log(`  PnL_all:             ${Math.abs(pnlAll.realized - uiPnl).toFixed(2)} off (${(((pnlAll.realized - uiPnl) / uiPnl) * 100).toFixed(0)}%)`);
  console.log(`  PnL_taker_only:      ${Math.abs(pnlTakerOnly.realized - uiPnl).toFixed(2)} off (${(((pnlTakerOnly.realized - uiPnl) / uiPnl) * 100).toFixed(0)}%)`);

  // Step 5: Summary
  console.log('');
  console.log('='.repeat(80));
  console.log('PHASE 3 SUMMARY');
  console.log('='.repeat(80));
  console.log('');
  console.log(`1. Trade Attribution Gap:`);
  console.log(`   - DB has ${only_in_db.length} trades not in UI (${((only_in_db.length / dbTrades.length) * 100).toFixed(0)}% of DB trades)`);
  console.log(`   - ${makerOnlyInDB.length} are maker trades (${((makerOnlyInDB.length / only_in_db.length) * 100).toFixed(0)}%)`);
  console.log('');
  console.log(`2. PnL Impact:`);
  console.log(`   - PnL_all ($${pnlAll.realized.toFixed(2)}) is ${((pnlAll.realized / uiPnl - 1) * 100).toFixed(0)}% higher than UI ($${uiPnl})`);
  console.log(`   - PnL_taker_only ($${pnlTakerOnly.realized.toFixed(2)}) is still ${((pnlTakerOnly.realized / uiPnl - 1) * 100).toFixed(0)}% higher`);
  console.log('');
  console.log(`3. Conclusion:`);
  if (pnlTakerOnly.realized > uiPnl * 10) {
    console.log('   Even taker-only PnL is much higher than UI.');
    console.log('   This suggests data source difference, not just maker/taker attribution.');
    console.log('   Our pm_trader_events_v2 attributes trades to this wallet that');
    console.log('   Polymarket does not recognize as belonging to this user.');
  } else if (Math.abs(pnlTakerOnly.realized - uiPnl) < Math.abs(uiPnl) * 0.15) {
    console.log('   Taker-only PnL is close to UI.');
    console.log('   RECOMMENDATION: Filter to taker trades for UI-like PnL.');
  }
  console.log('');
}

main().catch(console.error);
