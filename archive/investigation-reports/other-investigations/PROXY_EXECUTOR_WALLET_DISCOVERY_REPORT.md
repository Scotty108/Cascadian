# Proxy/Executor Wallet Relationship Analysis Report

**Date:** 2025-11-16 (PST)
**Thoroughness Level:** Medium
**Terminal:** Claude - Explore Agent

---

## Executive Summary

Based on comprehensive codebase analysis, **one confirmed executor→account wallet pair has been identified and documented:** the XCN (xcnstrategy) wallet relationship. The search for additional proxy/executor patterns revealed that:

1. **Proxy/executor architecture exists across Polymarket** - All trading involves Safe/Gnosis Smart Contract wallets
2. **Current system only maps one relationship** - XCN wallet mapping is the only documented case
3. **High-volume wallets are likely executors** - Top 50+ wallets by trade count may have unmapped relationships
4. **Existing infrastructure supports discovery** - Multiple tables (`wallet_identity_map`, `pm_user_proxy_wallets_v2`, `clob_fills`) contain the necessary columns

---

## Part 1: Confirmed Proxy/Executor Pair - XCN (xcnstrategy)

### Known Relationship

| Aspect | Value |
|--------|-------|
| **Account Wallet (EOA)** | `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b` |
| **Executor Wallet (On-Chain Proxy)** | `0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e` |
| **Mapping Type** | `proxy_to_eoa` |
| **Discovery Source** | Manual validation + Polymarket API |
| **Confidence Level** | 1.00 (100% - fully verified) |
| **Status** | ✅ Mapped & Documented |

### Evidence & Documentation

**File:** `/Users/scotty/Projects/Cascadian-app/docs/C1_WALLET_CANONICALIZATION_DIRECTIVE.md`

**Key Finding from Directive:**
> Polymarket API reports positions at the ACCOUNT wallet (0xcce2...), but ClickHouse stores trades at the EXECUTOR wallet (0x4bfb...). The executor→account translator is missing from our data model.

**Cross-Referenced In:**
- `PM_WALLET_IDENTITY_DESIGN.md` - Detailed schema design for wallet clustering
- `PROXY_MAPPING_SPEC_C1.md` - Current proxy mapping specification
- `docs/WALLET_CANONICALIZATION_ROLLOUT.md` - Migration guide for all downstream systems
- `TRACK_B_COMPLETION_SUMMARY.md` - Wallet identity validation work
- `PNL_V2_VALIDATION_REPORT.md` - Validation against Polymarket UI

### XCN Wallet Characteristics

**Account Wallet (0xcce2b7...):**
- User-facing identity (UI/API level)
- Where Polymarket positions are displayed
- EOA (Externally Owned Account) - true user wallet

**Executor Wallet (0x4bfb41...):**
- On-chain trading proxy
- Executes all actual CLOB trades
- Holds positions & settlement rights
- High volume: **31,908,871 trades** (top wallet in entire database!)

**Trade Volume Discrepancy:**
- Executor wallet: 194 fills recorded in ClickHouse `clob_fills` table
- Expected at account level via Polymarket API: Hundreds of additional trades
- Reason: Proxy wallet address used in CLOB executions, not account wallet

---

## Part 2: Wallet Architecture & Proxy Patterns

### How Polymarket Wallets Work

**Documented In:** `PM_WALLET_IDENTITY_DESIGN.md`, `WALLET_IDENTITY_NOTES.md`

**Standard Architecture:**
```
User (EOA)
    ↓
Safe Contract (Proxy/Executor Wallet)
    ↓
Trading on CLOB
    ↓
Settlement & Position Settlement
```

**Key Points:**
- Polymarket uses Safe/Gnosis Safe smart contract wallets
- Users sign transactions via their EOA (private key holder)
- Trades execute via the proxy wallet (on-chain contract)
- Positions and settlements routed through proxy address
- Polymarket API may report under either EOA or proxy (inconsistently)

### Expected Patterns for Executor Wallets

Based on documented XCN relationship and wallet analysis, executor wallets should exhibit:

1. **Very High Trade Volume** (10K+ trades minimum)
2. **Multiple Markets** (50+ unique condition_ids)
3. **Consistent Daily Activity** (bot-like trading patterns)
4. **Small to Medium Fill Sizes** (typical retail/semi-pro patterns)
5. **Long Activity Timeline** (weeks to years of continuous trading)
6. **Possible "System Wallet" Scoring** (high fills-per-market ratio)

---

## Part 3: Discovered Naming Patterns & Conventions

### Polymarket Wallet Identity Columns

**In `clob_fills` table:**
- `proxy_wallet` (String) - The executor/trader wallet
- `user_eoa` (String) - The owner/account wallet

**In `pm_trades` view:**
- `wallet_address` - Uses `proxy_wallet` value
- `operator_address` - Uses `user_eoa` value
- `is_proxy_trade` (UInt8) - Flag: 1 if proxy differs from EOA, 0 if same

**In mapping tables:**
- `wallet_identity_map.proxy_wallet` - Executor address
- `wallet_identity_map.canonical_wallet` - Account/canonical address
- `pm_user_proxy_wallets_v2.proxy_wallet` and `.user_eoa` - API-discovered mappings

### Naming Convention Indicators

**Files explicitly mentioning proxy patterns:**
- `PM_WALLET_IDENTITY_DESIGN.md` - Uses term "proxy_wallet" for executor
- `PROXY_MAPPING_SPEC_C1.md` - Uses term "executor_wallet" for on-chain address
- `scripts/task3-identify-proxy-wallet.ts` - Script specifically designed to identify proxy relationships via API
- `scripts/build-proxy-table.ts` - Infrastructure for building proxy mappings
- `lib/polymarket/resolver.ts` - Contains `resolveProxyViaAPI()` function

**Convention Summary:**
- No special naming patterns in wallet addresses themselves (all standard 0x... hex format)
- Relationship discovery happens via data analysis, not address patterns
- Multiple terms used interchangeably: proxy/executor/operator/Safe wallet

---

## Part 4: High-Volume Wallet Analysis

### Top Wallets by Trade Count

**From Script 51 & C3 Audit:**

| Rank | Wallet Address | Fills | Markets | EOA-Proxy Pairs | Status |
|------|----------------|-------|---------|-----------------|--------|
| 1 | `0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e` | 31,908,871 | N/A | ❌ SYSTEM WALLET | Executor wallet for XCN |
| 2-50 | Various | 1M-8M+ | N/A | ⚠️ UNKNOWN | Likely include other executors |

### System Wallet Score Analysis

**Script 52 Results:**
- **Total analyzed:** Top 1,000 wallets by fill count
- **System wallets detected:** 39 wallets (3.9% rate)
- **System wallet thresholds:**
  - High fills per market (>100) → Market maker pattern
  - Very high volume (>500K fills) → Institutional pattern
  - High fills per day (>1000) → Bot pattern

**Critical Finding:**
- Both Track A test wallets are flagged as system wallets
- `0x4bfb41d5b3...` - Score 8 (explains extreme volume)
- `0xc5d563a36a...` - Score 5 (also high-volume)

**Implication:** The highest-volume wallets may be executor wallets with different account/canonical identities.

---

## Part 5: Candidate Executor Wallets for Mapping

### Priority 1: Known/Confirmed

| Executor Wallet | Account Wallet | Status | Confidence |
|-----------------|----------------|--------|-----------|
| `0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e` | `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b` | ✅ Mapped | 1.00 |

### Priority 2: Likely Candidates (System Wallets >500K trades)

**High confidence candidates for investigation:**

1. **Top Volume Wallets** (>5M trades)
   - Likely institutional/bot traders using proxies
   - May each have 1-10 associated account wallets
   - **Need:** Transaction hash clustering analysis

2. **High Fills-Per-Market Pattern** (>100 fills/market)
   - Market makers or aggregators
   - Typically use proxies for custody/settlement
   - **Need:** Safe wallet deployment event analysis

3. **Consistent Daily Activity** (800+ fills/day for >30 days)
   - Automated trading systems
   - Likely to be executor wallets with proxy architecture
   - **Need:** Manual verification via Polymarket API

### Priority 3: Regular High-Volume Traders (10K-500K trades)

**Selected for Track B Validation:**

1. `0x8a6276085b676a02098d83c199683e8a964168e1` - 468 fills, 85 markets
2. `0x1e5d5cb25815fedfd1d17d05c9877b9668bd0fbc` - 176 fills, 10 markets
3. `0x880b0cb887fc56aa48a8e276d9d9a18d0eb67844` - 302 fills, 129 markets

**Status:** Not yet analyzed for proxy relationships (regular user wallets)

---

## Part 6: Infrastructure for Discovery

### Existing Discovery Mechanisms

**1. API-Based Discovery** (`scripts/task3-identify-proxy-wallet.ts`)
- Calls Polymarket API: `/positions?user={wallet}`
- Extracts `proxyWallet` field from response
- Verifies mapping via on-chain overlap analysis
- **Status:** ✅ Implemented

**2. Table-Based Mapping**
- `pm_user_proxy_wallets_v2` table (6 rows currently)
- `wallet_identity_map` table (735,637 rows)
- **Status:** ✅ Tables exist, sparse data

**3. Heuristic Detection** (`scripts/build-proxy-table.ts`, `lib/polymarket/resolver.ts`)
- Can infer proxy relationships from:
  - Frequent transaction hash overlap
  - Safe wallet deployment events (requires blockchain data)
  - High correlation in trade timing/patterns
- **Status:** 🔄 Partially implemented

### Discovery Methods (Documented Approaches)

**Method 1: Transaction Hash Clustering**
- Find wallet pairs sharing many `tx_hash` values
- High correlation = likely proxy relationship
- **Data Required:** `clob_fills.tx_hash` + `clob_fills.proxy_wallet`
- **Implementation:** SQL window function analysis

**Method 2: Polymarket API Verification**
- Query `/positions?user={wallet}` for each high-volume wallet
- Extract `proxyWallet` field
- Validate against ClickHouse data
- **Data Required:** API access, wallet list
- **Rate Limit:** Must throttle requests (~1-2 per second)

**Method 3: Safe Wallet On-Chain Events**
- Identify Safe deployments from blockchain data
- Match owner EOA to deployed Safe contract
- Build canonical mapping
- **Data Required:** ERC20 transfer events, Safe factory events
- **Status:** Requires blockchain analysis (not currently implemented)

**Method 4: Manual Analysis**
- For known traders/strategies, query Polymarket API directly
- Document relationships in `wallet_identity_map`
- Validate against ClickHouse patterns
- **Status:** Done for XCN, can repeat for other targets

---

## Part 7: Naming Conventions & Aliases

### Current Column Naming

**Primary Terminology:**
- **`proxy_wallet`** - On-chain executor address (what appears in CLOB)
- **`user_eoa`** - Account owner address (what Polymarket API shows)
- **`canonical_wallet`** - Canonical identity for aggregation (usually = user_eoa)
- **`wallet_address`** - Trade attribution wallet (copied from proxy_wallet)
- **`operator_address`** - Original user EOA (copied from user_eoa)

**No aliases in schema** - All wallet addresses are distinct columns, no "alias" field

**Canonical Resolution:**
```sql
-- To find all addresses for a wallet identity:
SELECT
  canonical_wallet,
  proxy_wallet,
  user_eoa
FROM wallet_identity_map
WHERE canonical_wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
```

---

## Part 8: Prioritized List for wallet_identity_map Seeding

### Immediate Actions (High Confidence)

**Already Completed:**
```json
{
  "executor_wallet": "0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e",
  "canonical_wallet": "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b",
  "mapping_type": "proxy_to_eoa",
  "source": "manual_validation",
  "confidence_score": 1.00
}
```

### Recommended Next Steps (Phase 1)

**For Top 10 High-Volume Wallets:**
1. Query Polymarket API `/positions?user={wallet}` for each
2. Extract `proxyWallet` field
3. Cross-reference with ClickHouse `clob_fills` data
4. Verify with transaction hash overlap analysis
5. Insert confirmed mappings into `wallet_identity_map`

**Estimated Effort:**
- API queries: 10 wallets × 2 sec = 20 seconds
- Data analysis: ~1 hour per wallet (10 total = 10 hours with parallelization)
- Documentation: ~2 hours

### Candidate Wallets for Investigation

**Batch 1 (System Wallets >5M trades):**
- Focus on wallets with score >5 from script 52
- Likely to have complex proxy relationships
- High impact on PnL calculations

**Batch 2 (Market Makers >100 fills/market):**
- Wallets with market-making pattern
- May operate multiple executor wallets
- Require multi-key Safe analysis

**Batch 3 (Bots >1000 fills/day):**
- High-frequency trading systems
- Likely to have dedicated executor wallets
- Easier 1:1 mapping

---

## Part 9: Search Methodology & Caveats

### Search Approach Used

1. **Codebase Analysis**
   - Searched for files mentioning `proxy`, `executor`, `wallet`, `identity`, `operator`
   - Found 130+ relevant files with wallet/proxy documentation
   - Read key design documents and specifications

2. **Pattern Detection**
   - Analyzed wallet columns in database schema (discovered via scripts)
   - Found `clob_fills.proxy_wallet` and `clob_fills.user_eoa` pattern
   - Identified `wallet_identity_map` as canonical source

3. **Documentation Review**
   - Read wallet canonicalization directive (main agent to C1)
   - Analyzed Track B completion summary (wallet identity work)
   - Reviewed wallet identity design proposal

4. **Script Analysis**
   - Examined proxy mapping discovery script (task3)
   - Reviewed wallet identity map builder (script 51)
   - Analyzed system wallet detector (script 52)

### Limitations

**Not Covered (Beyond Medium Thoroughness):**
- Did not run actual SQL queries against ClickHouse (read-only exploration)
- Did not execute scripts to scan for transaction hash clusters
- Did not call Polymarket API to verify relationships in real-time
- Did not analyze blockchain events (Safe deployments, transfers)

**Known Unknowns:**
- Exact count of executor→account pairs currently missing from system
- Volume of trades attributed to unmapped executor wallets
- Whether all high-volume wallets actually use proxy architecture
- True P&L impact of missing mappings for top 100 wallets

---

## Deliverables

### 1. List of Potential Executor→Account Pairs

**Confirmed:**
- `0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e` → `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b` (XCN)

**Candidate Groups for Investigation:**
1. **System wallets (score >5)** - 2-3 wallets expected
2. **Top 50 high-volume wallets** - 10-20 likely have proxy relationships
3. **Market-maker pattern wallets** - 5-10 wallets
4. **Bot-pattern wallets (>1000 fills/day)** - 3-5 wallets

**Total Expected:** 20-40 additional executor→account pairs discoverable with medium effort

### 2. Naming Conventions

**In Database Schema:**
- `proxy_wallet` = executor/trader wallet (on-chain)
- `user_eoa` = account/canonical wallet (user-facing)
- `canonical_wallet` = canonical identity (for P&L aggregation)
- `is_proxy_trade` = flag (1 if proxy ≠ user, 0 if same)

**In Mapping Table:**
- `wallet_identity_map.proxy_wallet` → `wallet_identity_map.canonical_wallet`
- Supports 1:1 and 1:N relationships
- Includes `mapping_type`, `source`, `confidence_score` for audit trail

**No Name-Based Patterns:** Executor wallets use standard hex addresses, no special naming

### 3. wallet_identity_map Seeding Strategy

**Phase 1 (Immediate):**
- Verify XCN mapping already inserted
- Select top 10 high-volume wallets
- Query Polymarket API for each
- Seed confirmed mappings

**Phase 2 (Short-term):**
- Transaction hash clustering analysis
- Safe wallet event analysis
- Confidence score assignment
- Bulk insert into `wallet_identity_map`

**Phase 3 (Medium-term):**
- Heuristic pattern matching
- ML-based proxy relationship detection
- Incremental updates as new wallets appear

---

## Implementation Notes

### Immediate Next Actions

Based on C1 agent directive, implement in this order:

1. ✅ **Script 104:** Wire `canonical_wallet_address` into `pm_trades` view
2. ✅ **Script 105:** Propagate canonical wallets into P&L views
3. ⏳ **Script 106:** Compare xcnstrategy P&L with canonical mapping
4. ⏳ **Script 107:** Discover other executor→account mappings via API

### Resource Requirements

**For Full Discovery (Phase 1):**
- Time: 8-12 worker hours
- Cost: Polymarket API calls (free tier, rate limits 1-2 req/sec)
- Workers: 1 person + 8 background tasks (parallel API queries)
- Crash/stall protection: Required for batch API operations
- Checkpoint saving: After each batch of 100 wallets analyzed

---

## Files Referenced in This Analysis

**Key Documentation:**
- `/Users/scotty/Projects/Cascadian-app/docs/C1_WALLET_CANONICALIZATION_DIRECTIVE.md`
- `/Users/scotty/Projects/Cascadian-app/PM_WALLET_IDENTITY_DESIGN.md`
- `/Users/scotty/Projects/Cascadian-app/PROXY_MAPPING_SPEC_C1.md`
- `/Users/scotty/Projects/Cascadian-app/PROXY_MAPPING_DISCOVERY_REPORT.md`
- `/Users/scotty/Projects/Cascadian-app/docs/WALLET_CANONICALIZATION_ROLLOUT.md`
- `/Users/scotty/Projects/Cascadian-app/WALLET_IDENTITY_NOTES.md`

**Scripts & Code:**
- `/Users/scotty/Projects/Cascadian-app/scripts/task3-identify-proxy-wallet.ts`
- `/Users/scotty/Projects/Cascadian-app/51-build-wallet-identity-map.ts`
- `/Users/scotty/Projects/Cascadian-app/52-find-system-wallets.ts`
- `/Users/scotty/Projects/Cascadian-app/lib/polymarket/resolver.ts`

---

**Analysis Completed**
**Terminal:** Claude - Explore Agent
**Session Date:** 2025-11-16 (PST)
**Status:** Ready for implementation
