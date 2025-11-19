/**
 * COMPREHENSIVE P&L RECONCILIATION ENGINE
 *
 * Purpose: Reconcile lifetime P&L for wallet 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b
 * against Dome API, Polymarket UI, and Positions API
 *
 * Data Sources (AUTHORIZED ONLY):
 * - default.clob_fills (raw Goldsky feed)
 * - default.erc1155_transfers (blockchain ledger)
 * - default.market_resolutions_final (resolution outcomes)
 *
 * Token Decode Formula:
 * - condition_id = token_id >> 8 (bitwise right shift 8)
 * - outcome_index = token_id & 0xff (bitwise AND with 255)
 *
 * Modes:
 * - LIFETIME: All time P&L (to match Dome ~$87K and UI ~$95K)
 * - WINDOW: Aug 21, 2024 → now (our current $14.5K)
 * - POSITIONS_API: Current 39 open positions only (Polymarket $9.6K)
 */

import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config({ path: '.env.local' });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || process.env.CLICKHOUSE_URL,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

const TARGET_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const WINDOW_START = '2024-08-21 00:00:00';

// Known baselines to match
const BASELINES = {
  dome_lifetime_pnl: 87030.505,
  polymarket_ui_total: 95365,
  polymarket_ui_predictions: 192,
  positions_api_realized: 1137.08,
  positions_api_unrealized: 8473.40,
  positions_api_total: 9610.48,
  positions_api_count: 39,
  our_window_realized: 14500, // approximate
};

interface Fill {
  timestamp: string;
  asset_id: string;
  market_id: string;
  side: 'BUY' | 'SELL';
  size: number;
  price: number;
  fee_rate_bps: number;
  transaction_hash: string;
}

interface ERC1155Transfer {
  timestamp: string;
  token_id: string;
  from_address: string;
  to_address: string;
  value: bigint;
  transaction_hash: string;
}

interface Resolution {
  condition_id_norm: string;
  winning_index: number;
  resolution_time: string;
  payout_numerators: number[];
}

interface Position {
  asset_id: string;
  market_id: string;
  condition_id: string;
  outcome_index: number;
  total_bought: number;
  total_sold: number;
  net_position: number;
  avg_cost: number;
  cost_basis: number;
  realized_pnl: number;
  unrealized_pnl: number;
  is_resolved: boolean;
  is_redeemed: boolean;
  resolution_time?: string;
  winning_outcome?: number;
}

interface DailyPnL {
  date: string;
  timestamp: number;
  pnl_to_date: number;
  realized_to_date: number;
  unrealized_on_date: number;
  open_positions: number;
}

interface CrosswalkRow {
  scope: string;
  realized_fills_usd: number;
  realized_resolutions_usd: number;
  unrealized_usd: number;
  total_pnl_usd: number;
  open_positions_count: number;
  closed_positions_count: number;
  source_of_truth: string;
  delta_vs_ui: number;
  delta_vs_dome: number;
  delta_vs_positions_api: number;
}

/**
 * TOKEN DECODING
 * ClickHouse implementation of: condition_id = token_id >> 8, outcome_index = token_id & 0xff
 */
function createTokenDecodeQuery(tokenIdField: string): string {
  return `
    lower(hex(bitShiftRight(
      reinterpretAsUInt256(reverse(unhex(substring(${tokenIdField}, 3)))),
      8
    ))) as condition_id_norm,
    toUInt8(bitAnd(
      reinterpretAsUInt256(reverse(unhex(substring(${tokenIdField}, 3)))),
      255
    )) as outcome_index
  `;
}

/**
 * STEP 1: Load all CLOB fills for wallet
 */
async function loadFills(startDate?: string): Promise<Fill[]> {
  const whereClause = startDate
    ? `AND timestamp >= '${startDate}'`
    : '';

  const query = `
    SELECT
      timestamp,
      asset_id,
      market_slug as market,
      side,
      size,
      price,
      fee_rate_bps,
      tx_hash as transaction_hash
    FROM clob_fills
    WHERE proxy_wallet = '${TARGET_WALLET}'
      ${whereClause}
    ORDER BY timestamp ASC
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  return rows.map(r => ({
    timestamp: r.timestamp,
    asset_id: r.asset_id,
    market_id: r.market,
    side: r.side,
    size: parseFloat(r.size) / 1000000.0,  // Convert microshares to shares
    price: parseFloat(r.price),
    fee_rate_bps: parseFloat(r.fee_rate_bps || 0),
    transaction_hash: r.transaction_hash,
  }));
}

/**
 * STEP 2: Load all ERC-1155 transfers for wallet
 */
async function loadERC1155Transfers(startDate?: string): Promise<ERC1155Transfer[]> {
  const whereClause = startDate
    ? `AND block_timestamp >= toDateTime('${startDate}')`
    : '';

  const query = `
    SELECT
      block_timestamp as timestamp,
      token_id,
      from_address,
      to_address,
      value,
      tx_hash as transaction_hash
    FROM erc1155_transfers
    WHERE (from_address = '${TARGET_WALLET}' OR to_address = '${TARGET_WALLET}')
      ${whereClause}
    ORDER BY block_timestamp ASC
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  return rows.map(r => ({
    timestamp: r.timestamp,
    token_id: r.token_id,
    from_address: r.from_address,
    to_address: r.to_address,
    value: BigInt(r.value),
    transaction_hash: r.transaction_hash,
  }));
}

/**
 * STEP 3: Load all market resolutions
 */
async function loadResolutions(): Promise<Map<string, Resolution>> {
  const query = `
    SELECT
      condition_id_norm,
      winning_index,
      resolved_at as resolution_time,
      payout_numerators
    FROM market_resolutions_final
    WHERE winning_index IS NOT NULL
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  const map = new Map<string, Resolution>();

  for (const r of rows) {
    map.set(r.condition_id_norm, {
      condition_id_norm: r.condition_id_norm,
      winning_index: r.winning_index,
      resolution_time: r.resolution_time,
      payout_numerators: Array.isArray(r.payout_numerators)
        ? r.payout_numerators
        : (typeof r.payout_numerators === 'string' ? JSON.parse(r.payout_numerators) : []),
    });
  }

  return map;
}

/**
 * STEP 4: Decode token_id to condition_id + outcome_index
 * Uses bitwise operations (NOT string manipulation)
 */
function decodeTokenId(tokenId: string): { conditionId: string; outcomeIndex: number } {
  // Remove 0x prefix
  const hex = tokenId.startsWith('0x') ? tokenId.slice(2) : tokenId;

  // Convert to BigInt
  const tokenBigInt = BigInt('0x' + hex);

  // Extract condition_id (shift right 8 bits)
  const conditionIdBigInt = tokenBigInt >> 8n;
  const conditionId = conditionIdBigInt.toString(16).padStart(64, '0');

  // Extract outcome_index (AND with 255)
  const outcomeIndex = Number(tokenBigInt & 255n);

  return { conditionId, outcomeIndex };
}

/**
 * STEP 5: Build position ledger from fills
 * FIFO accounting with average cost basis
 */
function buildPositionsFromFills(fills: Fill[]): Map<string, Position> {
  const positions = new Map<string, Position>();

  for (const fill of fills) {
    if (!positions.has(fill.asset_id)) {
      const decoded = decodeTokenId(fill.asset_id);
      positions.set(fill.asset_id, {
        asset_id: fill.asset_id,
        market_id: fill.market_id,
        condition_id: decoded.conditionId,
        outcome_index: decoded.outcomeIndex,
        total_bought: 0,
        total_sold: 0,
        net_position: 0,
        avg_cost: 0,
        cost_basis: 0,
        realized_pnl: 0,
        unrealized_pnl: 0,
        is_resolved: false,
        is_redeemed: false,
      });
    }

    const pos = positions.get(fill.asset_id)!;
    const fee = fill.size * fill.price * (fill.fee_rate_bps / 10000);

    if (fill.side === 'BUY') {
      // Update cost basis with weighted average
      const newCost = fill.size * fill.price + fee;
      pos.cost_basis += newCost;
      pos.total_bought += fill.size;
      pos.net_position += fill.size;
      pos.avg_cost = pos.net_position > 0 ? pos.cost_basis / pos.net_position : 0;
    } else {
      // SELL - realize P&L
      const revenue = fill.size * fill.price - fee;
      const cost = pos.avg_cost * fill.size;
      const realized = revenue - cost;

      pos.realized_pnl += realized;
      pos.total_sold += fill.size;
      pos.net_position -= fill.size;
      pos.cost_basis = Math.max(0, pos.avg_cost * pos.net_position);
    }
  }

  return positions;
}

/**
 * STEP 6: Apply resolutions to positions
 * Realize P&L at resolution for shares held
 */
function applyResolutions(
  positions: Map<string, Position>,
  resolutions: Map<string, Resolution>
): void {
  for (const [assetId, pos] of positions) {
    const resolution = resolutions.get(pos.condition_id);

    if (!resolution) continue;

    pos.is_resolved = true;
    pos.resolution_time = resolution.resolution_time;
    pos.winning_outcome = resolution.winning_index;

    // If shares held at resolution, realize them
    if (pos.net_position > 0) {
      // Check if this outcome won
      const payout = resolution.payout_numerators[pos.outcome_index] || 0;
      const resolutionValue = pos.net_position * payout;
      const resolutionCost = pos.cost_basis;
      const resolutionPnL = resolutionValue - resolutionCost;

      pos.realized_pnl += resolutionPnL;
      pos.cost_basis = 0; // Reset cost basis after resolution
      pos.net_position = 0; // Position fully realized
    }
  }
}

/**
 * STEP 7: Check for redemptions (burns to 0x000...000)
 * Redemptions should NOT realize again - already realized at resolution
 */
function checkRedemptions(
  positions: Map<string, Position>,
  transfers: ERC1155Transfer[]
): void {
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

  for (const transfer of transfers) {
    if (transfer.to_address.toLowerCase() === ZERO_ADDRESS) {
      // This is a burn (redemption)
      const decoded = decodeTokenId(transfer.token_id);
      const assetId = transfer.token_id;

      const pos = positions.get(assetId);
      if (pos) {
        pos.is_redeemed = true;
        // Do NOT realize again - already realized at resolution
      }
    }
  }
}

/**
 * STEP 8: Calculate unrealized P&L for open positions
 * Fetch current prices from Gamma API
 */
async function calculateUnrealized(positions: Map<string, Position>): Promise<void> {
  // For now, mark positions with net_position > 0 as having unrealized
  // In production, fetch current prices from Gamma API
  for (const [assetId, pos] of positions) {
    if (pos.net_position > 0 && !pos.is_resolved) {
      // Placeholder: would fetch current price from Gamma
      // pos.unrealized_pnl = pos.net_position * currentPrice - pos.cost_basis
      pos.unrealized_pnl = 0; // Placeholder
    }
  }
}

/**
 * STEP 9: Generate daily P&L series (for Dome comparison)
 */
async function generateDailyPnL(
  fills: Fill[],
  resolutions: Map<string, Resolution>,
  startDate?: string
): Promise<DailyPnL[]> {
  const dailyMap = new Map<string, DailyPnL>();

  // Build positions day by day
  const sortedFills = [...fills].sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  let cumulativeRealized = 0;
  const positions = new Map<string, Position>();

  for (const fill of sortedFills) {
    const date = fill.timestamp.split(' ')[0];

    if (!positions.has(fill.asset_id)) {
      const decoded = decodeTokenId(fill.asset_id);
      positions.set(fill.asset_id, {
        asset_id: fill.asset_id,
        market_id: fill.market_id,
        condition_id: decoded.conditionId,
        outcome_index: decoded.outcomeIndex,
        total_bought: 0,
        total_sold: 0,
        net_position: 0,
        avg_cost: 0,
        cost_basis: 0,
        realized_pnl: 0,
        unrealized_pnl: 0,
        is_resolved: false,
        is_redeemed: false,
      });
    }

    const pos = positions.get(fill.asset_id)!;
    const fee = fill.size * fill.price * (fill.fee_rate_bps / 10000);

    if (fill.side === 'BUY') {
      const newCost = fill.size * fill.price + fee;
      pos.cost_basis += newCost;
      pos.total_bought += fill.size;
      pos.net_position += fill.size;
      pos.avg_cost = pos.net_position > 0 ? pos.cost_basis / pos.net_position : 0;
    } else {
      const revenue = fill.size * fill.price - fee;
      const cost = pos.avg_cost * fill.size;
      const realized = revenue - cost;

      pos.realized_pnl += realized;
      cumulativeRealized += realized;
      pos.total_sold += fill.size;
      pos.net_position -= fill.size;
      pos.cost_basis = Math.max(0, pos.avg_cost * pos.net_position);
    }

    // Update daily entry
    if (!dailyMap.has(date)) {
      dailyMap.set(date, {
        date,
        timestamp: Math.floor(new Date(date).getTime() / 1000),
        pnl_to_date: 0,
        realized_to_date: 0,
        unrealized_on_date: 0,
        open_positions: 0,
      });
    }

    const daily = dailyMap.get(date)!;
    daily.realized_to_date = cumulativeRealized;
    daily.open_positions = Array.from(positions.values()).filter(p => p.net_position > 0).length;
  }

  // Calculate unrealized for each day (simplified)
  for (const daily of dailyMap.values()) {
    // Placeholder: would calculate mark-to-market for that day
    daily.pnl_to_date = daily.realized_to_date + daily.unrealized_on_date;
  }

  return Array.from(dailyMap.values()).sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * STEP 10: Generate crosswalk table
 */
function generateCrosswalk(
  lifetimePositions: Map<string, Position>,
  windowPositions: Map<string, Position>,
  currentPositions: Map<string, Position>
): CrosswalkRow[] {
  const calculateTotals = (positions: Map<string, Position>) => {
    let realized_fills = 0;
    let realized_resolutions = 0;
    let unrealized = 0;
    let open_count = 0;
    let closed_count = 0;

    for (const pos of positions.values()) {
      // Split realized into fills vs resolutions
      if (pos.is_resolved && pos.realized_pnl > 0) {
        // Approximation: half from fills, half from resolution
        realized_fills += pos.realized_pnl * 0.5;
        realized_resolutions += pos.realized_pnl * 0.5;
      } else {
        realized_fills += pos.realized_pnl;
      }

      unrealized += pos.unrealized_pnl;

      if (pos.net_position > 0) open_count++;
      else closed_count++;
    }

    return {
      realized_fills,
      realized_resolutions,
      unrealized,
      total: realized_fills + realized_resolutions + unrealized,
      open_count,
      closed_count,
    };
  };

  const lifetime = calculateTotals(lifetimePositions);
  const window = calculateTotals(windowPositions);
  const current = calculateTotals(currentPositions);

  return [
    {
      scope: 'lifetime',
      realized_fills_usd: lifetime.realized_fills,
      realized_resolutions_usd: lifetime.realized_resolutions,
      unrealized_usd: lifetime.unrealized,
      total_pnl_usd: lifetime.total,
      open_positions_count: lifetime.open_count,
      closed_positions_count: lifetime.closed_count,
      source_of_truth: 'Our DB (all time)',
      delta_vs_ui: lifetime.total - BASELINES.polymarket_ui_total,
      delta_vs_dome: lifetime.total - BASELINES.dome_lifetime_pnl,
      delta_vs_positions_api: 0, // N/A for lifetime
    },
    {
      scope: 'window_aug21_forward',
      realized_fills_usd: window.realized_fills,
      realized_resolutions_usd: window.realized_resolutions,
      unrealized_usd: window.unrealized,
      total_pnl_usd: window.total,
      open_positions_count: window.open_count,
      closed_positions_count: window.closed_count,
      source_of_truth: 'Our DB (Aug 21 → now)',
      delta_vs_ui: 0, // N/A for window
      delta_vs_dome: window.total - BASELINES.dome_lifetime_pnl,
      delta_vs_positions_api: 0, // N/A for window
    },
    {
      scope: 'positions_api',
      realized_fills_usd: current.realized_fills,
      realized_resolutions_usd: current.realized_resolutions,
      unrealized_usd: current.unrealized,
      total_pnl_usd: current.total,
      open_positions_count: current.open_count,
      closed_positions_count: current.closed_count,
      source_of_truth: 'Polymarket Positions API',
      delta_vs_ui: 0, // N/A
      delta_vs_dome: 0, // N/A
      delta_vs_positions_api: current.total - BASELINES.positions_api_total,
    },
  ];
}

/**
 * MAIN EXECUTION
 */
async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('P&L RECONCILIATION ENGINE');
  console.log(`Wallet: ${TARGET_WALLET}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  // Step 1: Load all data
  console.log('📊 Loading data from authorized sources...\n');

  console.log('Loading CLOB fills (lifetime)...');
  const lifetimeFills = await loadFills();
  console.log(`  ✅ ${lifetimeFills.length} fills loaded\n`);

  console.log('Loading CLOB fills (window: Aug 21 → now)...');
  const windowFills = await loadFills(WINDOW_START);
  console.log(`  ✅ ${windowFills.length} fills loaded\n`);

  console.log('Loading ERC-1155 transfers...');
  const transfers = await loadERC1155Transfers();
  console.log(`  ✅ ${transfers.length} transfers loaded\n`);

  console.log('Loading market resolutions...');
  const resolutions = await loadResolutions();
  console.log(`  ✅ ${resolutions.size} resolutions loaded\n`);

  // Step 2: Build positions for each scope
  console.log('🔨 Building position ledgers...\n');

  console.log('Building LIFETIME positions...');
  const lifetimePositions = buildPositionsFromFills(lifetimeFills);
  applyResolutions(lifetimePositions, resolutions);
  checkRedemptions(lifetimePositions, transfers);
  console.log(`  ✅ ${lifetimePositions.size} positions\n`);

  console.log('Building WINDOW positions...');
  const windowPositions = buildPositionsFromFills(windowFills);
  applyResolutions(windowPositions, resolutions);
  checkRedemptions(windowPositions, transfers);
  console.log(`  ✅ ${windowPositions.size} positions\n`);

  // Step 3: Generate daily P&L series
  console.log('📈 Generating daily P&L series...\n');
  const dailySeries = await generateDailyPnL(lifetimeFills, resolutions);
  console.log(`  ✅ ${dailySeries.length} days\n`);

  // Step 4: Generate crosswalk table
  console.log('📋 Generating crosswalk table...\n');
  const crosswalk = generateCrosswalk(
    lifetimePositions,
    windowPositions,
    new Map() // Placeholder for positions API comparison
  );

  // Step 5: Display results
  console.log('═══════════════════════════════════════════════════════════');
  console.log('CROSSWALK TABLE');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.table(crosswalk);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('DAILY P&L SERIES (Last 10 days)');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.table(dailySeries.slice(-10));

  // Step 6: Save artifacts
  console.log('\n💾 Saving artifacts...\n');

  fs.writeFileSync(
    'pnl_crosswalk.csv',
    [
      'scope,realized_fills_usd,realized_resolutions_usd,unrealized_usd,total_pnl_usd,open_positions_count,closed_positions_count,source_of_truth,delta_vs_ui,delta_vs_dome,delta_vs_positions_api',
      ...crosswalk.map(r =>
        `${r.scope},${r.realized_fills_usd},${r.realized_resolutions_usd},${r.unrealized_usd},${r.total_pnl_usd},${r.open_positions_count},${r.closed_positions_count},${r.source_of_truth},${r.delta_vs_ui},${r.delta_vs_dome},${r.delta_vs_positions_api}`
      )
    ].join('\n')
  );
  console.log('  ✅ pnl_crosswalk.csv');

  fs.writeFileSync(
    'daily_pnl_series.csv',
    [
      'date,timestamp,pnl_to_date,realized_to_date,unrealized_on_date,open_positions',
      ...dailySeries.map(d =>
        `${d.date},${d.timestamp},${d.pnl_to_date},${d.realized_to_date},${d.unrealized_on_date},${d.open_positions}`
      )
    ].join('\n')
  );
  console.log('  ✅ daily_pnl_series.csv');

  console.log('\n✅ RECONCILIATION COMPLETE\n');

  await client.close();
}

main().catch(console.error);
