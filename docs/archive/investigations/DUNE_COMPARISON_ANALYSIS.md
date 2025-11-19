# Dune Analytics Schema Comparison - Strategic Analysis

**Date:** 2025-11-08
**Context:** Evaluating our Polymarket database against Dune's production schema
**Goal:** Determine if we need additional API pulls or structural changes

---

## Executive Summary

**Current Status:** Our Option B backfill strategy is **SUFFICIENT** for the stated goal of 100% P&L calculation by category.

**Gaps Identified:** Dune has richer metadata (block-level, maker/taker, user proxies, price history) that would enhance analytics but **are not blocking** for core P&L functionality.

**Recommendation:** Complete current backfill, validate P&L, then add Dune-level features in phases.

---

## Critical Analysis: What We Have vs What Dune Has

### 1. Markets & Metadata

**Dune Schema:**
```yaml
polymarket_polygon_markets:
  - market_id, question_id (unique key)
  - question, question_description
  - reward, reward_token
  - block_time, block_number
  - source, evt_index, tx_hash
```

**Our Schema:**
```sql
gamma_markets:
  - market_id, condition_id
  - question
  - outcomes (Array), category, tags
  - volume, liquidity
  - closed, outcome (winning outcome)
```

**Gap Analysis:**
- ✅ **We have:** Question text, outcomes, category, tags, volume, resolution status
- ❌ **We lack:** reward_token, block-level metadata, question_id as separate field
- 🟡 **Impact:** LOW - reward tokens and block metadata are metadata enrichments, not required for P&L

**Action:** Create a curated `markets_dim` view consolidating gamma_markets + API backfill data.

---

### 2. Outcomes & Conditions

**Dune Schema:**
```yaml
polymarket_polygon_market_outcomes:
  - question_id, outcome (unique)

polymarket_polygon_base_market_conditions:
  - condition_id, condition_token, oracle
  - outcome_slot_count, keyword

polymarket_polygon_base_ctf_tokens:
  - condition_id, token0, token1
```

**Our Schema:**
```sql
vw_token_to_market:
  - token_cid_hex, market_cid_hex (derived)

condition_market_map:
  - condition_id, market_id, event_id
  - canonical_category, raw_tags

ctf_token_map:
  - token_id, condition_id_norm, outcome, outcome_index
```

**Gap Analysis:**
- ✅ **We have:** Token→Market mapping, outcome names, outcome indices
- ❌ **We lack:** Oracle addresses, outcome_slot_count, token0/token1 pairs, keywords
- 🟡 **Impact:** MEDIUM - oracle info is useful for resolution verification, slot counts help categorize market types

**Action:** Consider adding oracle + slot_count to condition_market_map if available from CTF contract.

---

### 3. Trades & Capital Actions

**Dune Schema:**
```yaml
polymarket_polygon_market_trades:
  - block_time, block_number, tx_hash, evt_index (unique)
  - maker, taker, fee
  - action (clob/AMM), contract_address
  - neg_risk (boolean)
  - price, shares, amount
  - token_outcome, question, polymarket_link
```

**Our Schema:**
```sql
vw_trades_canonical:
  - wallet_address, condition_id_norm, market_id
  - timestamp, side, outcome_index
  - shares, usd_value
  - transaction_hash
  - canonical_category, question, outcomes
```

**Gap Analysis:**
- ✅ **We have:** Wallet, timestamp, shares, usd_value, tx_hash, category, question
- ❌ **We lack:** block_number, block_time, evt_index, maker/taker, fee, contract_address
- 🔴 **Impact:** HIGH for data quality, LOW for P&L calculation

**Critical Assessment:**

**For P&L Calculation:**
- ✅ Have: shares, cost basis (usd_value), direction (side), tx_hash
- ✅ Don't need: block numbers, maker/taker roles, fees (don't affect realized P&L)

**For Data Quality:**
- ⚠️ Missing: block_number/time makes timestamp accuracy questionable
- ⚠️ Missing: evt_index prevents proper deduplication in edge cases
- ⚠️ Missing: maker/taker obscures trade attribution

**Action:**
- **Phase 1 (current):** Use what we have - sufficient for P&L
- **Phase 2:** Backfill block metadata from blockchain event logs
- **Phase 3:** Add maker/taker from CLOB API or CTF Exchange logs

---

### 4. Positions & Prices

**Dune Schema:**
```yaml
polymarket_polygon_positions_raw:
  - month, day, address, token_id (unique)
  - balance

polymarket_polygon_positions:
  - day, address, token_id (unique)
  - balance, question, active, closed

polymarket_polygon_market_prices_daily:
  - day, token_id (unique)
  - condition_id, price

polymarket_polygon_market_prices_hourly:
  - hour, token_id (unique)
  - condition_id, price
```

**Our Schema:**
```sql
outcome_positions_v2:
  - wallet_address, condition_id_norm, outcome_index
  - total_shares (at resolution only)

-- NO price history tables
-- NO daily position snapshots
```

**Gap Analysis:**
- ✅ **We have:** Current positions at resolution time
- ❌ **We lack:** Daily/hourly position snapshots, price history
- 🟡 **Impact:** MEDIUM - price history enables Sharpe/Omega ratios, historical analysis

**For Unrealized P&L:**
- 🔴 **Blocker:** Need current market prices (not historical)
- 🟡 **Nice-to-have:** Historical prices for volatility calculations

**Action:**
- **Phase 1:** Add current_price table from Gamma API (real-time prices)
- **Phase 2:** Build daily price history aggregated from trades
- **Phase 3:** Add daily position snapshots for time-series analysis

---

### 5. Users & Wallets

**Dune Schema:**
```yaml
polymarket_polygon_users:
  - polymarket_wallet (unique)
  - owner (EOA), wallet_type (safe/magic)
  - created_time, first_funded_time
  - first_funded_by, has_been_funded

polymarket_polygon_users_safe_proxies:
  - proxy (unique), owner, block_time

polymarket_polygon_users_magic_wallet_proxies:
  - proxy (unique), owner, block_time

polymarket_polygon_users_capital_actions:
  - block_time, action, from_address, to_address
  - symbol, amount, amount_usd
```

**Our Schema:**
```sql
-- NO users table
-- NO proxy mapping
-- NO capital actions table

erc20_transfers:
  - from_addr, to_addr, amount
  - (raw USDC transfers, not curated)
```

**Gap Analysis:**
- ✅ **We have:** Raw USDC transfer data
- ❌ **We lack:** EOA→proxy mapping, wallet types, funding history
- 🟡 **Impact:** MEDIUM - important for user analytics, not critical for P&L

**For Wallet Attribution:**
- Current: We treat proxy addresses as "the wallet"
- Better: Map proxy → EOA so we know which user controls it
- Best: Track Safe vs Magic wallets for UX insights

**Action:**
- **Phase 1:** Use wallet addresses as-is (sufficient for P&L)
- **Phase 2:** Build users_dim from Safe/Magic factory events
- **Phase 3:** Add capital_actions view aggregating erc20_transfers

---

## What We're Currently Backfilling (Option B)

**Source:** Gamma API `/markets?condition_id=`

**Data Retrieved:**
```javascript
{
  condition_id: string,
  question: string,
  outcomes: string[],
  outcome: string,        // winning outcome
  closed: boolean,
  category: string,
  tags: string[],
  end_date_iso: string
}
```

**Storage:** `cascadian_clean.resolutions_src_api`

**Coverage:** Targeting 95-100% of traded markets (~200K markets)

---

## Gap Analysis: What's Missing from Our Backfill?

### Critical Gaps (Would Need Different Data Sources):

1. **Block-level metadata** (block_number, block_time, evt_index)
   - **Source:** Blockchain event logs, not Gamma API
   - **Effort:** High (requires blockchain indexing)
   - **Value:** Medium (improves data quality, not required for P&L)

2. **Maker/taker info** (maker, taker addresses)
   - **Source:** CLOB API or CTF Exchange logs
   - **Effort:** Medium (CLOB API available)
   - **Value:** Low for P&L, High for market-making analysis

3. **Fee data** (fee amounts, fee_rate_bps)
   - **Source:** CLOB API or CTF Exchange logs
   - **Effort:** Medium
   - **Value:** Low (fees don't affect P&L calculation, already paid)

4. **Oracle addresses** (who resolves the market)
   - **Source:** CTF contract on-chain or specialized endpoint
   - **Effort:** Medium (contract read)
   - **Value:** Low (informational only)

5. **Neg-risk market IDs** (grouping of related markets)
   - **Source:** Polymarket API (possibly in Gamma response)
   - **Effort:** Low (check if already in Gamma data)
   - **Value:** Medium (helps group related markets)

6. **Token0/token1 pairs** (CTF token addresses)
   - **Source:** CTF contract on-chain
   - **Effort:** Medium
   - **Value:** Low (we already have condition_id which is sufficient)

7. **Safe/Magic wallet mappings** (proxy → EOA)
   - **Source:** Safe/Magic factory contract events
   - **Effort:** High (blockchain indexing)
   - **Value:** Medium (better user attribution)

8. **Reward tokens** (what token is used for rewards)
   - **Source:** Market creation events on-chain
   - **Effort:** Medium
   - **Value:** Low (informational)

### Nice-to-Have (Derivable from Existing Data):

9. **Daily/hourly prices**
   - **Source:** Aggregate from our trades or Gamma price API
   - **Effort:** Low (compute from vw_trades_canonical)
   - **Value:** High (enables volatility, Sharpe ratios)

10. **Position snapshots**
    - **Source:** Aggregate from our trades + transfers
    - **Effort:** Medium (time-series computation)
    - **Value:** Medium (historical position tracking)

11. **Capital actions**
    - **Source:** Already have in erc20_transfers
    - **Effort:** Low (create view)
    - **Value:** Medium (deposit/withdrawal tracking)

---

## Reality Check: Do We Need All This?

### User's Stated Goal:

> "We will be able to take the VW trades canonical table as our entire universe of trade data... we will be able to backfill the entire entire 100% P&L by category..."

### Requirements Breakdown:

**For 100% P&L Calculation:**
- ✅ Complete trade history → **HAVE** (vw_trades_canonical, 159M trades)
- ✅ Resolution data (winning outcomes) → **GETTING** (Option B backfill)
- ✅ Cost basis per trade → **HAVE** (usd_value column)
- ✅ Shares per trade → **HAVE** (shares column)
- ✅ Payout vectors → **GETTING** (resolutions_src_api)

**For Category Breakdown:**
- ✅ Market categories → **GETTING** (category column in Gamma API)
- ✅ Market tags → **GETTING** (tags array in Gamma API)
- ✅ Condition → Market mapping → **HAVE** (vw_token_to_market)

**For Wallet Analytics:**
- ✅ Wallet addresses → **HAVE** (wallet_address column)
- 🟡 Proxy mapping → **MISSING** (not critical for P&L)

### What We DON'T Need for Core Goal:

- ❌ Block numbers/times (nice for data quality, not required)
- ❌ Maker/taker roles (market microstructure, not P&L)
- ❌ Fees (already paid, don't affect P&L calculation)
- ❌ Oracle addresses (informational)
- ❌ Reward tokens (not relevant to P&L)
- ❌ Safe/Magic proxies (better attribution, not blocking)

---

## Strategic Recommendation: Phased Approach

### Phase 1: Complete Current Backfill ✅ (Current Focus)

**Goal:** 100% P&L by category
**Timeline:** In progress (~1:15 AM completion)
**Data Sources:** Gamma API only

**Deliverables:**
1. ✅ `resolutions_src_api` populated with ~200K markets
2. ✅ `vw_resolutions_unified` rebuilt with API data
3. ✅ 95-100% resolution coverage achieved
4. ✅ Category/tag mapping complete

**Validation:**
- P&L calculation works end-to-end
- Category breakdown queries execute correctly
- Coverage ≥95% on traded markets

---

### Phase 2: Data Quality Enhancements 🟡 (Post-Launch)

**Goal:** Match Dune's data fidelity
**Timeline:** 1-2 weeks
**Data Sources:** Blockchain + CLOB API

**Deliverables:**

1. **Block-level enrichment** (3-4 days)
   - Add block_number, block_time, evt_index to trades
   - Source: Re-index blockchain event logs
   - Impact: Better deduplication, accurate timestamps

2. **Price history** (2-3 days)
   - Create daily/hourly price tables
   - Source: Aggregate from vw_trades_canonical + Gamma price API
   - Impact: Enables Sharpe ratio, volatility calculations

3. **Current prices** (1 day)
   - Add current_price table for unrealized P&L
   - Source: Gamma price API real-time endpoint
   - Impact: Unlocks unrealized P&L calculation

4. **Neg-risk flags** (1 day)
   - Add neg_risk column to markets
   - Source: Check if in Gamma API response, otherwise derive
   - Impact: Better market categorization

---

### Phase 3: Advanced Analytics 🟡 (Optional)

**Goal:** Full Dune feature parity
**Timeline:** 2-3 weeks
**Data Sources:** Blockchain + advanced APIs

**Deliverables:**

1. **User wallet mapping** (4-5 days)
   - Build users_dim with EOA→proxy mapping
   - Source: Safe/Magic factory contract events
   - Impact: Better user attribution, funding analysis

2. **Maker/taker enrichment** (3-4 days)
   - Add maker/taker to trades
   - Source: CLOB API historical data
   - Impact: Market-making analysis, liquidity insights

3. **Position snapshots** (3-4 days)
   - Create daily position history
   - Source: Compute from trades + transfers
   - Impact: Time-series position tracking

4. **Capital actions** (2 days)
   - Curate capital_actions view
   - Source: erc20_transfers (already have)
   - Impact: Deposit/withdrawal analytics

5. **Oracle & CTF metadata** (2-3 days)
   - Add oracle, token pairs, slot counts
   - Source: CTF contract reads
   - Impact: Resolution verification, market type classification

---

## Immediate Action Items

### ✅ Continue Current Backfill (No Changes)

The Option B backfill strategy is **correct and sufficient** for the stated goal. We're getting everything needed:
- Market resolutions (winning outcomes)
- Categories and tags
- Market questions and metadata

### 🟡 Post-Backfill: Validate P&L

After backfill completes (~1:15 AM):
1. Run `npx tsx create-unified-resolutions-view.ts`
2. Verify coverage ≥95%
3. Test P&L calculation on reference wallets
4. Validate category breakdowns

### 🟡 Document Enhancement Roadmap

Create `PHASE_2_ENHANCEMENTS.md` listing:
- Block-level enrichment plan
- Price history implementation
- User mapping strategy
- Prioritization: by business value vs effort

---

## Questions to Clarify with User

### Priority Question:

**"Is 100% P&L by category sufficient for launch, or do you need Dune-level completeness (block metadata, maker/taker, user proxies, price history) from day one?"**

If answer is:
- **"Just P&L"** → Stay the course, launch after current backfill validates
- **"Full Dune parity"** → Execute Phase 2 before launch (adds 1-2 weeks)

### Follow-up Questions:

1. **"Do you need unrealized P&L (current positions)?"**
   - If yes: Add current_price table (1 day effort)
   - If no: Can defer to Phase 2

2. **"Do you need historical performance metrics (Sharpe ratio, volatility)?"**
   - If yes: Add daily price history (2-3 days)
   - If no: Can defer to Phase 2

3. **"Do you need user attribution (EOA→proxy mapping)?"**
   - If yes: Add users_dim (4-5 days)
   - If no: Can defer to Phase 3

---

## Comparison Table: Us vs Dune

| Feature | Dune | Us (Current) | Us (Phase 2) | Us (Phase 3) | Priority |
|---------|------|--------------|--------------|--------------|----------|
| **Trade History** | ✅ Full | ✅ Full | ✅ | ✅ | P0 |
| **Resolutions** | ✅ Full | 🟡 In progress | ✅ | ✅ | P0 |
| **Categories/Tags** | ✅ Full | 🟡 In progress | ✅ | ✅ | P0 |
| **Block Metadata** | ✅ Full | ❌ Missing | ✅ Added | ✅ | P1 |
| **Maker/Taker** | ✅ Full | ❌ Missing | ❌ | ✅ Added | P2 |
| **Fees** | ✅ Full | ❌ Missing | ❌ | ✅ Added | P2 |
| **Current Prices** | ✅ Full | ❌ Missing | ✅ Added | ✅ | P1 |
| **Price History** | ✅ Daily/Hourly | ❌ Missing | ✅ Added | ✅ | P1 |
| **User Mapping** | ✅ Full | ❌ Missing | ❌ | ✅ Added | P2 |
| **Position Snapshots** | ✅ Daily | ❌ Missing | ❌ | ✅ Added | P2 |
| **Oracle Info** | ✅ Full | ❌ Missing | ❌ | ✅ Added | P3 |
| **Neg-risk Flags** | ✅ Full | ❌ Missing | ✅ Added | ✅ | P2 |
| **Capital Actions** | ✅ Full | 🟡 Raw data | ✅ Curated | ✅ | P2 |

**Legend:**
- P0: Blocking for P&L calculation
- P1: Important for data quality
- P2: Valuable for advanced analytics
- P3: Nice-to-have metadata

---

## Conclusion

### Our Current Strategy is Sound ✅

The Option B backfill (Gamma API for resolutions + categories) is **sufficient** for the stated goal of "100% P&L by category." We don't need to change course.

### Dune Has More, But We Don't Need It All 🎯

Dune's schema is comprehensive because they're building a **public analytics platform**. We're building a **trading analytics system**. Different use cases = different requirements.

### Phased Approach is Best 📈

1. **Phase 1 (now):** Complete backfill → validate P&L → launch
2. **Phase 2 (post-launch):** Add block metadata, price history, current prices
3. **Phase 3 (optional):** Add user mapping, maker/taker, advanced features

### Critical Missing Pieces for Future

If we want to match Dune eventually, we'll need:
- **Blockchain indexing:** For block metadata, events, user proxies
- **CLOB API integration:** For maker/taker, fees, order details
- **Price feed:** For current prices + historical series
- **Position tracking:** For daily snapshots

But none of these are **blocking** for "100% P&L by category."

---

**Recommendation:** Stay the course. Complete the current backfill, validate P&L works, then decide if Phase 2/3 enhancements are worth the effort based on actual usage.
