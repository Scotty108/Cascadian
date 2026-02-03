# CASCADIAN Project Reference Guide

> **⚠️ READ [RULES.md](./RULES.md) FIRST**
>
> Before working on this project:
> 1. Read [RULES.md](./RULES.md) for workflow patterns, agent roles, and guidelines
> 2. Then read this file (CLAUDE.md) for project-specific context
>
> **RULES.md** = How to work | **CLAUDE.md** = What you're working on

---

## Project Overview

CASCADIAN is a sophisticated blockchain-based trading and strategy platform focused on Polymarket data analysis, smart money tracking, and autonomous strategy execution. The system integrates real-time blockchain data, wallet analytics, and visual strategy building into a unified platform.

**Stack:** Next.js, React, TypeScript, ClickHouse, Supabase, Vercel
**Current Status:** 90% complete | Core systems operational | WIO stability fixes pending

### Vercel Deployment (IMPORTANT)

There are **two Vercel projects** - don't get confused:

| Project | GitHub Repo | Domain | Status |
|---------|-------------|--------|--------|
| `cascadian` | `Scotty108/Cascadian` | `cascadian.vercel.app` | **Production** |
| `cascadian-app` | `Scotty108/Cascadian-app` | (preview only) | Builds failing |

**To deploy locally:**
```bash
# Link to correct project first
npx vercel link --yes --project cascadian

# Then deploy
npx vercel --prod
```

**Note:** The local directory is `Cascadian-app` but deploys to the `cascadian` Vercel project.

---

## Quick Navigation

| Need | Location |
|------|----------|
| **Workflow patterns & guidelines** | [RULES.md](./RULES.md) ← Read this first |
| **PnL / Wallet Metrics** | [docs/READ_ME_FIRST_PNL.md](./docs/READ_ME_FIRST_PNL.md) ← Start here for PnL work |
| **Development guide** (time estimates, patterns) | [docs/operations/DEVELOPMENT_GUIDE.md](./docs/operations/DEVELOPMENT_GUIDE.md) |
| **MCP servers** (detailed setup) | [docs/operations/MCP_SERVERS.md](./docs/operations/MCP_SERVERS.md) |
| **Agent reference** (complete listing) | [docs/systems/AGENT_REFERENCE.md](./docs/systems/AGENT_REFERENCE.md) |
| **Database patterns** (stable pack) | [docs/systems/database/STABLE_PACK_REFERENCE.md](./docs/systems/database/STABLE_PACK_REFERENCE.md) |
| Database schema & queries | `lib/clickhouse/` |
| Trading strategies | `src/components/strategy-builder/` |
| Market data pipeline | `scripts/` (backfill scripts) |
| Frontend components | `src/components/` |
| API routes | `src/app/api/` |
| Configuration | `.env.local` (git-ignored) |
| System architecture | [docs/README.md](./docs/README.md) |

---

## Key Terminology

| Term | Definition |
|------|-----------|
| **CLOB** | Central Limit Order Book (Polymarket's order structure) |
| **FIFO** | First-In-First-Out position tracking - matches buys with sells chronologically to calculate ROI per trade (table: pm_trade_fifo_roi_v3) |
| **ERC1155** | Ethereum token standard (Polymarket conditional tokens) |
| **Smart Money** | Wallets showing consistent profitable behavior |
| **ReplacingMergeTree** | ClickHouse table engine using idempotent updates (no UPDATE statements) |
| **Backfill** | Historical data import (1,048 days, 2-5 hours runtime with 8 workers) |
| **MCP** | Model Context Protocol (integration layer for Claude tools) |
| **PnL** | Profit & Loss (real-time dashboard metrics) |
| **WIO** | Wallet Intelligent Ontology - alternative leaderboard/metrics system (wio_* tables) |
| **NegRisk** | Polymarket's adapter contract for negative-outcome markets (internal mechanism, excluded from PnL) |
| **CTF** | Conditional Token Framework - Polymarket's split/merge token system |

---

## System Architecture

### Core Subsystems

**1. Data Pipeline** (100% complete)
- Input: Polymarket CLOB fills + blockchain ERC1155 transfers
- Processing: 8-worker parallel backfill system
- Output: ClickHouse tables (388M+ USDC transfers indexed)
- **See:** [docs/systems/data-pipeline/](./docs/systems/data-pipeline/)

**2. Wallet Analytics** (100% complete)
- Smart money detection via metrics-based ranking
- Real-time updates tied to new trades
- **See:** [docs/features/leaderboard-metrics.md](./docs/features/leaderboard-metrics.md)

**3. Trading Strategies** (100% complete)
- Visual builder for strategy composition (React Flow)
- Copy trading, consensus, smart money, predefined rules
- **See:** [docs/features/](./docs/features/)

**4. Frontend Dashboard** (Phase 1 complete)
- React-based with node editor
- Real-time PnL visualization
- **See:** `src/components/`

**5. Memory System** (Active)
- claude-self-reflect: Semantic search across 350+ past conversations
- **See:** [RULES.md - Tool & MCP Integration](./RULES.md#tool--mcp-integration)

---

## Critical Files & Directories

```
/src
  /app
    /api              # API endpoints
    page.tsx          # Main dashboard
  /components         # React components
    /dashboard        # Layout and navigation
    /strategy-builder # Visual strategy composer

/lib
  /clickhouse         # Database client & operations
  /polymarket         # Polymarket-specific logic

/scripts              # Data processing, backfills

/docs                 # Documentation (organized by category)
  /systems           # Technical subsystems
  /operations        # Runbooks, deployment guides
  /features          # Feature documentation

/.claude              # Claude Code configuration
```

> **See:** [RULES.md - File Organization](./RULES.md#file-organization) for complete structure and rules

---

## ClickHouse MCP Server (Preferred for Queries)

**ALWAYS use the ClickHouse MCP server for database queries** - it's faster and cleaner than Bash + TypeScript.

### Available Tools
| Tool | Description |
|------|-------------|
| `mcp__clickhouse__query` | Execute SQL queries directly |
| `mcp__clickhouse__list_tables` | List all tables in database |
| `mcp__clickhouse__describe_table` | Get table schema |

### Usage Examples
```sql
-- Quick count
mcp__clickhouse__query: SELECT count() FROM pm_trader_events_v2 WHERE is_deleted = 0

-- Wallet lookup
mcp__clickhouse__query: SELECT sum(realized_pnl) FROM pm_wallet_condition_realized_v1 WHERE wallet = '0x...'

-- Table schema
mcp__clickhouse__describe_table: pm_trader_events_v2
```

### When to Use Each Method
| Method | Speed | Best For |
|--------|-------|----------|
| **ClickHouse MCP** | <1s | Quick queries, exploration, simple aggregations |
| Script file (`npx tsx`) | ~5s | Complex multi-step analysis, joins, loops |

### Setup (if MCP not available)
If `mcp__clickhouse__*` tools aren't available, run:
```bash
claude mcp add --transport stdio clickhouse \
  -e CLICKHOUSE_HOST=<host> \
  -e CLICKHOUSE_PORT=8443 \
  -e CLICKHOUSE_USER=default \
  -e CLICKHOUSE_PASSWORD=<password> \
  -e CLICKHOUSE_DATABASE=default \
  -e CLICKHOUSE_SECURE=true \
  -e CLICKHOUSE_MCP_QUERY_TIMEOUT=300 \
  -e CLICKHOUSE_SEND_RECEIVE_TIMEOUT=300 \
  -- uv run --with mcp-clickhouse --python 3.10 mcp-clickhouse
```
Then restart Claude Code. Verify with `claude mcp list`.

**Timeout:** Default is 30s. Set `CLICKHOUSE_MCP_QUERY_TIMEOUT=300` for 5-minute timeout on complex queries.

**Important:** `CLICKHOUSE_HOST` must be hostname only (no `https://`, no port). The MCP adds protocol/port automatically.
- ✅ Correct: `ja9egedrv0.us-central1.gcp.clickhouse.cloud`
- ❌ Wrong: `https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443`

---

## Database Quick Reference

### Critical Facts
- **ClickHouse arrays are 1-indexed:** Use `arrayElement(x, outcome_index + 1)`
- **condition_id is 32-byte hex:** Normalize as lowercase, strip 0x, expect 64 chars
- **Atomic rebuilds only:** `CREATE TABLE AS SELECT` then `RENAME` (never `ALTER UPDATE`)
- **pm_trader_events_v2 has duplicates:** ALWAYS dedupe with `GROUP BY event_id` pattern (see below)

### CLOB Deduplication Pattern (REQUIRED)
The `pm_trader_events_v2` table contains duplicate rows from historical backfills (2-3x per wallet).
**ALWAYS use this pattern** for accurate counts/sums:

```sql
SELECT ... FROM (
  SELECT
    event_id,
    any(side) as side,
    any(usdc_amount) / 1000000.0 as usdc,
    any(token_amount) / 1000000.0 as tokens,
    any(trade_time) as trade_time
  FROM pm_trader_events_v2
  WHERE trader_wallet = '0x...' AND is_deleted = 0
  GROUP BY event_id
) ...
```

**Why:** Table uses SharedMergeTree (not ReplacingMergeTree), sort key doesn't include event_id.
**Cost:** Fixing duplicates would require expensive full-table scan. Use GROUP BY instead.

### Investigation Protocol
1. **DESCRIBE + SAMPLE before dismissing any table**
2. **Check docs first:** [docs/systems/database/TABLE_RELATIONSHIPS.md](./docs/systems/database/TABLE_RELATIONSHIPS.md)
3. **Test ALL columns** that might contain target data

### Data Safety Rules
**🚨 CRITICAL:** Before ANY destructive operation (DROP, TRUNCATE, REPLACE):
- ✅ READ: [docs/operations/NEVER_DO_THIS_AGAIN.md](./docs/operations/NEVER_DO_THIS_AGAIN.md)
- ✅ Document current state, create backup, test on 100 items first
- ✅ Use atomic operations (CREATE NEW → RENAME)

> **See:** [docs/systems/database/STABLE_PACK_REFERENCE.md](./docs/systems/database/STABLE_PACK_REFERENCE.md) for complete database patterns and skill labels (IDN, NDR, PNL, AR, etc.)

---

## Database Tables Reference

### Production Tables (Actively Used)

#### Core Transaction Tables
| Table | Engine | Purpose | Row Count | Status |
|-------|--------|---------|-----------|--------|
| **pm_canonical_fills_v4** | MergeTree | Master canonical fill records (CLOB, CTF, NegRisk) | 1.19B | **PRIMARY** |
| **pm_trade_fifo_roi_v3** | SharedReplacingMergeTree | FIFO-calculated trades with PnL/ROI per position | 283M | **ACTIVE** |
| **pm_condition_resolutions** | MergeTree | Market resolution outcomes and payouts | 411k+ | **PRIMARY** |
| **pm_token_to_condition_map_v5** | MergeTree | Token ID to condition/outcome mapping | ~500k | Rebuilt hourly |
| **pm_trader_events_v3** | MergeTree | CLOB events (newer stream) | Active | In use |
| **pm_trader_events_dedup_v2_tbl** | MergeTree | Deduplicated view of v2 | Legacy | Reference only |

#### Cache/Aggregation Tables (Refreshed by Crons)
| Table | Engine | Refresh | Purpose |
|-------|--------|---------|---------|
| **pm_copy_trading_leaderboard** | ReplacingMergeTree | Every 3 hours | Top 20 robust traders (ROI without top 3 trades) |
| **pm_smart_money_cache** | ReplacingMergeTree | Daily 8am UTC | Top 100 by category (DIRECTIONAL/MIXED/SPREAD_ARB) |
| **whale_leaderboard** | MergeTree | Unknown | Top 50 by lifetime PnL (legacy) |
| **pm_wallet_position_fact_v1** | MergeTree | Every 10min+ | Current open positions |
| **pm_latest_mark_price_v1** | MergeTree | Every 15min | Mark prices for unrealized PnL |

#### Support Tables
| Table | Purpose |
|-------|---------|
| **pm_ctf_split_merge_expanded** | CTF token splits/merges |
| **vw_negrisk_conversions** | NegRisk adapter transfers (excluded from PnL) |
| **pm_price_snapshots_15m** | 15-min OHLC price data |
| **pm_ingest_watermarks_v1** | Cron progress tracking |
| **pm_sync_state_v1** | Data sync status monitoring |

#### WIO System Tables (Winners Index Omnibus)
| Table | Purpose | Known Issues |
|-------|---------|--------------|
| **wio_positions_v1** | Position tracking | Memory limit errors (Issue #11) |
| **wio_wallet_metrics_v1** | Wallet metrics | Missing composite_score (Issue #15) |
| **wio_wallet_scores_v1** | Wallet scoring | Active |
| **wio_dot_events_v1** | Dot event history | Active |

**Important Notes:**
- **NO `pm_trade_fifo_roi_v4` exists** - the current table is `pm_trade_fifo_roi_v3`
- **Always query `pm_trade_fifo_roi_v3`** for FIFO-based PnL, ROI, and trade metrics
- `pm_trader_events_v2` has duplicates - use GROUP BY event_id pattern (see Database Quick Reference section)

---

## Cron Jobs & Data Pipeline

### Data Flow Architecture
```
Raw Blockchain Data
  ↓
pm_trader_events_v3, pm_ctf_split_merge_expanded, vw_negrisk_conversions
  ↓
update-canonical-fills (*/10 min) → pm_canonical_fills_v4 (946M rows)
  ↓
rebuild-token-map (*/10 min) → pm_token_to_condition_map_v5
  ↓
refresh-fifo-trades (*/2 hours) → pm_trade_fifo_roi_v3 (78M rows)
  ↓
  ├→ refresh-copy-trading-leaderboard (*/3 hours) → pm_copy_trading_leaderboard
  ├→ refresh-smart-money (Daily 8am) → pm_smart_money_cache
  └→ leaderboard API routes (real-time queries)
```

### Cron Job Dependency Map

#### Layer 1: Data Ingestion (Every 10-15 minutes)
| Cron | Schedule | Reads From | Writes To | Timeout |
|------|----------|------------|-----------|---------|
| **update-canonical-fills** | */10 min | pm_trader_events_v3, pm_ctf_split_merge_expanded, vw_negrisk_conversions | pm_canonical_fills_v4 | 10 min |
| **rebuild-token-map** | */10 min | pm_canonical_fills_v4 | pm_token_to_condition_map_v5 | 10 min |
| **sync-metadata** | */10 min | External API | pm_token_to_condition_map_v5 | 10 min |
| **update-mark-prices** | */15 min | External API | pm_latest_mark_price_v1 | 10 min |
| **wallet-monitor** | */15 min | Various | Notifications DB | 10 min |

#### Layer 2: Aggregation (Every 2+ hours)
| Cron | Schedule | Reads From | Writes To | Purpose |
|------|----------|------------|-----------|---------|
| **refresh-fifo-trades** | */2 hours | pm_canonical_fills_v4, pm_condition_resolutions | pm_trade_fifo_roi_v3 | FIFO position calculation (LONG/SHORT) |
| **refresh-copy-trading-leaderboard** | */3 hours | pm_trade_fifo_roi_v3 | pm_copy_trading_leaderboard | Top 20 robust traders |
| **refresh-smart-money** | Daily 8am | pm_trade_fifo_roi_v3 | pm_smart_money_cache | Top 100 by category |

#### Layer 3: WIO System (Hourly/Daily)
| Cron | Schedule | Status | Known Issues |
|------|----------|--------|--------------|
| **sync-wio-positions** | Hourly | ⚠️ Failing | Memory limit exceeded (Issue #11) |
| **update-wio-resolutions** | Daily 5am | ⚠️ Failing | Schema mismatch (Issue #14) |
| **refresh-wio-metrics** | Daily 6am | ⚠️ Failing | Missing composite_score column (Issue #15) |
| **refresh-wio-scores** | Daily 7am | Active | - |

#### Layer 4: Maintenance (Daily 3-4am)
| Cron | Schedule | Purpose |
|------|----------|---------|
| **cleanup-duplicates** | Daily 3am | Deduplicate historical data |
| **fix-unmapped-tokens** | Daily 4am | Patch missing token mappings |
| **monitor-data-quality** | */10 min | Detect corruption, validate data integrity |

### Critical Cron Facts

**Vercel Timeout Limits:**
- Free tier: 10 seconds
- Pro tier: **10 minutes** (current plan)
- All crons configured with 10min max execution time

**Where Crons Break:**
1. **Memory limits:** ClickHouse Cloud has 10.80 GiB limit (Issues #11, #14, #15)
2. **Connection pool exhaustion:** Too many parallel queries
3. **Query complexity:** Window functions on large datasets
4. **Token mapping gaps:** New markets missing from map (auto-fixed by fix-unmapped-tokens cron)

**Cron File Locations:**
- Cron schedule: `/vercel.json` (all 35+ cron endpoints)
- Cron handlers: `/app/api/cron/**/route.ts`
- Standalone scripts: `/scripts/cron/` (if any)

---

## Leaderboard Architecture

### Three Active Leaderboard Types

#### 1. Copy Trading Leaderboard (Cached)
**API:** `/api/copy-trading/leaderboard`
**Cron:** `refresh-copy-trading-leaderboard` (every 3 hours)
**Table:** `pm_copy_trading_leaderboard` (cached top 20)
**Source Data:** `pm_trade_fifo_roi_v3`

**Algorithm:**
1. Query all trades from `pm_trade_fifo_roi_v3` (last 30 days, min $10 cost)
2. For each wallet, rank trades by ROI
3. Calculate: `sim_roi_without_top3 = avg(ROI for trades 4+)`
4. Filter: min 25 trades, win_rate > 40%, roi_without_top3 > 0
5. Return: Top 20 ranked by `sim_roi_without_top3`

**Why "without top 3"?** Filters out "lottery winners" who had 1-2 lucky trades but aren't consistently profitable.

**Cron Location:** `/app/api/cron/refresh-copy-trading-leaderboard/route.ts`

#### 2. Ultra-Active Leaderboard (Real-Time)
**API:** `/api/leaderboard/ultra-active`
**Cron:** None (computed on-demand)
**Source Data:** `pm_trade_fifo_roi_v3` (direct query)

**Filters:**
- Window: Last 3 days (default)
- min_win_rate: 70%
- min_median_roi: 30%
- min_trades: 30
- min_profit: $10k
- Active within window

**Performance:** 3-5 second query time (no caching)

#### 3. Whale Leaderboard (Legacy)
**API:** `/api/leaderboard/whale`
**Table:** `whale_leaderboard` (unknown refresh schedule)
**Metric:** Lifetime realized PnL
**Status:** Legacy - being phased out for WIO system

### Smart Money Cache (Not a Public Leaderboard)
**Cron:** `refresh-smart-money` (daily 8am UTC)
**Table:** `pm_smart_money_cache`
**Purpose:** Backend categorization for copy trading strategy builder

**Categories:**
- **TOP_PERFORMERS:** 20+ trades, $50k+ PnL, 45-85% win rate
- **COPY_WORTHY:** 20-500 trades, <15% shorts, 55%+ win rate, $10k+ PnL
- **SHORT_SPECIALISTS:** 20+ short trades, 50%+ short win rate, $10k+ PnL
- **DIRECTIONAL:** Bias toward one outcome
- **MIXED:** Balanced strategy
- **SPREAD_ARB:** Arbitrage focused

**Cron Location:** `/app/api/cron/refresh-smart-money/route.ts`

---

## PnL Engine Context

When working on PnL calculations or wallet metrics, use this context:

**Current State (Jan 27, 2026):**
- **Production Engine:** `pnlEngineV1.ts` - Local calculation with 96.7% accuracy (360 wallets validated)
- **Smart Router:** `getWalletPnLWithConfidence()` - **RECOMMENDED** - Automatically switches between V1/V1+ based on wallet characteristics
- **Validation Only:** `pnlEngineV7.ts` - API-based (NOT for production, only validation)

**Entry Points:**
- **`getWalletPnLWithConfidence()`** - **Smart engine (RECOMMENDED)**
  - Auto-routes between V1 and V1+ based on wallet characteristics
  - Returns: PnL (realized, synthetic, unrealized) + confidence level (high/medium/low) + diagnostics
  - Automatically handles NegRisk-heavy wallets and phantom token detection
- `getWalletPnLV1()` - Direct V1 calculation
  - Returns 3 metrics: realized, synthetic, unrealized
  - Use if you need raw V1 calculation without smart routing or confidence scoring

**The V1 Formula (Core Algorithm):**
```
PnL = CLOB_cash + Long_wins - Short_losses

Where:
  CLOB_cash = Σ(sell_usdc) - Σ(buy_usdc)  [self-fill deduplicated]
  Long_wins = Σ(net_tokens) where net_tokens > 0 AND outcome won [$1 per token]
  Short_losses = Σ(|net_tokens|) where net_tokens < 0 AND outcome won [$1 liability]
```

**Critical Implementation Details:**
1. **Self-fill deduplication:** Exclude MAKER side when wallet is both maker AND taker
2. **CTF tokens:** Included in net_tokens (shares_delta)
3. **CTF cash:** EXCLUDED - splits are economically neutral
4. **NegRisk handling:**
   - ⚠️ **CRITICAL:** V1 EXCLUDES `source='negrisk'` fills from pm_canonical_fills_v4
   - NegRisk adapter transfers are internal mechanism, not user purchases
   - `vw_negrisk_conversions` is NOT used for cost calculation
5. **Data sources:**
   - `pm_canonical_fills_v4` (CLOB fills WHERE source != 'negrisk')
   - `pm_token_to_condition_map_v5` (token to outcome mapping)
   - `pm_ctf_split_merge_expanded` (CTF operations)
   - `pm_condition_resolutions` (resolution payouts)
   - `pm_latest_mark_price_v1` (unrealized MTM)

**Accuracy (Jan 13, 2026):**
| Engine | Test Coverage | Pass Rate | Notes |
|--------|---------------|-----------|-------|
| V1 (local) | 348/360 wallets | **96.7%** | Production |
| V1+ (NegRisk) | Same as V1 | **96.7%** | Now identical to V1 (NegRisk cost subtraction removed) |
| V22 (Subgraph) | 15 wallets | 93.3% (14/15) | Alternative validation |

**Known Limitations:**
- NegRisk adapter creates internal bookkeeping trades indistinguishable from real trades
- ~3% of wallets have unexplained phantom tokens (confidence system flags these as "low")
- Token mapping gaps for very new markets (auto-fixed by fix-unmapped-tokens cron)

**Key Files:**
- `lib/pnl/pnlEngineV1.ts` - **PRODUCTION ENGINE** (local calculation)
- `lib/pnl/pnlEngineV7.ts` - Validation only (API-based, NOT for production)
- `docs/READ_ME_FIRST_PNL.md` - Full technical documentation

**Rules:**
- **⚠️ CRITICAL: Never use API fallback or pnlEngineV7 for anything other than validation. We must calculate everything locally from our database.**
- **⚠️ CRITICAL: V1 excludes source='negrisk' - this is essential for accurate PnL**
- **✅ RECOMMENDED: Use `getWalletPnLWithConfidence()` for all production PnL queries** - it's the smart engine that auto-routes to V1/V1+ based on wallet characteristics
- Alternative: `getWalletPnLV1()` for direct V1 calculation (if you need raw V1 without smart routing)
- V7 (API-based) is ONLY for validation/comparison, not production use
- V1+ is now identical to V1 (previously had incorrect NegRisk cost subtraction)
- See `docs/READ_ME_FIRST_PNL.md` for root cause analysis and V9-V13 investigation details

---

## Known Issues & Maintenance

### Active Issues (Jan 27, 2026)

#### Cron Issues
| ID | Issue | Impact | Affected Crons | Priority | Status |
|----|-------|--------|----------------|----------|--------|
| #11 | Memory limit exceeded (10.80 GiB) | Cron failures | sync-wio-positions, refresh-wio-metrics, cleanup-duplicates | HIGH | Pending |
| #14 | Schema mismatch in update-wio-resolutions | Cron failures | update-wio-resolutions | MEDIUM | Pending |
| #15 | Missing composite_score column | Cron failures | refresh-wio-metrics | MEDIUM | Pending |

#### API Issues (Discovered Jan 27, 2026)
| ID | Issue | Impact | Affected Endpoints | Priority | Status |
|----|-------|--------|-------------------|----------|--------|
| #17 | pm_trader_events_v2 missing deduplication | Trade counts 2-3x inflated | /api/wio/wallet/[address] | HIGH | Pending |
| #18 | Using outdated v3 table | Missing Jan 2026 recovery data | /api/wallets/[address]/orphans | HIGH | Pending |
| #19 | Non-existent 'trades_raw' table | Endpoint completely broken | /api/wallets/[address]/category-breakdown | CRITICAL | Pending |
| #20 | Non-existent 'trades_raw' table | Category data missing | /api/wallets/specialists | MEDIUM | Pending |

**Working Correctly:**
- ✅ `/api/wallets/[address]/duel` - Uses pm_canonical_fills_v4
- ✅ `/api/leaderboard/ultra-active` - Uses pm_trade_fifo_roi_v3 (78M positions)
- ✅ `/api/leaderboard/duel` - Correct tables

### Recently Resolved

**Jan 16-28 Data Corruption (RESOLVED Jan 27, 2026):**
- **Cause:** LEFT JOIN in `update-canonical-fills` allowed empty condition_ids
- **Impact:** 55.5M corrupted fills inserted, 96M rows needed correction
- **Fix:** Changed to INNER JOIN + validation
- **Recovery:** FIFO recovery completed (77.9M positions, 96.8% coverage)
- **Status:** ✅ Complete

### Maintenance Schedule

| Task | Frequency | Last Run | Purpose |
|------|-----------|----------|---------|
| Rebuild token map | Every 10 min | Continuous | Map new token IDs to conditions |
| Fix unmapped tokens | Daily 4am | Automatic | Patch missing mappings |
| Cleanup duplicates | Daily 3am | ⚠️ Failing | Deduplicate historical data |
| Monitor data quality | Every 10 min | Active | Detect corruption early

---

## Memory & Knowledge Systems

### Three-Tier Architecture

**Tier 1: Instant Reference** (This File)
- Quick lookup: terminology, architecture, file locations
- Best for: "Where do I find X?"

**Tier 2: Semantic Search** (claude-self-reflect)
- Full conversation history with AI-powered narratives
- Sub-3ms search, 90-day decay weighting
- Best for: "How did we solve X?"
- **See:** [RULES.md - claude-self-reflect](./RULES.md#tool--mcp-integration)

**Tier 3: Specialized Documentation** (`/docs/`)
- Domain-specific deep dives
- Best for: Understanding specific subsystems

### When to Use Each Tier

| Question | Use |
|----------|-----|
| "What does CLOB mean?" | This file (instant lookup) |
| "How did we fix zero-ID trades?" | claude-self-reflect (semantic search) |
| "Tell me about ERC1155 decoding" | Specialized docs (`/docs/systems/`) |
| "How do we add new features?" | [Development Guide](./docs/operations/DEVELOPMENT_GUIDE.md) |

> **Best Practice:** Always search claude-self-reflect BEFORE using Explore agent (5 sec vs 5-10 min, 90% fewer tokens)

---

## Key Metrics

**Data Scale (Feb 3, 2026):**
- **Canonical fills:** 1.19B rows (pm_canonical_fills_v4)
- **FIFO positions:** 283M positions (pm_trade_fifo_roi_v3)
- **Condition resolutions:** 411k+ (pm_condition_resolutions)
- **Total volume tracked:** $871M+ in January 2026 alone
- **Unique wallets:** 693k+ active wallets
- **Markets/Conditions:** 72k+ unique conditions
- **Historical coverage:** 1,048+ days

**System Performance:**
- **Query performance:** Sub-3ms semantic search (claude-self-reflect)
- **Cron refresh rate:** Every 10 min (canonical fills), every 2 hours (FIFO)
- **Pipeline runtime:** 2-5 hours for full backfill (8-worker parallel)
- **PnL accuracy:** 96.7% validated (360 wallets)

**Smart Money Tracking:**
- **Copy-worthy traders:** Top 20 cached (refresh every 3 hours)
- **Smart money categories:** 5 categories, refreshed daily
- **Leaderboard types:** 3 active (Ultra-active, Copy Trading, Whale)

---

## External References

- **Polymarket API:** https://docs.polymarket.com/
- **ClickHouse Docs:** https://clickhouse.com/docs/
- **Next.js App Router:** https://nextjs.org/docs/app
- **Claude Code:** https://claude.com/claude-code
- **claude-self-reflect:** https://github.com/ramakay/claude-self-reflect

---

## Next Steps / In Progress

### Immediate (This Week)
- [x] **Jan 2026 FIFO Recovery** — Completed Feb 3, 2026 (283M positions, deduped, tables in parity)
- [x] **Documentation Audit** — CLAUDE.md updated with current state (Feb 3, 2026)
- [ ] **Fix Broken Wallet APIs** (#17-20) — 4 endpoints with critical issues, HIGH priority
  - #17: WIO trade count deduplication (inflated 2-3x)
  - #18: Orphans endpoint using v3 (missing Jan 2026 data)
  - #19: Category-breakdown broken (non-existent table)
  - #20: Specialists API broken queries
- [ ] **Fix WIO Cron Memory Issues** (#11, #14, #15) — 3 failing crons, HIGH priority

### Short Term (Next 2 Weeks)
- [ ] **Cron Stability** (Issues #11, #14, #15)
  - Fix sync-wio-positions memory limit
  - Fix update-wio-resolutions schema mismatch
  - Fix refresh-wio-metrics missing column
- [ ] **Skills Implementation** (8-12 hours)
  - Build Backfill-Runner skill
  - Build ClickHouse-Query-Builder skill

### Medium Term (Next Month)
- [ ] Build Strategy-Validator skill
- [ ] Performance optimization for ultra-active leaderboard
- [ ] Additional market integrations
- [ ] WIO system completion

> **See:** [docs/ROADMAP.md](./docs/ROADMAP.md) for complete roadmap

---

## Additional Documentation

### Essential Guides
- **[RULES.md](./RULES.md)** - Workflow patterns, agent usage, core principles
- **[Development Guide](./docs/operations/DEVELOPMENT_GUIDE.md)** - Time estimates, workflows, best practices
- **[MCP Servers](./docs/operations/MCP_SERVERS.md)** - Detailed MCP setup and usage
- **[Agent Reference](./docs/systems/AGENT_REFERENCE.md)** - Complete agent listing (30+ agents)

### System Documentation
- **[Database Stable Pack](./docs/systems/database/STABLE_PACK_REFERENCE.md)** - Database patterns and skill labels
- **[Table Relationships](./docs/systems/database/TABLE_RELATIONSHIPS.md)** - Schema reference
- **[Polymarket Integration](./docs/systems/polymarket/)** - Polymarket-specific logic

### Operations
- **[NEVER DO THIS AGAIN](./docs/operations/NEVER_DO_THIS_AGAIN.md)** - Data safety rules
- **[API Query Guide](./docs/operations/API_QUERY_GUIDE.md)** - API endpoints and patterns

---

**Remember:** This file is for **project-specific context**. For workflow patterns, agent usage, MCP servers, and development guidelines, see **[RULES.md](./RULES.md)**.