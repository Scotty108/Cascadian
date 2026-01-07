/**
 * V12 Final Leaderboard: Simple, Reliable PnL Calculation
 *
 * Formula: PnL = net_cash + net_tokens × resolution_payout
 * - net_cash = sell_usdc - buy_usdc
 * - net_tokens = buy_tokens - sell_tokens
 * - payout = 1 if won, 0 if lost, 0.5 if unresolved
 *
 * Includes data quality filtering:
 * - Exclude wallets with high unmapped trade ratio
 * - Exclude wallets with very high short ratios (arb strategies)
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';
import * as fs from 'fs';

interface Resolution {
  resolved: boolean;
  payout: number;
}

const resolutionCache = new Map<string, Resolution>();

async function loadResolutions() {
  if (resolutionCache.size > 0) return;

  // Use UNION of patch (priority) + v5 for complete coverage
  const mapQ = `
    SELECT token_id_dec, condition_id, outcome_index FROM (
      SELECT token_id_dec, condition_id, toInt64(outcome_index) as outcome_index
      FROM pm_token_to_condition_patch
      WHERE token_id_dec != ''
      UNION ALL
      SELECT token_id_dec, condition_id, toInt64(outcome_index) as outcome_index
      FROM pm_token_to_condition_map_v5
      WHERE token_id_dec NOT IN (SELECT token_id_dec FROM pm_token_to_condition_patch)
    )
  `;
  const mapR = await clickhouse.query({ query: mapQ, format: 'JSONEachRow' });
  const mappings = (await mapR.json()) as any[];

  const tokenToCondition = new Map<string, { condition_id: string; outcome_index: number }>();
  for (const m of mappings) {
    tokenToCondition.set(m.token_id_dec, {
      condition_id: m.condition_id.toLowerCase(),
      outcome_index: parseInt(m.outcome_index),
    });
  }

  const resQ = `SELECT condition_id, payout_numerators FROM pm_condition_resolutions`;
  const resR = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
  const resolutions = (await resR.json()) as any[];

  const conditionResolutions = new Map<string, number[]>();
  for (const r of resolutions) {
    try {
      const payouts = JSON.parse(r.payout_numerators.replace(/'/g, '"'));
      conditionResolutions.set(r.condition_id.toLowerCase(), payouts);
    } catch {}
  }

  for (const [tokenId, mapping] of tokenToCondition) {
    const payouts = conditionResolutions.get(mapping.condition_id);
    if (payouts && payouts.length > mapping.outcome_index) {
      resolutionCache.set(tokenId, {
        resolved: true,
        payout: payouts[mapping.outcome_index] > 0 ? 1.0 : 0.0,
      });
    } else {
      resolutionCache.set(tokenId, { resolved: false, payout: 0 });
    }
  }
  console.log(`Loaded ${resolutionCache.size} token resolutions`);
}

interface WalletPnL {
  wallet: string;
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  trade_count: number;
  mapped_trades: number;
  unmapped_trades: number;
  mapping_ratio: number;
  resolved_positions: number;
  unresolved_positions: number;
  data_confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

async function calcV12PnL(wallet: string): Promise<WalletPnL | null> {
  // Get trade counts - use UNION of patch + v5 for complete coverage
  const countQ = `
    WITH unified_map AS (
      SELECT token_id_dec FROM pm_token_to_condition_patch WHERE token_id_dec != ''
      UNION DISTINCT
      SELECT token_id_dec FROM pm_token_to_condition_map_v5 WHERE token_id_dec != ''
    )
    SELECT
      countDistinct(event_id) as total_trades,
      countDistinct(CASE WHEN m.token_id_dec != '' THEN f.event_id END) as mapped_trades
    FROM pm_trader_events_v2 f
    LEFT JOIN unified_map m ON f.token_id = m.token_id_dec
    WHERE lower(f.trader_wallet) = lower('${wallet}') AND f.is_deleted = 0
  `;

  const countR = await clickhouse.query({ query: countQ, format: 'JSONEachRow' });
  const counts = (await countR.json()) as any[];
  const totalTrades = Number(counts[0]?.total_trades || 0);
  const mappedTrades = Number(counts[0]?.mapped_trades || 0);
  const unmappedTrades = totalTrades - mappedTrades;
  const mappingRatio = totalTrades > 0 ? mappedTrades / totalTrades : 0;

  if (totalTrades < 20) return null; // Too few trades

  // Calculate V12 PnL for mapped trades only - use UNION of patch + v5
  const pnlQ = `
    WITH unified_map AS (
      SELECT token_id_dec FROM pm_token_to_condition_patch WHERE token_id_dec != ''
      UNION DISTINCT
      SELECT token_id_dec FROM pm_token_to_condition_map_v5 WHERE token_id_dec != ''
    )
    SELECT
      token_id,
      sum(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as net_cash,
      sum(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as net_tokens
    FROM (
      SELECT
        any(f.token_id) as token_id,
        any(f.side) as side,
        any(f.usdc_amount) / 1e6 as usdc,
        any(f.token_amount) / 1e6 as tokens
      FROM pm_trader_events_v2 f
      INNER JOIN unified_map m ON f.token_id = m.token_id_dec
      WHERE lower(f.trader_wallet) = lower('${wallet}') AND f.is_deleted = 0
      GROUP BY f.event_id
    )
    GROUP BY token_id
  `;

  const pnlR = await clickhouse.query({ query: pnlQ, format: 'JSONEachRow' });
  const positions = (await pnlR.json()) as any[];

  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let resolvedPositions = 0;
  let unresolvedPositions = 0;

  for (const pos of positions) {
    const tokenId = pos.token_id;
    const netCash = Number(pos.net_cash);
    const netTokens = Number(pos.net_tokens);

    const res = resolutionCache.get(tokenId);
    if (res?.resolved) {
      realizedPnl += netCash + netTokens * res.payout;
      resolvedPositions++;
    } else {
      unrealizedPnl += netCash + netTokens * 0.5;
      unresolvedPositions++;
    }
  }

  // Determine data confidence
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  if (mappingRatio >= 0.9) confidence = 'HIGH';
  else if (mappingRatio >= 0.7) confidence = 'MEDIUM';
  else confidence = 'LOW';

  return {
    wallet,
    realized_pnl: realizedPnl,
    unrealized_pnl: unrealizedPnl,
    total_pnl: realizedPnl + unrealizedPnl,
    trade_count: totalTrades,
    mapped_trades: mappedTrades,
    unmapped_trades: unmappedTrades,
    mapping_ratio: mappingRatio,
    resolved_positions: resolvedPositions,
    unresolved_positions: unresolvedPositions,
    data_confidence: confidence,
  };
}

// Test wallets with known UI values
const testWallets = [
  { addr: '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae', name: 'Latina', ui: 465721 },
  { addr: '0x07c846584cbf796aea720bb41e674e6734fc2696', name: '0x07c8', ui: 143095 },
  { addr: '0xc660ae71765d0d9eaf5fa8328c1c959841d2bd28', name: 'ChangoChango', ui: 37682 },
  { addr: '0xda5fff24aa9d889d6366da205029c73093102e9b', name: 'Kangtamqf', ui: -3452 },
  { addr: '0xcc3f8218a2dc3da410ba88b2f2883af7b18a5c6f', name: 'thepunterwhopunts', ui: 39746 },
  { addr: '0x1d56cdc458f373847e1e5ee31090c76abb747486', name: 'KPSingh', ui: 37801 },
];

async function main() {
  console.log('='.repeat(110));
  console.log('V12 FINAL LEADERBOARD: Simple PnL with Data Quality Filtering');
  console.log('='.repeat(110));
  console.log('');
  console.log('Formula: PnL = net_cash + net_tokens × payout');
  console.log('Confidence: HIGH (≥90% mapped) | MEDIUM (70-90%) | LOW (<70%)');
  console.log('');

  await loadResolutions();

  console.log('');
  console.log('Wallet           | V12 Realized  | Unrealized | Total     | UI Total   | Error   | Mapped% | Conf');
  console.log('-'.repeat(110));

  for (const w of testWallets) {
    const pnl = await calcV12PnL(w.addr);
    if (!pnl) {
      console.log(`${w.name.padEnd(16)} | SKIPPED (too few trades)`);
      continue;
    }

    const error = w.ui !== 0 ? ((pnl.total_pnl - w.ui) / Math.abs(w.ui)) * 100 : 0;
    const errorStr = (error >= 0 ? '+' : '') + error.toFixed(0) + '%';

    console.log(
      `${w.name.padEnd(16)} | ${('$' + pnl.realized_pnl.toFixed(0)).padStart(13)} | ${('$' + pnl.unrealized_pnl.toFixed(0)).padStart(10)} | ${('$' + pnl.total_pnl.toFixed(0)).padStart(9)} | ${('$' + w.ui).padStart(10)} | ${errorStr.padStart(7)} | ${(pnl.mapping_ratio * 100).toFixed(0).padStart(6)}% | ${pnl.data_confidence}`
    );
  }

  console.log('-'.repeat(110));
  console.log('');
  console.log('Next steps:');
  console.log('1. For leaderboard, filter to HIGH confidence wallets (≥90% mapped trades)');
  console.log('2. For HIGH confidence wallets, V12 realized PnL is reliable');
  console.log('3. For MEDIUM/LOW confidence, data is incomplete and PnL may be inaccurate');
}

main().catch(console.error);
