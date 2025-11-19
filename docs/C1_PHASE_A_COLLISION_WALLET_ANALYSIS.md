# Phase A: Top Collision Wallets Analysis

**Date:** 2025-11-16 (PST)
**Agent:** C1 (Database Agent)
**Status:** ✅ COMPLETE

---

## Executive Summary

Identified top 100 collision-heavy wallets representing **$10.4B in trading volume**.

**Key Finding:** The #1 wallet (`0x4bfb...982e` with $5.8B volume) is the **XCN executor wallet already successfully mapped** to account wallet `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b`.

---

## Top 10 Collision Wallets

| Rank | Wallet | Volume (USD) | Trades | Collision % | Status |
|------|--------|-------------|--------|-------------|--------|
| 1 | `0x4bfb...982e` | $5,803,541,020 | 31,431,458 | 99.34% | ✅ **MAPPED (XCN)** |
| 2 | `0xf29b...dd4c` | $307,806,467 | 39,798 | 99.10% | ⏳ Unmapped |
| 3 | `0xed88...f3c4` | $192,009,141 | 28,100 | 87.38% | ⏳ Unmapped |
| 4 | `0x5375...aeea` | $115,527,408 | 294,716 | 96.76% | ⏳ Unmapped |
| 5 | `0xee00...cea1` | $110,633,604 | 54,586 | 99.15% | ⏳ Unmapped |
| 6 | `0x7fb7...e33d` | $104,325,753 | 30,260 | 100.00% | ⏳ Unmapped |
| 7 | `0x3151...0977` | $90,448,055 | 36,864 | 96.51% | ⏳ Unmapped |
| 8 | `0x9d84...1344` | $86,879,953 | 190,666 | 99.66% | ⏳ Unmapped |
| 9 | `0xa6a8...5009` | $79,996,735 | 133,657 | 99.56% | ⏳ Unmapped |
| 10 | `0xfb1c...963e` | $79,127,656 | 424,945 | 99.05% | ⏳ Unmapped |

---

## Volume Impact Analysis

**Total Top 100 Stats:**
- Total Volume: $10,407,264,800
- Total Trades: 46,483,698
- Average Collision Rate: 94.8%

**XCN Wallet (Already Mapped):**
- Volume: $5,803,541,020 (~56% of top 100)
- Trades: 31,431,458 (~68% of top 100)
- Status: ✅ Operational (validated with Xi market)

**Remaining 99 Wallets:**
- Volume: $4,603,723,780 (~44% of top 100)
- Trades: 15,052,240 (~32% of top 100)
- Status: Unmapped (requires discovery)

---

## Discovery Strategy for Remaining Wallets

### Option 1: Transaction Hash Overlap Analysis (XCN Methodology)
For each wallet, find executor→account pairs via:
1. Query `pm_trades_canonical_v3` for collision tx_hashes
2. Identify wallet pairs appearing in same transactions
3. Calculate overlap rate (expect >95% for true proxies)
4. Validate with sample trades

**Example Query:**
```sql
-- Find potential account wallet for executor wallet X
WITH executor_txs AS (
  SELECT DISTINCT transaction_hash
  FROM pm_trades_canonical_v3
  WHERE lower(wallet_address) = 'executor_wallet_x'
)
SELECT
  lower(wallet_address) AS potential_account,
  count(DISTINCT transaction_hash) AS shared_tx,
  (SELECT count(DISTINCT transaction_hash) FROM executor_txs) AS total_executor_tx,
  shared_tx / total_executor_tx AS overlap_rate
FROM pm_trades_canonical_v3
WHERE transaction_hash IN (SELECT transaction_hash FROM executor_txs)
  AND lower(wallet_address) != 'executor_wallet_x'
GROUP BY wallet_address
HAVING overlap_rate > 0.95
ORDER BY overlap_rate DESC
LIMIT 5;
```

### Option 2: ERC20 Flow Analysis
Look for USDC transfer patterns between wallets:
1. Query `erc20_transfers_decoded` for large USDC flows
2. Identify wallet clusters with high bidirectional flow
3. Validate via transaction hash overlap

**Example Query:**
```sql
-- Find wallets with high USDC flow to/from executor
SELECT
  CASE
    WHEN lower(from_address) = 'executor_wallet' THEN lower(to_address)
    WHEN lower(to_address) = 'executor_wallet' THEN lower(from_address)
    ELSE NULL
  END AS partner_wallet,
  count(*) AS transfer_count,
  sum(amount_usdc) AS total_volume_usdc
FROM erc20_transfers_decoded
WHERE (lower(from_address) = 'executor_wallet' OR lower(to_address) = 'executor_wallet')
  AND amount_usdc > 0
GROUP BY partner_wallet
HAVING transfer_count > 10
ORDER BY total_volume_usdc DESC
LIMIT 10;
```

### Option 3: Existing `wallet_identity_map` Table
Check if any mappings already exist:
- Query `wallet_identity_map` for `proxy_wallet` matches
- Filter where `proxy_wallet != user_eoa` (true proxy relationships)
- Use existing mappings where available

**Note:** Initial query hit schema mismatch (no `source` column), suggesting table may have limited coverage.

---

## Proposed Next Steps

### Phase B: Validate Top 10 Wallets (Excluding XCN)

**Priority 1: `0xf29b...dd4c` ($308M volume)**
1. Run transaction hash overlap analysis
2. Identify potential account wallet
3. Validate with >95% overlap threshold
4. If validated, add to `wallet_identity_overrides`

**Priority 2-10: Wallets #3-10**
- Repeat methodology for each wallet
- Target cumulative volume coverage >80% of top 100
- Add validated mappings incrementally

### Phase C: Monitor Coverage

After each mapping addition:
1. Query collision count for mapped wallet (expect 0)
2. Recalculate volume coverage
3. Update canonical view metrics

---

## Files Created

1. `scripts/identify-top-collision-wallets.ts` - Discovery script
2. `collision-wallets-top100.json` - Full wallet list with metadata
3. `docs/C1_PHASE_A_COLLISION_WALLET_ANALYSIS.md` - This report

---

## Ready for Next Phase

**Status:** ✅ Phase A complete, ready to proceed with Phase B (wallet validation)

**Recommendation:**
- Start with Priority 1 wallet (`0xf29b...dd4c`) - $308M volume impact
- Use transaction hash overlap methodology (proven with XCN)
- Add validated mappings to `wallet_identity_overrides` incrementally
- Target 80% volume coverage across top 100 wallets

---

**Signed:** C1 (Database Agent)
**Date:** 2025-11-16 (PST)
