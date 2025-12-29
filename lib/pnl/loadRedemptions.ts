/**
 * Redemption Loader
 *
 * Loads PayoutRedemption cashflows from pm_ctf_events.
 * These represent USDC inflows when a wallet redeems winning positions.
 *
 * Key insight: Redemption USDC is NOT profit - it's the full payout.
 * Profit = redemption_usdc - cost_basis_of_redeemed_shares
 *
 * However, for wallets where we're missing cost basis (due to transfers, splits, etc.),
 * adding redemption cashflow as an adjustment can improve accuracy.
 */
import { getClickHouseClient } from '../clickhouse/client';

export interface WalletRedemptions {
  wallet: string;
  usdcRedeemedTotal: number;
  usdcRedeemed30d: number;
  usdcRedeemed90d: number;
  redemptionCountTotal: number;
  redemptionCount30d: number;
  redemptionCount90d: number;
}

export interface RedemptionLoadResult {
  redemptions: Map<string, WalletRedemptions>;
  stats: {
    totalWallets: number;
    totalRedemptions: number;
    totalUsdcRedeemed: number;
    walletsWithRecent30d: number;
    walletsWithRecent90d: number;
  };
}

/**
 * Load redemption data for all wallets.
 *
 * @returns Map of wallet -> redemption stats
 */
export async function loadRedemptions(): Promise<RedemptionLoadResult> {
  const client = getClickHouseClient();

  // Load aggregated redemption data per wallet
  const result = await client.query({
    query: `
      SELECT
        lower(user_address) as wallet,
        sum(toFloat64OrZero(amount_or_payout)) / 1e6 as usdc_total,
        sumIf(toFloat64OrZero(amount_or_payout), event_timestamp >= now() - INTERVAL 30 DAY) / 1e6 as usdc_30d,
        sumIf(toFloat64OrZero(amount_or_payout), event_timestamp >= now() - INTERVAL 90 DAY) / 1e6 as usdc_90d,
        count() as count_total,
        countIf(event_timestamp >= now() - INTERVAL 30 DAY) as count_30d,
        countIf(event_timestamp >= now() - INTERVAL 90 DAY) as count_90d
      FROM pm_ctf_events
      WHERE event_type = 'PayoutRedemption'
        AND is_deleted = 0
      GROUP BY wallet
    `,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as any[];
  const redemptions = new Map<string, WalletRedemptions>();

  let totalUsdcRedeemed = 0;
  let totalRedemptions = 0;
  let walletsWithRecent30d = 0;
  let walletsWithRecent90d = 0;

  for (const r of rows) {
    const wallet = r.wallet.toLowerCase();
    const data: WalletRedemptions = {
      wallet,
      usdcRedeemedTotal: Number(r.usdc_total),
      usdcRedeemed30d: Number(r.usdc_30d),
      usdcRedeemed90d: Number(r.usdc_90d),
      redemptionCountTotal: Number(r.count_total),
      redemptionCount30d: Number(r.count_30d),
      redemptionCount90d: Number(r.count_90d),
    };

    redemptions.set(wallet, data);

    totalUsdcRedeemed += data.usdcRedeemedTotal;
    totalRedemptions += data.redemptionCountTotal;
    if (data.redemptionCount30d > 0) walletsWithRecent30d++;
    if (data.redemptionCount90d > 0) walletsWithRecent90d++;
  }

  return {
    redemptions,
    stats: {
      totalWallets: redemptions.size,
      totalRedemptions,
      totalUsdcRedeemed,
      walletsWithRecent30d,
      walletsWithRecent90d,
    },
  };
}

/**
 * Load redemptions for a specific list of wallets (more efficient for small sets).
 */
export async function loadRedemptionsForWallets(
  wallets: string[]
): Promise<Map<string, WalletRedemptions>> {
  if (wallets.length === 0) return new Map();

  const client = getClickHouseClient();
  const walletList = wallets.map((w) => `'${w.toLowerCase()}'`).join(',');

  const result = await client.query({
    query: `
      SELECT
        lower(user_address) as wallet,
        sum(toFloat64OrZero(amount_or_payout)) / 1e6 as usdc_total,
        sumIf(toFloat64OrZero(amount_or_payout), event_timestamp >= now() - INTERVAL 30 DAY) / 1e6 as usdc_30d,
        sumIf(toFloat64OrZero(amount_or_payout), event_timestamp >= now() - INTERVAL 90 DAY) / 1e6 as usdc_90d,
        count() as count_total,
        countIf(event_timestamp >= now() - INTERVAL 30 DAY) as count_30d,
        countIf(event_timestamp >= now() - INTERVAL 90 DAY) as count_90d
      FROM pm_ctf_events
      WHERE event_type = 'PayoutRedemption'
        AND is_deleted = 0
        AND lower(user_address) IN (${walletList})
      GROUP BY wallet
    `,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as any[];
  const redemptions = new Map<string, WalletRedemptions>();

  for (const r of rows) {
    const wallet = r.wallet.toLowerCase();
    redemptions.set(wallet, {
      wallet,
      usdcRedeemedTotal: Number(r.usdc_total),
      usdcRedeemed30d: Number(r.usdc_30d),
      usdcRedeemed90d: Number(r.usdc_90d),
      redemptionCountTotal: Number(r.count_total),
      redemptionCount30d: Number(r.count_30d),
      redemptionCount90d: Number(r.count_90d),
    });
  }

  return redemptions;
}

/**
 * Get redemption data for a single wallet.
 */
export function getWalletRedemptions(
  redemptions: Map<string, WalletRedemptions>,
  wallet: string
): WalletRedemptions | null {
  return redemptions.get(wallet.toLowerCase()) || null;
}

/**
 * Diagnostic: Print redemption statistics.
 */
export async function printRedemptionDiagnostics(): Promise<void> {
  const { redemptions, stats } = await loadRedemptions();

  console.log('=== Redemption Diagnostics ===');
  console.log('Total wallets with redemptions:', stats.totalWallets.toLocaleString());
  console.log('Total redemption events:', stats.totalRedemptions.toLocaleString());
  console.log('Total USDC redeemed:', '$' + stats.totalUsdcRedeemed.toLocaleString());
  console.log('Wallets with 30d activity:', stats.walletsWithRecent30d.toLocaleString());
  console.log('Wallets with 90d activity:', stats.walletsWithRecent90d.toLocaleString());

  // Top 10 by total redeemed
  const sorted = Array.from(redemptions.values())
    .sort((a, b) => b.usdcRedeemedTotal - a.usdcRedeemedTotal)
    .slice(0, 10);

  console.log('\nTop 10 wallets by total USDC redeemed:');
  for (const r of sorted) {
    console.log(
      `  ${r.wallet.slice(0, 12)}.. $${r.usdcRedeemedTotal.toLocaleString()} (${r.redemptionCountTotal} events)`
    );
  }
}
