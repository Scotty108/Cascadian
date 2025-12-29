import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { clickhouse } from "../../lib/clickhouse/client";

async function main() {
  // Calculate additional risk metrics for our verified wallets
  const verifiedWallets = [
    "0xd04d631183d7568356f598a3c77181ec4ab6d0e5", // @kamlot
    "0xb63ac06f20eed05d0a34f61116d0580a0afb4064", // @plzdontdropout
    "0xf32a44b612a60f2b0c0f23c419876ec1c89c06fd", // @Dit26978
    "0x5d91954919c7c729cc0dc4c82c62d336132f3578", // @YourFriendSteave
    "0x184e98eb1d39dfb9e7750e860512a9adbcbecf96", // @Mr-Anderson
    "0x3eba55f41f4064bc4b070d06a00fec7c2dd5849a", // @pwnatorul
    "0x861307b57badefb591238c2148781e0728ee59f0", // @AMX13
  ];

  const walletList = verifiedWallets.map(w => "'" + w + "'").join(",");

  // Calculate win rate and omega from markout data
  const query = `
  WITH fill_outcomes AS (
    SELECT 
      wallet,
      markout_bps,
      notional,
      CASE WHEN markout_bps > 0 THEN 1 ELSE 0 END as is_win,
      CASE WHEN markout_bps > 0 THEN markout_bps * notional ELSE 0 END as win_amount,
      CASE WHEN markout_bps < 0 THEN abs(markout_bps * notional) ELSE 0 END as loss_amount
    FROM markout_14d_fills
    WHERE wallet IN (${walletList})
  ),
  wallet_metrics AS (
    SELECT
      wallet,
      count() as total_fills,
      sum(is_win) as wins,
      round(sum(is_win) * 100.0 / count(), 1) as win_rate,
      round(sum(win_amount), 2) as gross_wins,
      round(sum(loss_amount), 2) as gross_losses,
      round(sum(win_amount) / nullIf(sum(loss_amount), 0), 2) as omega,
      round(avg(CASE WHEN markout_bps > 0 THEN markout_bps ELSE null END), 2) as avg_win_bps,
      round(avg(CASE WHEN markout_bps < 0 THEN markout_bps ELSE null END), 2) as avg_loss_bps,
      round(max(CASE WHEN markout_bps < 0 THEN abs(markout_bps * notional) ELSE 0 END), 2) as max_single_loss
    FROM fill_outcomes
    GROUP BY wallet
  ),
  recent_performance AS (
    SELECT
      wallet,
      sum(markout_bps * notional) as recent_pnl_proxy
    FROM markout_14d_fills
    WHERE wallet IN (${walletList})
      AND trade_date >= today() - 30
    GROUP BY wallet
  )
  SELECT 
    m.wallet,
    m.total_fills,
    m.wins,
    m.win_rate,
    m.omega,
    m.avg_win_bps,
    m.avg_loss_bps,
    round(abs(m.avg_win_bps / nullIf(m.avg_loss_bps, 0)), 2) as reward_risk_ratio,
    m.max_single_loss,
    round(r.recent_pnl_proxy, 2) as recent_30d_proxy
  FROM wallet_metrics m
  LEFT JOIN recent_performance r ON m.wallet = r.wallet
  ORDER BY m.omega DESC
  `;

  console.log("=== RISK METRICS FOR VERIFIED WALLETS ===\n");
  
  const result = await clickhouse.query({ query, format: "JSONEachRow" });
  const rows = await result.json() as any[];

  console.log("Wallet       | Fills | Win% | Omega | Avg Win | Avg Loss | R:R  | Max Loss | 30d Proxy");
  console.log("-------------|-------|------|-------|---------|----------|------|----------|----------");
  
  const walletNames: Record<string, string> = {
    "0xd04d631183d7568356f598a3c77181ec4ab6d0e5": "@kamlot",
    "0xb63ac06f20eed05d0a34f61116d0580a0afb4064": "@plzdontdropout",
    "0xf32a44b612a60f2b0c0f23c419876ec1c89c06fd": "@Dit26978",
    "0x5d91954919c7c729cc0dc4c82c62d336132f3578": "@YourFriendSteave",
    "0x184e98eb1d39dfb9e7750e860512a9adbcbecf96": "@Mr-Anderson",
    "0x3eba55f41f4064bc4b070d06a00fec7c2dd5849a": "@pwnatorul",
    "0x861307b57badefb591238c2148781e0728ee59f0": "@AMX13",
  };

  for (const r of rows) {
    const name = walletNames[r.wallet] || r.wallet.slice(0,10);
    console.log([
      name.padEnd(12),
      String(r.total_fills).padStart(5),
      String(r.win_rate + "%").padStart(5),
      String(r.omega || "∞").padStart(5),
      String(r.avg_win_bps).padStart(7),
      String(r.avg_loss_bps).padStart(8),
      String(r.reward_risk_ratio || "∞").padStart(4),
      String(r.max_single_loss).padStart(8),
      String(r.recent_30d_proxy || 0).padStart(9)
    ].join(" | "));
  }

  // Now calculate 30-day markout for comparison
  console.log("\n\n=== 30-DAY MARKOUT COMPARISON ===");
  console.log("(Price 30 days after entry vs 14 days)\n");

  const markout30Query = `
  WITH fills AS (
    SELECT
      f.wallet,
      f.token_id,
      f.trade_date,
      f.markout_bps as markout_14d,
      f.notional
    FROM markout_14d_fills f
    WHERE f.wallet IN (${walletList})
  ),
  price_30d AS (
    SELECT
      token_id,
      price_date,
      end_of_day_price
    FROM _daily_prices_ref
  ),
  fills_with_30d AS (
    SELECT
      f.*,
      p.end_of_day_price as price_30d
    FROM fills f
    LEFT JOIN price_30d p ON f.token_id = p.token_id 
      AND p.price_date = f.trade_date + 30
  )
  SELECT
    wallet,
    count() as fills_with_14d,
    countIf(price_30d > 0) as fills_with_30d,
    round(avg(markout_14d), 2) as avg_markout_14d,
    round(countIf(markout_14d > 0) * 100.0 / count(), 1) as win_rate_14d
  FROM fills_with_30d
  GROUP BY wallet
  ORDER BY avg_markout_14d DESC
  `;

  const result30 = await clickhouse.query({ query: markout30Query, format: "JSONEachRow" });
  const rows30 = await result30.json() as any[];

  console.log("Wallet       | 14d Fills | 30d Coverage | Avg 14d MO | Win% 14d");
  console.log("-------------|-----------|--------------|------------|----------");
  
  for (const r of rows30) {
    const name = walletNames[r.wallet] || r.wallet.slice(0,10);
    const coverage = Math.round(r.fills_with_30d * 100 / r.fills_with_14d);
    console.log([
      name.padEnd(12),
      String(r.fills_with_14d).padStart(9),
      String(coverage + "%").padStart(12),
      String(r.avg_markout_14d).padStart(10),
      String(r.win_rate_14d + "%").padStart(9)
    ].join(" | "));
  }
}

main().catch(console.error);
