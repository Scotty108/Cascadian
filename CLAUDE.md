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
**Current Status:** 85% complete | Core architecture solid | Final polish phase

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
| **ERC1155** | Ethereum token standard (Polymarket conditional tokens) |
| **Smart Money** | Wallets showing consistent profitable behavior |
| **ReplacingMergeTree** | ClickHouse table engine using idempotent updates (no UPDATE statements) |
| **Backfill** | Historical data import (1,048 days, 2-5 hours runtime with 8 workers) |
| **MCP** | Model Context Protocol (integration layer for Claude tools) |
| **PnL** | Profit & Loss (real-time dashboard metrics) |

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

## PnL Engine Context

When working on PnL calculations or wallet metrics, use this context:

**Current State (Jan 13, 2026):**
- **Production Engine:** `pnlEngineV1.ts` - Local calculation with 96.7% accuracy (360 wallets validated)
- **Validation Only:** `pnlEngineV7.ts` - API-based (NOT for production, only validation)
- **Entry Points:**
  - `getWalletPnLV1()` - Returns 3 metrics: realized, synthetic, unrealized
  - `getWalletPnLWithConfidence()` - Returns PnL + confidence level + diagnostics (recommended)

**Accuracy (Jan 13, 2026):**
| Engine | Test Coverage | Status |
|--------|---------------|--------|
| V1 (local) | 348/360 wallets | **96.7% PASS** |
| V1+ (NegRisk) | Auto-routed | For high NegRisk wallets |

**Known Limitations:**
- NegRisk adapter creates internal bookkeeping trades indistinguishable from real trades
- ~3% of wallets have unexplained phantom tokens (confidence system flags these as "low")
- Token mapping gaps for very new markets (auto-fixed by cron)

**Key Files:**
- `lib/pnl/pnlEngineV1.ts` - **PRODUCTION ENGINE** (local calculation)
- `lib/pnl/pnlEngineV7.ts` - Validation only (API-based, NOT for production)
- `docs/READ_ME_FIRST_PNL.md` - Full technical documentation

**Rules:**
- **⚠️ CRITICAL: Never use API fallback or pnlEngineV7 for anything other than validation. We must calculate everything locally from our database.**
- Use `getWalletPnLV1()` or `getWalletPnLWithConfidence()` for production PnL queries
- V7 (API-based) is ONLY for validation/comparison, not production use
- See `docs/READ_ME_FIRST_PNL.md` for root cause analysis and V9-V13 investigation details

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

- **Data coverage:** 388M+ USDC transfers, 1,048 days
- **Smart money wallets tracked:** 50+ validated profiles
- **Query performance:** Sub-3ms semantic search
- **Pipeline runtime:** 2-5 hours for full backfill (8-worker parallel)

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
- [ ] **Final P0 bugs** (2.5 hours) — Use "ultra think" for complex issues
- [ ] **Memory System Optimization** (4-6 hours)

### Short Term (Next 2 Weeks)
- [ ] **Skills Implementation** (8-12 hours)
  - Build Backfill-Runner skill
  - Build ClickHouse-Query-Builder

### Medium Term (Next Month)
- [ ] Build Strategy-Validator skill
- [ ] Performance optimization
- [ ] Additional market integrations

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