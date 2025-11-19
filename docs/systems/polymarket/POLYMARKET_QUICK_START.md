# Polymarket ClickHouse Pipeline - Quick Start Guide

**TL;DR:** Run these commands in order to populate your Polymarket data pipeline.

---

## Prerequisites

```bash
# Ensure ClickHouse credentials are set
export CLICKHOUSE_HOST="https://your-instance.clickhouse.cloud:8443"
export CLICKHOUSE_USER="default"
export CLICKHOUSE_PASSWORD="your-password"
export CLICKHOUSE_DATABASE="default"
```

---

## Execution Order

### 1. Audit Current State (Optional but Recommended)
```bash
npx tsx scripts/audit-polymarket-clickhouse.ts > audit-before.txt
```

This will:
- ✅ Autodetect CT contract address
- ✅ Show current row counts for all tables
- ✅ Identify missing columns
- ✅ Generate implementation plan

**Expected output:** Report showing empty tables and missing columns

---

### 2. Populate pm_erc1155_flats

#### 2A. Flatten TransferSingle Events (10-30 min)
```bash
npx tsx scripts/flatten-erc1155.ts
```

**What it does:** Extracts and decodes TransferSingle events from `erc1155_transfers`

**Verify:**
```sql
SELECT COUNT(*) FROM pm_erc1155_flats WHERE event_type = 'single';
```

#### 2B. Decode TransferBatch Events (5-15 min)
```bash
npx tsx scripts/decode-transfer-batch.ts
```

**What it does:** Uses ethers.js to properly decode TransferBatch events (complex ABI)

**Verify:**
```sql
SELECT COUNT(*) FROM pm_erc1155_flats WHERE event_type = 'batch';
```

---

### 3. Build Proxy Wallet Mappings (5-10 min)

```bash
npx tsx scripts/build-approval-proxies.ts
```

**What it does:** Extracts user EOA → proxy wallet mappings from ApprovalForAll events

**Note:** Script has correct event signature now: `0x17307eab...`

**Verify:**
```sql
SELECT COUNT(*) FROM pm_user_proxy_wallets WHERE is_active = 1;
SELECT COUNT(DISTINCT user_eoa) FROM pm_user_proxy_wallets WHERE is_active = 1;
```

---

### 4. Enhance ctf_token_map with Market Data

#### 4A. Apply Migration (< 1 min)
```bash
clickhouse-client --queries-file migrations/clickhouse/016_enhance_polymarket_tables.sql
```

**What it does:**
- Adds `market_id`, `outcome`, `question` columns to `ctf_token_map`
- Creates enriched views: `markets_enriched`, `token_market_enriched`, `erc1155_transfers_enriched`
- Creates `pm_trades` table schema

#### 4B. Populate Market Data (2-10 min)
```bash
npx tsx scripts/enrich-token-map.ts
```

**What it does:** Joins `ctf_token_map` with `gamma_markets` to populate market metadata

**Verify:**
```sql
SELECT
  COUNT(*) as total,
  countIf(market_id != '') as enriched,
  round(countIf(market_id != '') / COUNT(*) * 100, 2) as coverage_pct
FROM ctf_token_map;
```

**Expected:** 80-95% coverage (some tokens may be from old/deprecated markets)

---

### 5. Ingest CLOB Fills (30-120 min)

```bash
npx tsx scripts/ingest-clob-fills.ts
```

**What it does:** Fetches trade fills from Polymarket CLOB API for all proxy wallets

**Note:** May take a while due to API rate limits. Script uses pagination.

**Verify:**
```sql
SELECT
  COUNT(*) as total_trades,
  COUNT(DISTINCT market_id) as markets,
  min(timestamp) as first_trade,
  max(timestamp) as last_trade
FROM pm_trades;
```

---

### 6. Final Audit (Optional)
```bash
npx tsx scripts/audit-polymarket-clickhouse.ts > audit-after.txt
```

Compare `audit-before.txt` with `audit-after.txt` to see what was populated.

---

## Quick Validation Queries

### Check all table counts
```sql
SELECT 'pm_erc1155_flats' as table, COUNT(*) as rows FROM pm_erc1155_flats
UNION ALL
SELECT 'pm_user_proxy_wallets', COUNT(*) FROM pm_user_proxy_wallets WHERE is_active = 1
UNION ALL
SELECT 'ctf_token_map (enriched)', countIf(market_id != '') FROM ctf_token_map
UNION ALL
SELECT 'pm_trades', COUNT(*) FROM pm_trades
UNION ALL
SELECT 'gamma_markets', COUNT(*) FROM gamma_markets;
```

### Test enriched views
```sql
-- Sample enriched transfers with market context
SELECT
  tx_hash,
  token_id,
  market_id,
  outcome,
  from_addr,
  from_eoa,
  to_addr,
  to_eoa
FROM erc1155_transfers_enriched
WHERE market_id != ''
LIMIT 10;

-- Sample markets with resolution status
SELECT
  market_id,
  substring(question, 1, 60) as question,
  is_resolved,
  winner
FROM markets_enriched
WHERE is_resolved = 1
LIMIT 5;
```

### Check data quality
```sql
-- Tokens without market data (should be < 20%)
SELECT COUNT(*) FROM ctf_token_map WHERE market_id = '';

-- Transfers without market context (should be minimal)
SELECT COUNT(*) FROM erc1155_transfers_enriched WHERE market_id = '';

-- Proxy coverage
SELECT
  COUNT(*) as total_transfers,
  countIf(from_eoa != '') as from_has_proxy,
  countIf(to_eoa != '') as to_has_proxy,
  round(countIf(from_eoa != '' OR to_eoa != '') / COUNT(*) * 100, 2) as proxy_coverage_pct
FROM erc1155_transfers_enriched;
```

---

## Troubleshooting

### Issue: "Table already exists" errors
**Solution:** Scripts use `CREATE TABLE IF NOT EXISTS`. Safe to rerun.

### Issue: "No data in pm_erc1155_flats"
**Cause:** `erc1155_transfers` source table is empty or CT address is wrong
**Solution:** Check `erc1155_transfers` has data, verify CT address in audit

### Issue: Low coverage in ctf_token_map enrichment
**Cause:** `condition_id_norm` doesn't match `gamma_markets.condition_id`
**Solution:** Check normalization (case, whitespace, format) in `enrich-token-map.ts`

### Issue: CLOB API rate limiting
**Cause:** Too many requests too fast
**Solution:** Script has delays built in. Adjust `setTimeout()` in `ingest-clob-fills.ts`

### Issue: ClickHouse mutations taking forever
**Cause:** Large table updates can be slow
**Solution:** Script falls back to create-and-swap method. Wait or run manually.

---

## Advanced: Parallel Execution

Some steps can run in parallel to save time:

```bash
# Terminal 1: TransferSingle
npx tsx scripts/flatten-erc1155.ts

# Terminal 2: TransferBatch (wait 30 sec after Terminal 1 starts)
npx tsx scripts/decode-transfer-batch.ts

# Terminal 3: Proxy wallets (can run anytime)
npx tsx scripts/build-approval-proxies.ts
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `scripts/audit-polymarket-clickhouse.ts` | Audit current state |
| `scripts/flatten-erc1155.ts` | Decode TransferSingle |
| `scripts/decode-transfer-batch.ts` | Decode TransferBatch |
| `scripts/build-approval-proxies.ts` | Build proxy mappings |
| `scripts/enrich-token-map.ts` | Add market data to tokens |
| `scripts/ingest-clob-fills.ts` | Fetch CLOB trade fills |
| `migrations/clickhouse/016_enhance_polymarket_tables.sql` | Add columns & views |
| `POLYMARKET_CLICKHOUSE_AUDIT_REPORT.md` | Full technical documentation |

---

## Expected Timeline

| Step | Duration | Can Skip? |
|------|----------|-----------|
| 1. Audit | 30s | ✅ Yes |
| 2A. TransferSingle | 10-30 min | ❌ No |
| 2B. TransferBatch | 5-15 min | ⚠️ Only if no batch events |
| 3. Proxy wallets | 5-10 min | ⚠️ Needed for enriched views |
| 4A. Migration | < 1 min | ❌ No |
| 4B. Enrich tokens | 2-10 min | ❌ No |
| 5. CLOB fills | 30-120 min | ⚠️ Needed for trade analytics |
| **Total** | **1-3 hours** | |

---

## Next Steps After Completion

1. **Build analytics queries** using enriched views
2. **Create materialized views** for common aggregations
3. **Set up incremental updates** for new blocks
4. **Build position tracking** for wallets
5. **Calculate P&L** using resolution data

---

**Questions?** Check `POLYMARKET_CLICKHOUSE_AUDIT_REPORT.md` for detailed technical documentation.
