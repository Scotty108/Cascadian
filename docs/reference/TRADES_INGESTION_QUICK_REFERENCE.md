# TRADES DATA INGESTION - QUICK REFERENCE

**Fast lookup guide for common questions about the Cascadian trades pipeline**

---

## 1. WHERE IS THE TRADES DATA?

| Table | Location | Rows | Status | Use Case |
|-------|----------|------|--------|----------|
| **trades_with_direction** | `default.trades_with_direction` | 82M | ✅ PRIMARY | PnL calculations, analytics |
| **vw_trades_canonical** | `cascadian_clean.vw_trades_canonical` | 157M | ✅ ENRICHED | Production queries, dashboards |
| **trades_raw** | `default.trades_raw` | 160M | ⚠️ SOURCE | Debugging, data quality checks |
| **erc1155_transfers** | `default.erc1155_transfers` | 291K | ✅ RAW | Blockchain verification |
| **erc20_transfers_decoded** | `default.erc20_transfers_decoded` | 21M | ✅ DECODED | USDC flow analysis |

---

## 2. DATA INGESTION SOURCES

### Blockchain (Primary)
- **Contract:** CTF address `0xd552174f4f14c8f9a6eb4d51e5d2c7bbeafccf61`
- **Events:** ERC1155 TransferSingle/Batch
- **Coverage:** 1,048 days (Dec 2022 - Oct 2025)
- **Worker:** `/scripts/step3-streaming-backfill-parallel.ts` (8-worker sharded)
- **Table:** `erc1155_transfers` → `pm_erc1155_flats` → `trades_with_direction`

### CLOB API (Secondary)
- **Endpoint:** `https://clob.polymarket.com`
- **Rate Limit:** 100 req/s
- **Auth:** HMAC-SHA256 signature required
- **Worker:** `/worker-clob-api*.ts` variants
- **Use:** Market metadata, condition_id mappings

### Goldsky Substreams (Real-Time)
- **Module:** `polymarket-pnl@v0.3.1`
- **Handlers:** `map_ctf_exchange_order_filled`, `map_user_positions`
- **Use:** Live PnL updates, settlement notifications

---

## 3. KEY TABLES AT A GLANCE

### trades_with_direction (82M rows)
```sql
tx_hash, block_number, block_time, wallet_address, condition_id_norm,
market_id, outcome_index, shares, price, usd_value,
direction_from_transfers (BUY/SELL/UNKNOWN), confidence (HIGH/MEDIUM/LOW), reason
```
**Best for:** PnL calculations, high-confidence direction assignments

### vw_trades_canonical (157M rows)
```sql
trade_key, transaction_hash, wallet_address_norm, market_id_norm,
condition_id_norm, timestamp, outcome_token, outcome_index,
trade_direction, direction_confidence, shares, usd_value,
entry_price, created_at
```
**Best for:** Production analytics, normalized joins, dashboard queries

### market_resolutions_final (224K markets)
```sql
condition_id_norm (FixedString(64)), payout_numerators (Array),
payout_denominator, winning_index, winning_outcome, outcome_count,
resolved_at, source
```
**Best for:** P&L settlement, payout vectors, market resolution status

---

## 4. HOW TRADES ARE CREATED

```
Blockchain Events (ERC1155 + USDC)
    ↓ [flatten-erc1155.ts]
Raw Event Logs (pm_erc1155_flats)
    ↓ [build-approval-proxies.ts]
Proxy Wallet Mapping (pm_user_proxy_wallets)
    ↓ [enrich-token-map.ts]
Token-to-Market Mapping (ctf_token_map)
    ↓ [Direction assignment from net flows]
BUYS/SELLS Identified
    ↓ [Normalization + enrichment]
trades_with_direction (82M rows) ← USE THIS
    ↓ [Add metadata + resolve wallets]
vw_trades_canonical (157M rows) ← OR THIS
```

---

## 5. DIRECTION ASSIGNMENT (5-SECOND EXPLANATION)

```
Given: Token transfer (to wallet) + USDC transfer (from wallet)
Calculate: token_net = tokens_received - tokens_spent
          usdc_net = usdc_spent - usdc_received
Result:    BUY if (token_net > 0 AND usdc_net > 0)
          SELL if (token_net < 0 AND usdc_net < 0)
          UNKNOWN if inconsistent
Confidence: HIGH (both legs present) → MEDIUM (one leg) → LOW
```

---

## 6. CONDITION ID NORMALIZATION (CRITICAL)

**Always do this before any join:**

```sql
-- Normalize to: 64-char lowercase hex (no 0x prefix)
lower(replaceAll(condition_id, '0x', '')) as condition_id_norm

-- In joins, cast FixedString to String:
WHERE toString(market_resolutions_final.condition_id_norm)
    = trades_with_direction.condition_id_norm
```

---

## 7. COMMON QUERIES

### Get Wallet's Total PnL (Realized)
```sql
SELECT
  wallet_address,
  SUM(shares * (arrayElement(r.payout_numerators, r.winning_index + 1)
      / r.payout_denominator) - usd_value) as realized_pnl_usd
FROM trades_with_direction t
LEFT JOIN market_resolutions_final r ON toString(r.condition_id_norm) = t.condition_id_norm
WHERE r.winning_index IS NOT NULL
GROUP BY wallet_address
ORDER BY realized_pnl_usd DESC
```

### Get Trades by Direction
```sql
SELECT
  direction_from_transfers,
  COUNT(*) as trade_count,
  COUNT(*) * 100.0 / (SELECT COUNT(*) FROM trades_with_direction) as pct
FROM trades_with_direction
WHERE confidence = 'HIGH'
GROUP BY direction_from_transfers
```

### Get Top Markets by Volume
```sql
SELECT
  condition_id_norm,
  market_id,
  COUNT(DISTINCT tx_hash) as trade_count,
  SUM(usd_value) as total_volume_usd
FROM trades_with_direction
GROUP BY condition_id_norm, market_id
ORDER BY total_volume_usd DESC
LIMIT 20
```

### Check Data Freshness
```sql
SELECT
  MIN(block_time) as earliest_trade,
  MAX(block_time) as latest_trade,
  NOW() - MAX(block_time) as staleness
FROM trades_with_direction
```

---

## 8. RUNNING A BACKFILL

```bash
# Full blockchain backfill (single worker)
npx tsx scripts/step3-streaming-backfill-parallel.ts

# With 8 parallel workers (faster)
SHARDS=8 SHARD_ID=0 npx tsx scripts/step3-streaming-backfill-parallel.ts &
SHARDS=8 SHARD_ID=1 npx tsx scripts/step3-streaming-backfill-parallel.ts &
# ... (repeat for SHARD_ID=2-7)
wait

# Monitor progress
docker exec clickhouse clickhouse-client \
  -q "SELECT day_idx, status, COUNT(*) FROM backfill_checkpoint GROUP BY day_idx, status"
```

**Expected Runtime:**
- Single worker: 2-5 hours
- 8 workers parallel: 20-40 minutes
- Full coverage: 1,048 days (Dec 2022 - Oct 2025)

---

## 9. CRITICAL GOTCHAS

| Gotcha | Problem | Fix |
|--------|---------|-----|
| **Condition ID format** | 5 different formats across tables | Always normalize: `lower(replaceAll(..., '0x', ''))` |
| **FixedString(64) joins** | Silent join failures | Cast to String: `toString(condition_id_norm)` |
| **Array indexing** | ClickHouse uses 1-based indexing | Add 1: `arrayElement(arr, index + 1)` |
| **Placeholder markets** | market_id='12' is invalid | Filter: `WHERE market_id NOT IN ('12', '0')` |
| **Enum8 side field** | trades_raw.side is 'YES'/'NO', not numeric | Use string comparison, not numeric |
| **USDC vs token net** | Direction requires BOTH flows | Check `confidence` field: HIGH = both legs |

---

## 10. PERFORMANCE TIPS

1. **Filter by date range first** (block_time is indexed)
2. **Exclude placeholders early** (avoid wasting cycles on market_id='12')
3. **Use HIGH confidence trades only** for analytics (77% of 82M = 63M high-quality rows)
4. **Pre-filter markets** if analyzing specific condition_ids (avoid 150K+ market join)
5. **Batch inserts in 5K-10K row chunks** (avoid timeout)

---

## 11. DATA QUALITY METRICS

| Metric | Value | Implication |
|--------|-------|-------------|
| **High confidence trades** | 77% | Use these for production |
| **Direction assignments** | BUY:35%, SELL:40%, UNKNOWN:25% | 75% have direction |
| **Condition ID coverage** | 100% in trades_with_direction | No missing markets |
| **Resolved markets** | 224K (25% of all) | 75% markets unresolved (genuine) |
| **Data recency** | Latest: Oct 31, 2025 | Up to current |
| **Historical coverage** | Dec 18, 2022 onward | ~3 years of full data |

---

## 12. FILES TO READ NEXT

| Document | Read If | Time |
|----------|---------|------|
| **TRADES_INGESTION_COMPREHENSIVE_GUIDE.md** | Want full details on pipeline | 20 min |
| **DATABASE_ARCHITECTURE_REFERENCE.md** | Need to understand schema relationships | 15 min |
| **SMOKING_GUN_FINDINGS.md** | Want to understand data quality decisions | 10 min |
| **POLYMARKET_DATA_FLOW_DIAGRAM.md** | Visual learner, want diagram | 10 min |
| **CLAUDE.md (Stable Pack)** | Need SQL best practices | 5 min |

---

## 13. ENVIRONMENT VARIABLES NEEDED

```bash
# ClickHouse
CLICKHOUSE_HOST=https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=<password>
CLICKHOUSE_DATABASE=default

# Ethereum RPC
ETHEREUM_RPC_URLS=https://polygon-rpc-1,https://polygon-rpc-2

# CLOB API (optional, for market mapping)
CLOB_API_KEY=<key>
CLOB_API_SECRET=<secret>
CLOB_API_PASSPHRASE=<passphrase>
```

---

## 14. VALIDATION CHECKLIST

- [ ] Can connect to ClickHouse (test with `SELECT version()`)
- [ ] `trades_with_direction` has 82M+ rows
- [ ] `market_resolutions_final` has 224K+ rows
- [ ] Condition IDs normalized (lowercase, no 0x, 64 chars)
- [ ] Latest trades are recent (< 24 hours old)
- [ ] Direction distribution ~75% BUY/SELL, ~25% UNKNOWN
- [ ] Can join trades to resolutions without NULL rows
- [ ] PnL calculations match expected formulas

---

**Quick Reference v2.0 | Last Updated: Nov 9, 2025 | Status: Current**
