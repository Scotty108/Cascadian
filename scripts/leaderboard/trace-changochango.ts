/**
 * Deep trace of ChangoChango's PnL calculation
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

const wallet = '0xc660ae71765d0d9eaf5fa8328c1c959841d2bd28';

interface Resolution {
  resolved: boolean;
  payout: number;
}

const resolutionCache = new Map<string, Resolution>();

async function loadResolutions() {
  const mapQ = `SELECT token_id_dec, condition_id, outcome_index FROM pm_token_to_condition_map_v5`;
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
}

async function analyze() {
  await loadResolutions();

  // Get summary stats
  const statsQ = `
    SELECT
      side,
      count() as trades,
      sum(usdc) as total_usdc,
      sum(tokens) as total_tokens
    FROM (
      SELECT
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
      GROUP BY event_id
    )
    GROUP BY side
  `;

  const statsR = await clickhouse.query({ query: statsQ, format: 'JSONEachRow' });
  const stats = (await statsR.json()) as any[];

  console.log('=== ChangoChango Overall Stats ===');
  for (const s of stats) {
    console.log(`${s.side}: ${s.trades} trades, $${Number(s.total_usdc).toFixed(2)} USDC, ${Number(s.total_tokens).toFixed(2)} tokens`);
  }

  // Calculate V12-style PnL (simplest correct formula)
  const v12Q = `
    SELECT
      token_id,
      sum(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as net_cash,
      sum(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as net_tokens
    FROM (
      SELECT
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
      GROUP BY event_id
    )
    GROUP BY token_id
  `;

  const v12R = await clickhouse.query({ query: v12Q, format: 'JSONEachRow' });
  const positions = (await v12R.json()) as any[];

  let totalRealizedPnl = 0;
  let totalUnrealizedPnl = 0;
  let resolvedCount = 0;
  let unresolvedCount = 0;
  let winCount = 0;
  let lossCount = 0;
  let biggestWin = { tokenId: '', pnl: 0 };
  let biggestLoss = { tokenId: '', pnl: 0 };

  for (const pos of positions) {
    const tokenId = pos.token_id;
    const netCash = Number(pos.net_cash);
    const netTokens = Number(pos.net_tokens);

    const res = resolutionCache.get(tokenId);
    if (res?.resolved) {
      const pnl = netCash + netTokens * res.payout;
      totalRealizedPnl += pnl;
      resolvedCount++;
      if (pnl > 0) {
        winCount++;
        if (pnl > biggestWin.pnl) biggestWin = { tokenId, pnl };
      } else if (pnl < 0) {
        lossCount++;
        if (pnl < biggestLoss.pnl) biggestLoss = { tokenId, pnl };
      }
    } else {
      const pnl = netCash + netTokens * 0.5;
      totalUnrealizedPnl += pnl;
      unresolvedCount++;
    }
  }

  console.log('\n=== V12-Style PnL (net_cash + net_tokens × payout) ===');
  console.log(`Resolved positions: ${resolvedCount}`);
  console.log(`Unresolved positions: ${unresolvedCount}`);
  console.log(`Wins: ${winCount}, Losses: ${lossCount}`);
  console.log(`Realized PnL: $${totalRealizedPnl.toFixed(2)}`);
  console.log(`Unrealized PnL: $${totalUnrealizedPnl.toFixed(2)}`);
  console.log(`Total: $${(totalRealizedPnl + totalUnrealizedPnl).toFixed(2)}`);
  console.log(`UI shows: $37,682`);

  console.log(`\nBiggest win: ${biggestWin.tokenId.slice(0, 20)}... = $${biggestWin.pnl.toFixed(2)}`);
  console.log(`Biggest loss: ${biggestLoss.tokenId.slice(0, 20)}... = $${biggestLoss.pnl.toFixed(2)}`);

  // Check the top 10 positions by absolute PnL
  console.log('\n=== Top 10 Positions by |PnL| ===');
  const pnlByToken: { tokenId: string; netCash: number; netTokens: number; payout: number | null; pnl: number }[] = [];

  for (const pos of positions) {
    const tokenId = pos.token_id;
    const netCash = Number(pos.net_cash);
    const netTokens = Number(pos.net_tokens);
    const res = resolutionCache.get(tokenId);
    const payout = res?.resolved ? res.payout : null;
    const pnl = payout !== null ? netCash + netTokens * payout : netCash + netTokens * 0.5;
    pnlByToken.push({ tokenId, netCash, netTokens, payout, pnl });
  }

  pnlByToken.sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));

  console.log('Token | Net Cash | Net Tokens | Payout | PnL');
  for (const p of pnlByToken.slice(0, 10)) {
    const payoutStr = p.payout !== null ? p.payout.toFixed(1) : 'N/A';
    console.log(
      `${p.tokenId.slice(0, 15).padEnd(15)} | $${p.netCash.toFixed(0).padStart(8)} | ${p.netTokens.toFixed(0).padStart(10)} | ${payoutStr.padStart(6)} | $${p.pnl.toFixed(0).padStart(8)}`
    );
  }

  // Check if there are any positions with very large net_cash but small net_tokens (suspicious)
  console.log('\n=== Suspicious Positions (high cash, low tokens) ===');
  const suspicious = pnlByToken.filter((p) => Math.abs(p.netCash) > 1000 && Math.abs(p.netTokens) < 100);
  for (const p of suspicious.slice(0, 5)) {
    console.log(
      `${p.tokenId.slice(0, 15).padEnd(15)} | $${p.netCash.toFixed(0).padStart(8)} | ${p.netTokens.toFixed(0).padStart(10)}`
    );
  }
}

analyze().catch(console.error);
