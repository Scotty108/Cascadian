# Dune vs Substreams: Detailed Technical Comparison for Polymarket P&L

---

## Overview

Both Dune Analytics and Substreams can provide Polymarket P&L data, but serve different use cases:

- **Dune:** Best for ad-hoc analysis, dashboards, historical backfill
- **Substreams:** Best for real-time streaming, custom transformations, event-driven pipelines

This document provides a side-by-side comparison to help you choose the right approach.

---

## 1. DATA PIPELINE ARCHITECTURE

### Dune Analytics Flow

```
Polygon RPC
    ↓
Dune Indexers (dbt + SQL)
    ↓
ClickHouse Data Warehouse
    ↓
SQL Interface / GraphQL
    ↓
CSV Export or API
```

**Key:** Centralized warehouse with batch updates.

### Substreams Flow

```
Polygon RPC
    ↓
Substreams Runtime (Rust/Wasm)
    ↓
Output Modules (map_user_positions, map_pnl_data)
    ↓
Compute / Kafka / Your Database
    ↓
Event-Driven Streaming
```

**Key:** Decentralized, event-driven, can self-host or use commercial services.

---

## 2. FEATURE COMPARISON

### P&L Calculation

#### Dune
- **Realized PnL:** Available via custom SQL joins
  - Join trades to market resolution events
  - Calculate: settlement_payout - cost_basis
- **Unrealized PnL:** Possible but rarely shown
- **Scope:** Most public dashboards show REALIZED ONLY
- **Formula Standardization:** NONE - each dashboard implements differently

#### Substreams
- **Realized PnL:** Built-in via map_pnl_data module
  - Tracks CTF Framework redemptions
  - Monitors payout vector application
- **Unrealized PnL:** Built-in (current holdings at latest prices)
- **Scope:** Package provides both automatically
- **Formula Standardization:** v0.3.1 package defines canonical logic
- **Advantage:** Less reinvention needed

### Data Freshness

#### Dune
```
Update Cadence: Batch (5-10 min lag)
Real-time?: NO
Indexing: Centralized (Dune controls)
Block Confirmation: After finality
Backfill?: YES (full history)
```

**Use case:** Historical analysis, dashboards that tolerate 10-min lag

#### Substreams
```
Update Cadence: Event-driven (1-3 min lag)
Real-time?: YES (near real-time)
Indexing: Self-hosted or commercial
Block Confirmation: Block-based (configurable)
Backfill?: YES (can replay entire chain history)
```

**Use case:** Real-time dashboards, streaming ETL, event-driven alerts

### Historical Scope

| Aspect | Dune | Substreams |
|--------|------|-----------|
| **Earliest data** | Full Polymarket history (since ~2023) | Full Polygon history (since 2021) |
| **Backfill time for 1,048 days** | ~30 minutes (export) | ~2-4 hours (replay) |
| **Complete coverage** | YES | YES |

---

## 3. OPERATIONAL COMPLEXITY

### Dune

**Setup:**
- Create account (5 min)
- Write SQL query (15 min)
- Click export (2 min)
- Total: 22 minutes for first export

**Ongoing:**
- No maintenance needed
- Dune updates tables automatically
- Monitor via dashboard views

**Maintenance effort:** LOW

### Substreams

**Setup:**
- Clone polymarket-pnl repo (5 min)
- Configure Wasm modules (30 min)
- Deploy to Substreams Hub or self-host (1-2 hours)
- Configure output sink (Postgres/Kafka/HTTP) (1 hour)
- Total: 3-4 hours initial setup

**Ongoing:**
- Monitor indexing progress
- Handle chain reorganizations
- Update modules if Polymarket contracts change
- Manage sink infrastructure

**Maintenance effort:** MEDIUM-HIGH

---

## 4. DATA QUALITY & ACCURACY

### Dune

**Validation:**
- Used by Polymarket Analytics dashboard (appears trustworthy)
- No published audit against official UI
- Community consensus: reasonably accurate for basics

**Known gaps:**
- P&L formula varies by analyst/dashboard
- Fee handling inconsistent
- Unrealized P&L rarely implemented correctly

**Accuracy confidence:** MEDIUM (70%)
- Good for closed positions + resolved markets
- Questionable for complex multi-leg positions

### Substreams

**Validation:**
- polymarket-pnl v0.3.1 maintained by PaulieB14
- Monitors CTF events directly (closer to source of truth)
- No published audit either

**Known gaps:**
- ABI issues reported in 2024 (now fixed in v0.3.1)
- Less battle-tested than Dune

**Accuracy confidence:** MEDIUM (70%)
- Same risk as Dune: formula correctness
- Advantage: More transparent transformation logic

---

## 5. COST & PRICING

### Dune

| Plan | Cost | Features |
|------|------|----------|
| **Free** | $0 | Unlimited queries, CSV export, public dashboards |
| **Pro** | $1,200/year | Priority compute, private dashboards |
| **Premium** | $6,000+/year | DataShare pipelines, enterprise features |

**For your use case:** FREE tier sufficient (no cost for backfill + ad-hoc queries)

### Substreams

| Approach | Cost |
|----------|------|
| **Self-hosted** | $0 (use open-source + your server) |
| **Substreams Hub (commercial)** | ~$0.50 per query / ~$500/month |
| **Goldsky (powered by Substreams)** | $500-5000/month |

**For your use case:** FREE (self-host) or very low cost

---

## 6. CUSTOMIZATION & EXTENSIBILITY

### Dune

**What you can customize:**
- SQL queries (full control over joins, aggregations)
- Dashboards (visualizations)
- Alerts (custom rules)

**What you can't customize:**
- Table schemas (set by dbt models)
- Indexing logic (Dune's responsibility)
- Update frequency

**Flexibility: MEDIUM**

### Substreams

**What you can customize:**
- Rust/Wasm module logic (complete control)
- Output sinks (Postgres, Kafka, S3, etc.)
- Update frequency (block-by-block)
- Data transformations

**What you can't customize:**
- Blockchain RPC access (must use external)
- Polygon protocol (immutable)

**Flexibility: HIGH**

---

## 7. INTEGRATION WITH YOUR CASCADIAN SYSTEM

### Scenario: Backfill then Transition

```
Timeline        Component           Approach
─────────────────────────────────────────────────
Week 1-2        Historical P&L      Dune CSV export
Week 2-3        Live trades         CLOB API
Week 3-4        Settlement events   Blockchain monitor
Week 4+         Real-time PnL       Substreams (optional)
                                    or custom indexer
```

### Recommended Path: Hybrid

**Phase 1: Dune backfill (3-5 hours)**
```
dune.com
  ↓ write SQL
  ↓ export CSV
your_clob_client.py
  ↓ transform
ClickHouse
```

**Phase 2: CLOB API (days 3-7)**
```
Polymarket CLOB REST API
  ↓ ingest trades
  ↓ every 5 min
ClickHouse (incrementally)
```

**Phase 3: Substreams (optional, week 2+)**
```
Polygon RPC → Substreams polymarket-pnl
  ↓ map_user_positions
  ↓ map_pnl_data
Your Postgres/Kafka
  ↓ deduplicate vs CLOB API
ClickHouse (real-time)
```

---

## 8. HIDDEN GOTCHAS

### Dune Gotchas

1. **P&L formula not documented**
   - You'll see different numbers in different dashboards
   - Solution: Validate sample trades against polymarket.com

2. **No multi-leg PnL tracking**
   - Markets with >2 outcomes need special handling
   - Solution: Implement own logic for complex markets

3. **Fee handling inconsistent**
   - Some dashboards include fees, some don't
   - Solution: Parse CTF Exchange events directly

4. **Resolved vs Unresolved ambiguity**
   - Market may resolve but not be in Dune yet (5-10 min lag)
   - Solution: Filter on `outcome.resolved = true`

### Substreams Gotchas

1. **Rust/Wasm learning curve**
   - Requires new language if you're Python-only
   - Solution: Use pre-built polymarket-pnl v0.3.1 (minimal changes)

2. **Chain reorg handling**
   - Substreams must replay blocks if reorg detected
   - Solution: Use configurable confirmations (12+ blocks)

3. **ABI mismatches**
   - If Polymarket contracts change, Substreams breaks
   - Solution: Monitor Polymarket GitHub releases

4. **Output sink overload**
   - Real-time streaming can exceed database write capacity
   - Solution: Use Kafka as buffer, batch insert to ClickHouse

---

## 9. WHICH TO CHOOSE?

### Choose Dune if:
- You need historical P&L backfill in <1 day
- Team is SQL-comfortable but not Rust-comfortable
- You're OK with 5-10 min lag for ongoing sync
- You want minimal operational overhead
- Budget is tight (free tier is sufficient)

### Choose Substreams if:
- You need <3 min lag for real-time dashboards
- You want transparent, auditable transformation logic
- Team is comfortable with Rust/Wasm
- You plan to customize P&L formula heavily
- You want zero vendor lock-in

### Choose Hybrid (RECOMMENDED) if:
- You want fast backfill + real-time sync
- You're willing to spend 4 weeks to get it right
- You want long-term sustainability (self-hosted)
- You want validation against Dune before cutover

---

## 10. EFFORT ESTIMATION

### Backfill Only (Dune)

| Task | Time | Difficulty |
|------|------|-----------|
| Dune account + SQL | 1 hour | Easy |
| Export 4 wallets | 30 min | Easy |
| Python ETL script | 1-2 hours | Easy |
| Load to ClickHouse | 30 min | Easy |
| Validation | 1 hour | Medium |
| **Total** | **4-5 hours** | **Easy** |

### Backfill + Ongoing (Dune + CLOB API)

| Task | Time | Difficulty |
|------|------|-----------|
| Dune backfill | 4-5 hours | Easy |
| CLOB API client | 2-3 hours | Easy |
| Blockchain monitor | 2-3 hours | Medium |
| Deduplication logic | 2-3 hours | Medium |
| Testing + validation | 2-3 hours | Medium |
| **Total** | **12-17 hours** | **Medium** |

### Real-time (Substreams)

| Task | Time | Difficulty |
|------|------|-----------|
| Substreams setup | 4-6 hours | Hard |
| polymarket-pnl integration | 2-3 hours | Medium |
| Output sink config | 2-3 hours | Medium |
| Testing + validation | 3-4 hours | Medium |
| **Total** | **11-16 hours** | **Hard** |

### Hybrid (Recommended)

| Task | Time | Difficulty |
|------|------|-----------|
| Dune backfill (Phase 1) | 4-5 hours | Easy |
| CLOB API (Phase 2) | 4-6 hours | Easy |
| Substreams (Phase 3, optional) | 6-8 hours | Hard |
| Validation + cutover | 3-4 hours | Medium |
| **Total** | **17-23 hours** | **Medium** |

---

## 11. RECOMMENDATION MATRIX

```
┌─────────────────────┬──────────┬──────────┬──────────┐
│ Use Case            │ Dune     │ Substream│ Hybrid   │
├─────────────────────┼──────────┼──────────┼──────────┤
│ Historical backfill │ ★★★★★   │ ★★★☆☆   │ ★★★★★   │
│ Real-time PnL      │ ★☆☆☆☆   │ ★★★★★   │ ★★★★☆   │
│ Setup speed        │ ★★★★★   │ ★★☆☆☆   │ ★★★☆☆   │
│ Maintainability    │ ★★★★☆   │ ★★☆☆☆   │ ★★★☆☆   │
│ Cost               │ ★★★★★   │ ★★★★★   │ ★★★★★   │
│ Flexibility        │ ★★☆☆☆   │ ★★★★★   │ ★★★★☆   │
│ Team skill (SQL)   │ ★★★★★   │ ★★☆☆☆   │ ★★★☆☆   │
│ Vendor lock-in     │ ★☆☆☆☆   │ ★★★★★   │ ★★★★☆   │
│ Overall for you    │ ★★★★☆   │ ★★★☆☆   │ ★★★★★   │
└─────────────────────┴──────────┴──────────┴──────────┘
```

**WINNER: Hybrid (Dune + CLOB API + optional Substreams)**

---

## 12. FINAL DECISION FRAMEWORK

### If you answer YES to most of these:

- [ ] Need P&L backfill within 1 day
- [ ] Have SQL-comfortable team
- [ ] Can validate against UI yourself
- [ ] Want minimal operational burden
- [ ] Can tolerate 5-10 min lag initially

→ **Use Dune for backfill, migrate after 4 weeks**

### If you answer YES to most of these:

- [ ] Need <1 min latency
- [ ] Have Rust/Wasm comfortable team
- [ ] Want full source code control
- [ ] Plan to customize PnL heavily
- [ ] Don't mind operational overhead

→ **Use Substreams from the start**

### If you want the best of both:

- [ ] Need fast backfill AND real-time sync
- [ ] Want to validate before committing
- [ ] Have 4 weeks to implement
- [ ] Team has mixed SQL + Rust skills
- [ ] Want zero vendor lock-in eventually

→ **Use Hybrid: Dune backfill → CLOB API → Substreams (optional)**

---

## CONCLUSION

**For Cascadian:** Use **Hybrid approach**.

1. **Week 1:** Dune CSV export backfill (3-5 hours)
2. **Weeks 2-3:** CLOB API for live trades (3-4 hours)
3. **Week 4:** Validate, cutover, monitor
4. **Optional Week 5+:** Add Substreams if you need <1 min latency

**Total effort:** 17-23 hours spread over 4 weeks
**Risk level:** LOW (backfill is isolated from production)
**Long-term sustainability:** HIGH (self-hosted, no vendor lock-in)

