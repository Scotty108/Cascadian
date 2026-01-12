/**
 * @deprecated EXPERIMENTAL - DO NOT USE IN PRODUCTION
 * Use pnlEngineV7.ts (API-based) instead
 *
 * PnL Engine V10 - ERC1155 Token Flow Based
 *
 * KEY HYPOTHESIS (from V1-V9 debugging):
 * Polymarket tracks PnL based on actual ERC1155 token movements,
 * NOT the `trader_wallet` attribution in CLOB trades.
 *
 * Why this matters:
 * - Some wallets use proxies (Exchange Proxy, Neg Risk Adapter)
 * - CLOB trades may show `trader_wallet = user` but tokens go to proxy
 * - ERC1155 transfers show actual token ownership
 *
 * V10 Strategy:
 * 1. Track token BALANCE from ERC1155 transfers (in - out)
 * 2. Get COST from CLOB trades that share tx_hash with ERC1155 receipts
 * 3. Calculate PnL = (settlement or mark value) - cost
 *
 * This aligns with how Polymarket subgraph likely works.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../clickhouse/client';

export interface PnLResultV10 {
  wallet: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  positionCount: number;
  tokenCount: number;
  methodNote: string;
}

export async function getWalletPnLV10(wallet: string): Promise<PnLResultV10> {
  const w = wallet.toLowerCase();

  // Step 1: Get all ERC1155 token balances for this wallet
  // net_balance = tokens_received - tokens_sent
  const balanceQuery = `
    WITH
    received AS (
      SELECT
        lower(token_id) as token_id,
        sum(toFloat64OrZero(value)) / 1e6 as tokens_in,
        groupArray(lower(tx_hash)) as tx_hashes
      FROM pm_erc1155_transfers
      WHERE lower(to_address) = '${w}'
        AND is_deleted = 0
      GROUP BY token_id
    ),
    sent AS (
      SELECT
        lower(token_id) as token_id,
        sum(toFloat64OrZero(value)) / 1e6 as tokens_out
      FROM pm_erc1155_transfers
      WHERE lower(from_address) = '${w}'
        AND is_deleted = 0
      GROUP BY token_id
    )
    SELECT
      r.token_id,
      r.tokens_in,
      coalesce(s.tokens_out, 0) as tokens_out,
      r.tokens_in - coalesce(s.tokens_out, 0) as net_balance,
      r.tx_hashes
    FROM received r
    LEFT JOIN sent s ON r.token_id = s.token_id
    WHERE r.tokens_in - coalesce(s.tokens_out, 0) != 0
       OR r.tokens_in > 0
  `;

  const balanceResult = await clickhouse.query({ query: balanceQuery, format: 'JSONEachRow' });
  const balances = (await balanceResult.json()) as any[];

  if (balances.length === 0) {
    return {
      wallet: w,
      realizedPnl: 0,
      unrealizedPnl: 0,
      totalPnl: 0,
      positionCount: 0,
      tokenCount: 0,
      methodNote: 'No ERC1155 tokens found',
    };
  }

  // Step 2: Map tokens to conditions and get resolution/mark prices
  const tokenIds = balances.map(b => b.token_id);

  const mappingQuery = `
    SELECT
      lower(token_id_dec) as token_id,
      lower(condition_id) as condition_id,
      outcome_index
    FROM pm_token_to_condition_map_v5
    WHERE lower(token_id_dec) IN (${tokenIds.map(t => `'${t}'`).join(',')})
  `;

  const mappingResult = await clickhouse.query({ query: mappingQuery, format: 'JSONEachRow' });
  const mappings = (await mappingResult.json()) as any[];

  const tokenToCondition = new Map<string, { condition_id: string; outcome_index: number }>();
  for (const m of mappings) {
    tokenToCondition.set(m.token_id, { condition_id: m.condition_id, outcome_index: Number(m.outcome_index) });
  }

  const conditionIds = [...new Set(mappings.map(m => m.condition_id))];

  if (conditionIds.length === 0) {
    return {
      wallet: w,
      realizedPnl: 0,
      unrealizedPnl: 0,
      totalPnl: 0,
      positionCount: 0,
      tokenCount: balances.length,
      methodNote: 'Tokens not mapped to conditions',
    };
  }

  // Get resolutions
  const resQuery = `
    SELECT lower(condition_id) as condition_id, norm_prices
    FROM pm_condition_resolutions_norm
    WHERE lower(condition_id) IN (${conditionIds.map(c => `'${c}'`).join(',')})
  `;

  // Get mark prices
  const priceQuery = `
    SELECT lower(condition_id) as condition_id, outcome_index, mark_price
    FROM pm_latest_mark_price_v1
    WHERE lower(condition_id) IN (${conditionIds.map(c => `'${c}'`).join(',')})
  `;

  const [resResult, priceResult] = await Promise.all([
    clickhouse.query({ query: resQuery, format: 'JSONEachRow' }),
    clickhouse.query({ query: priceQuery, format: 'JSONEachRow' }),
  ]);

  const resRows = (await resResult.json()) as any[];
  const priceRows = (await priceResult.json()) as any[];

  const resolutions = new Map<string, number[]>();
  for (const r of resRows) {
    resolutions.set(r.condition_id, r.norm_prices);
  }

  const markPrices = new Map<string, number>();
  for (const p of priceRows) {
    markPrices.set(`${p.condition_id}_${p.outcome_index}`, Number(p.mark_price));
  }

  // Step 3: For each token with activity, get cost from CLOB trades in same tx_hashes
  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let positionCount = 0;

  for (const balance of balances) {
    const mapping = tokenToCondition.get(balance.token_id);
    if (!mapping) continue;

    const { condition_id, outcome_index } = mapping;
    const tokensIn = Number(balance.tokens_in) || 0;
    const tokensOut = Number(balance.tokens_out) || 0;
    const netBalance = Number(balance.net_balance) || 0;
    const txHashes = balance.tx_hashes || [];

    if (tokensIn === 0) continue;

    // Get CLOB trades for these tx_hashes to find the actual cost
    // This links ERC1155 receipts back to their CLOB trade prices
    let cost = 0;
    let sellProceeds = 0;

    if (txHashes.length > 0) {
      const costQuery = `
        SELECT
          t.side,
          sum(t.usdc_amount) / 1e6 as total_usdc,
          sum(t.token_amount) / 1e6 as total_tokens
        FROM pm_trader_events_v3 t
        WHERE lower(t.token_id) = '${balance.token_id}'
          AND lower(substring(t.event_id, 1, 66)) IN (${txHashes.map((h: string) => `'${h}'`).join(',')})
        GROUP BY t.side
      `;

      try {
        const costResult = await clickhouse.query({ query: costQuery, format: 'JSONEachRow' });
        const costRows = (await costResult.json()) as any[];

        for (const row of costRows) {
          if (row.side === 'buy') {
            cost = Number(row.total_usdc) || 0;
          } else if (row.side === 'sell') {
            sellProceeds = Number(row.total_usdc) || 0;
          }
        }
      } catch {
        // Fall back to average price estimation
        cost = tokensIn * 0.5; // Assume $0.50 if no CLOB data
      }
    } else {
      // No tx_hashes, use $0.50 estimate (split-based acquisition)
      cost = tokensIn * 0.5;
    }

    // If we couldn't find cost, estimate from average price
    if (cost === 0 && tokensIn > 0) {
      cost = tokensIn * 0.5;
    }

    // Calculate PnL based on resolution or mark price
    const resolution = resolutions.get(condition_id);
    const isResolved = resolution && resolution.length > outcome_index;

    if (isResolved) {
      const payoutPrice = resolution![outcome_index];
      const settlementValue = netBalance * payoutPrice;
      // Realized PnL = sell proceeds + settlement - cost
      realizedPnl += sellProceeds + settlementValue - cost;
    } else {
      const markPrice = markPrices.get(`${condition_id}_${outcome_index}`) || 0;
      const currentValue = netBalance * markPrice;
      // For unresolved: realized = sell proceeds - proportional cost
      const costPerToken = tokensIn > 0 ? cost / tokensIn : 0;
      const costOfSold = tokensOut * costPerToken;
      realizedPnl += sellProceeds - costOfSold;

      // Unrealized = remaining tokens * (mark - cost)
      if (netBalance > 0) {
        positionCount++;
        const remainingCost = netBalance * costPerToken;
        unrealizedPnl += currentValue - remainingCost;
      }
    }
  }

  return {
    wallet: w,
    realizedPnl: Math.round(realizedPnl * 100) / 100,
    unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
    totalPnl: Math.round((realizedPnl + unrealizedPnl) * 100) / 100,
    positionCount,
    tokenCount: balances.length,
    methodNote: 'ERC1155-based token flow tracking',
  };
}
