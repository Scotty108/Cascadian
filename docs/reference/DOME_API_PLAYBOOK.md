# Dome API Integration Playbook

**Updated:** 2025-11-11  
**Owner:** Data Infra / PnL squad

---

## Why Dome
- Provides **realized** PnL that only books gains after confirmed sells or redeems, matching the policy we are adopting to unblock wallet-level accuracy. citeturn0view0
- Ships historical Polymarket orderbooks (Oct 14 2025 onward) and trade history over simple REST endpoints, so we can bridge coverage gaps while the official Polymarket CLOB API remains gated. citeturn1view0turn2view0
- Free tier works for research/testing; upgrading to the $49/mo “dev” tier raises rate limits by 100× and unlocks premium support (per vendor message on 2025‑11‑11).

---

## Auth & Environment
- **Base URL:** `https://api.domeapi.io/v1`
- **Header:** `Authorization: Bearer ${DOME_API_KEY}`
- **Env vars (already in `.env.local`):**
  - `DOME_API_BASE_URL=https://api.domeapi.io/v1`
  - `DOME_API_KEY=<provided key>`
- Keep keys out of version control; rotate via Dome dashboard if leaked.

---

## Core Endpoints

### Wallet Profit-and-Loss
| Item | Value |
| --- | --- |
| Path | `GET /polymarket/wallet/pnl/{wallet_address}` |
| Purpose | Fetch realized PnL curve for a wallet |
| Required query | `granularity` (`day`, `week`, `month`, `year`, `all`) |
| Optional query | `start_time`, `end_time` (Unix **seconds**) |
| Response | `pnl_over_time[]` array with `timestamp`, `pnl_to_date` |
| Notes | Matches Dome policy: no unrealized PnL; redeems finalize gains. Validate our Stage‑2 PnL output wallet-by-wallet before enabling public leaderboards. citeturn0view0 |

### Trade History
| Item | Value |
| --- | --- |
| Path | `GET /polymarket/orders` |
| Filters | `market_slug`, `condition_id`, `token_id`, `user`, `start_time`, `end_time`, `limit (<=1000)`, `offset` |
| Response | `orders[]` with `side`, `shares`, `price`, `timestamp`, `user`, `tx_hash`, plus pagination block |
| Use Cases | Bootstrap `staging.clob_fills_v2`, reconcile fills for benchmark wallets, or seed ClickHouse while official API credentials are pending. citeturn2view0 |

### Orderbook History
| Item | Value |
| --- | --- |
| Path | `GET /polymarket/orderbooks` |
| Required query | `token_id`, `start_time`, `end_time` (Unix **milliseconds**) |
| Optional | `limit` (≤200), `pagination_key` |
| Response | `snapshots[]` with `bids`, `asks`, `minOrderSize`, `negRisk`, `tickSize`, `assetId`, `timestamp`, `market`, plus pagination metadata |
| History window | Records available from **2025-10-14** onward |
| Use Cases | Recreate implied midprices for Omega scoring, feed liquidity analytics, verify price ladders for whales. citeturn1view0 |

---

## Rate Limits & Throughput
- Free tier: suitable for ad‑hoc validation (hundreds of requests/day). Avoid parallel batchers to prevent 429s.
- Dev tier ($49/mo): “100× rate limits + websockets + premium support.” Upgrade before running 24/7 polling or multi-wallet backfills.
- Implement client-side exponential backoff on HTTP 429/503 and log `Retry-After` headers.

---

## Integration Plan
1. **Adapter module** (`lib/dome.ts` planned):
   - `fetchWalletPnl(wallet, granularity, start, end)` → normalized array.
   - `fetchTradeHistory(filters, paginationKey?)` → stream into ClickHouse staging.
   - `fetchOrderbooks(tokenId, window)` → yield snapshot batches (respect `limit=200`).
2. **Validation workflow:**
   - For each benchmark wallet (HolyMoses7, niggemon, etc.), cache Dome’s `pnl_over_time` daily.
   - Compare to `vw_wallet_pnl_closed` output; flag drift > $5 or 0.5%.
3. **Ingestion targets:**
   - `staging.clob_fills_v2`: use trade history response to backfill `side`, `price`, `shares_normalized`, `tx_hash`, `timestamp`, `user`.
   - `staging.orderbooks_dome_v1`: flattened snapshots keyed by `assetId`, `timestamp`, `bid_idx`, `ask_idx`.
4. **Scheduler:** start with manual scripts (`scripts/dome-pnl-benchmark.ts`, `scripts/dome-trades-poller.ts`) before promoting to Phase‑2 pipelines.

---

## Tracking & Next Steps
- [ ] Wire `DOME_API_KEY` into `lib/env.ts` helper.
- [ ] Create `scripts/dome-wallet-pnl-check.ts` (CLI) for nightly validation.
- [ ] Document comparison methodology in `PNL_SYSTEM_FINAL_STATUS.md`.
- [ ] Revisit upgrade to dev tier once nightly jobs exceed free quota.

