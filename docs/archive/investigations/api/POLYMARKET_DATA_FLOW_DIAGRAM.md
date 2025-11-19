# Polymarket ClickHouse Data Flow Diagram

This document provides a visual representation of the data transformation pipeline.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         POLYMARKET DATA SOURCES                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌──────────────────┐        ┌──────────────────┐                       │
│  │  Polygon Chain   │        │  Polymarket API  │                       │
│  │  (ERC1155 logs)  │        │  (CLOB fills)    │                       │
│  └────────┬─────────┘        └────────┬─────────┘                       │
│           │                           │                                  │
│           │                           │                                  │
└───────────┼───────────────────────────┼──────────────────────────────────┘
            │                           │
            │                           │
            ▼                           ▼
┌─────────────────────┐     ┌─────────────────────┐
│ erc1155_transfers   │     │  External CLOB API  │
│  (raw hex logs)     │     │  (REST endpoint)    │
└─────────┬───────────┘     └──────────┬──────────┘
          │                            │
          │                            │
          │ TRANSFORMATION LAYER       │
          │ (Scripts + SQL)            │
          │                            │
          ▼                            ▼
    ┌─────────────────────────────────────────────┐
    │                                             │
    │         DECODED & ENRICHED TABLES           │
    │                                             │
    └─────────────────────────────────────────────┘
```

---

## Detailed Data Flow

### PHASE 1: Event Decoding & Flattening

```
┌────────────────────────────────────────────────────────────────────────┐
│ erc1155_transfers                                                      │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │ block_number | tx_hash | address | topics[] | data                │ │
│ │ 45000000     | 0xabc.. | 0x4d9.. | [sig, ..] | 0x000000...       │ │
│ └────────────────────────────────────────────────────────────────────┘ │
└───────────────┬────────────────────────────────────────────────────────┘
                │
                │ Step 2A: flatten-erc1155.ts
                │ (TransferSingle events)
                │ • Extract operator from topics[2]
                │ • Extract from_addr from topics[3]
                │ • Extract to_addr from topics[4]
                │ • Extract token_id from data[0:32]
                │ • Extract amount from data[32:64]
                │
                ├─────────────────────────────────┐
                │                                 │
                ▼                                 │ Step 2B: decode-transfer-batch.ts
    ┌──────────────────────┐                     │ (TransferBatch events)
    │ pm_erc1155_flats     │◄────────────────────┤ • Use ethers.js Interface
    │ ┌──────────────────┐ │                     │ • Decode dynamic arrays
    │ │ block_number     │ │                     │ • Flatten: 1 batch → N rows
    │ │ tx_hash          │ │                     │
    │ │ operator         │ │                     │
    │ │ from_addr        │ │
    │ │ to_addr          │ │
    │ │ token_id         │ │
    │ │ amount           │ │
    │ │ event_type       │ │  ('single' or 'batch')
    │ └──────────────────┘ │
    └──────────┬───────────┘
               │
               │ ~1M-10M rows
               │
               └─────────────────────────────────────────────────┐
                                                                 │
                                                                 ▼
```

### PHASE 2: Proxy Wallet Mapping

```
┌────────────────────────────────────────────────────────────────────────┐
│ erc1155_transfers                                                      │
│ (ApprovalForAll events only)                                           │
│ topics[1] = 0x17307eab...                                              │
└───────────────┬────────────────────────────────────────────────────────┘
                │
                │ Step 3: build-approval-proxies.ts
                │ • Extract user_eoa from topics[2]
                │ • Extract proxy_wallet from topics[3]
                │ • Extract approved status from data
                │ • Track first_seen and last_seen
                │
                ▼
    ┌──────────────────────────┐
    │ pm_user_proxy_wallets    │
    │ ┌──────────────────────┐ │
    │ │ user_eoa             │ │  Maps EOA → proxy wallet
    │ │ proxy_wallet         │ │
    │ │ source               │ │  ('onchain', 'api')
    │ │ first_seen_at        │ │
    │ │ last_seen_at         │ │
    │ │ is_active            │ │  (1=approved, 0=revoked)
    │ └──────────────────────┘ │
    └──────────────────────────┘
                │
                │ ~10k-100k rows
                │
                └─────────────────────────────────────────────────┐
                                                                  │
                                                                  ▼
```

### PHASE 3: Market Enrichment

```
┌────────────────────────┐          ┌────────────────────────┐
│ gamma_markets          │          │ market_resolutions_    │
│ ┌────────────────────┐ │          │ final                  │
│ │ market_id          │ │          │ ┌────────────────────┐ │
│ │ condition_id       │ │          │ │ market_id          │ │
│ │ question           │ │          │ │ winner             │ │
│ │ outcomes[]         │ │          │ │ is_resolved        │ │
│ │ category           │ │          │ │ winning_index      │ │
│ └────────────────────┘ │          │ └────────────────────┘ │
└────────┬───────────────┘          └───────┬────────────────┘
         │                                  │
         │                                  │
         └──────────┬───────────────────────┘
                    │
                    │ Step 4A: Apply migration 016
                    │ • Add columns to ctf_token_map
                    │ • Create enriched views
                    │
                    ▼
         ┌──────────────────────┐
         │ Step 4B:             │
         │ enrich-token-map.ts  │
         │ • Join on            │
         │   condition_id       │
         │ • Populate market_id │
         │ • Extract outcome    │
         │ • Add question       │
         └──────────┬───────────┘
                    │
                    ▼
    ┌────────────────────────────────┐
    │ ctf_token_map (ENRICHED)       │
    │ ┌────────────────────────────┐ │
    │ │ token_id                   │ │
    │ │ condition_id_norm          │ │
    │ │ outcome_index              │ │
    │ │                            │ │
    │ │ market_id      ← NEW       │ │
    │ │ outcome        ← NEW       │ │
    │ │ question       ← NEW       │ │
    │ └────────────────────────────┘ │
    └────────────────────────────────┘
```

### PHASE 4: Enriched Views (Read-Only)

```
┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│ pm_erc1155_flats    │    │ ctf_token_map       │    │ pm_user_proxy_      │
│                     │    │ (enriched)          │    │ wallets             │
└──────────┬──────────┘    └──────────┬──────────┘    └──────────┬──────────┘
           │                          │                          │
           └──────────────┬───────────┴──────────────────────────┘
                          │
                          │ LEFT JOIN on token_id and proxy addresses
                          │
                          ▼
              ┌───────────────────────────────┐
              │ erc1155_transfers_enriched    │
              │ ┌───────────────────────────┐ │
              │ │ • All transfer fields     │ │
              │ │ + market_id               │ │
              │ │ + outcome                 │ │
              │ │ + question                │ │
              │ │ + from_eoa                │ │  (resolved from proxy)
              │ │ + to_eoa                  │ │  (resolved from proxy)
              │ │ + is_winning_outcome      │ │
              │ └───────────────────────────┘ │
              └───────────────────────────────┘
                          │
                          │ This view is the GOLD STANDARD
                          │ for all analytics queries
                          │
                          ▼
              ┌───────────────────────────────┐
              │ ANALYTICS USE CASES:          │
              │ • Position tracking           │
              │ • P&L calculations            │
              │ • Wallet performance          │
              │ • Market liquidity            │
              │ • Trading patterns            │
              └───────────────────────────────┘
```

### PHASE 5: CLOB Trade Ingestion

```
┌────────────────────────────────────────────────────────────────────────┐
│ Polymarket CLOB API                                                    │
│ https://clob.polymarket.com/api/v1/trades                              │
└───────────────┬────────────────────────────────────────────────────────┘
                │
                │ Step 5: ingest-clob-fills.ts
                │ • Fetch fills for each proxy wallet
                │ • Paginate with next_cursor
                │ • Rate limit: 100ms delay
                │ • Transform API format to table schema
                │
                ▼
    ┌──────────────────────────────────┐
    │ pm_trades                        │
    │ ┌──────────────────────────────┐ │
    │ │ id                           │ │  Unique trade ID
    │ │ market_id                    │ │
    │ │ asset_id                     │ │  (token_id)
    │ │ side                         │ │  (BUY/SELL)
    │ │ size                         │ │  Amount in tokens
    │ │ price                        │ │  Execution price (0-1)
    │ │ fee_rate_bps                 │ │
    │ │ maker_address                │ │
    │ │ taker_address                │ │
    │ │ maker_orders[]               │ │  Array of order IDs
    │ │ taker_order_id               │ │
    │ │ transaction_hash             │ │
    │ │ timestamp                    │ │
    │ └──────────────────────────────┘ │
    └──────────────────────────────────┘
                │
                │ ~10k-1M+ rows
                │
                └──────────────────────────────────────┐
                                                       │
                                                       ▼
                                         ┌───────────────────────┐
                                         │ Can be joined with:   │
                                         │ • ctf_token_map       │
                                         │ • markets_enriched    │
                                         │ • proxy_wallets       │
                                         └───────────────────────┘
```

---

## Complete Data Model (Entity-Relationship)

```
┌─────────────────────────┐
│ erc1155_transfers       │
│ (SOURCE - Read Only)    │
│ ┌─────────────────────┐ │
│ │ block_number        │ │
│ │ tx_hash             │ │
│ │ address             │ │
│ │ topics[]            │ │
│ │ data                │ │
│ └─────────────────────┘ │
└───────────┬─────────────┘
            │
            │ decoded by
            │
            ▼
┌─────────────────────────┐         ┌─────────────────────────┐
│ pm_erc1155_flats        │         │ pm_user_proxy_wallets   │
│ ┌─────────────────────┐ │         │ ┌─────────────────────┐ │
│ │ token_id [FK]       │────┐      │ │ user_eoa            │ │
│ │ from_addr           │──┐ │      │ │ proxy_wallet [FK]   │─┐
│ │ to_addr             │─┐│ │      │ │ is_active           │ │
│ │ amount              │ ││ │      │ └─────────────────────┘ │
│ │ event_type          │ ││ │      └─────────────────────────┘
│ └─────────────────────┘ ││ │                │
└─────────────────────────┘││ │                │
                           ││ └────────┐       │
                           ││          │       │
                           │└──────┐   │       │
                           │       │   │       │
                           ▼       ▼   ▼       ▼
                    ┌────────────────────────────────────┐
                    │ erc1155_transfers_enriched (VIEW)  │
                    │ ┌────────────────────────────────┐ │
                    │ │ • Transfer data                │ │
                    │ │ • Market context               │ │
                    │ │ • Proxy resolution             │ │
                    │ └────────────────────────────────┘ │
                    └────────────────────────────────────┘

┌─────────────────────────┐         ┌─────────────────────────┐
│ ctf_token_map           │         │ gamma_markets           │
│ ┌─────────────────────┐ │         │ ┌─────────────────────┐ │
│ │ token_id [PK]       │ │         │ │ market_id [PK]      │ │
│ │ condition_id_norm   │─────┐     │ │ condition_id [FK]   │─┐
│ │ outcome_index       │ │   │     │ │ question            │ │
│ │                     │ │   └────▶│ │ outcomes[]          │ │
│ │ market_id [FK]      │─┘         │ │ category            │ │
│ │ outcome             │           │ └─────────────────────┘ │
│ │ question            │           └─────────┬───────────────┘
│ └─────────────────────┘ │                   │
└─────────────────────────┘                   │
            │                                 │
            │                                 │
            └────────────┬────────────────────┘
                         │
                         │ joined in
                         │
                         ▼
              ┌──────────────────────────┐
              │ token_market_enriched    │
              │ (VIEW)                   │
              │ ┌──────────────────────┐ │
              │ │ • Token details      │ │
              │ │ • Market details     │ │
              │ │ • Resolution status  │ │
              │ │ • is_winning_outcome │ │
              │ └──────────────────────┘ │
              └──────────────────────────┘

┌─────────────────────────┐         ┌─────────────────────────┐
│ market_resolutions_     │         │ pm_trades               │
│ final                   │         │ ┌─────────────────────┐ │
│ ┌─────────────────────┐ │         │ │ id [PK]             │ │
│ │ market_id [FK]      │─┐         │ │ market_id [FK]      │─┐
│ │ winner              │ │         │ │ asset_id [FK]       │─┼──┐
│ │ winning_index       │ │         │ │ maker_address [FK]  │─┼┐ │
│ │ is_resolved         │ │         │ │ taker_address [FK]  │─┼┼┐│
│ └─────────────────────┘ │         │ │ side                │ │││││
└───────────┬─────────────┘         │ │ size                │ │││││
            │                       │ │ price               │ │││││
            │                       │ │ timestamp           │ │││││
            │                       │ └─────────────────────┘ │││││
            │                       └─────────────────────────┘││││
            │                                │ │ │ │           ││││
            │                                │ │ │ └───────────┘│││
            │                                │ │ └──────────────┘││
            │                                │ └─────────────────┘│
            │                                └────────────────────┘
            │                                      ▼
            │                         ┌──────────────────────────┐
            │                         │ Can join to:             │
            │                         │ • ctf_token_map          │
            │                         │ • pm_user_proxy_wallets  │
            │                         │ • markets_enriched       │
            │                         └──────────────────────────┘
            │
            └────────────────┐
                             │
                             ▼
                  ┌──────────────────────┐
                  │ markets_enriched     │
                  │ (VIEW)               │
                  │ ┌──────────────────┐ │
                  │ │ • Market data    │ │
                  │ │ • Resolution data│ │
                  │ │ • is_resolved    │ │
                  │ └──────────────────┘ │
                  └──────────────────────┘
```

---

## Query Patterns

### Pattern 1: Position Tracking
```sql
SELECT
  wallet,
  market_id,
  outcome,
  SUM(amount) as total_amount
FROM erc1155_transfers_enriched
WHERE to_addr = wallet
GROUP BY wallet, market_id, outcome;
```

### Pattern 2: Wallet P&L
```sql
SELECT
  to_eoa,
  SUM(CASE WHEN is_winning_outcome = 1 THEN amount ELSE 0 END) as winning_tokens,
  SUM(CASE WHEN is_winning_outcome = 0 THEN amount ELSE 0 END) as losing_tokens
FROM erc1155_transfers_enriched
WHERE market_id IN (SELECT market_id FROM markets_enriched WHERE is_resolved = 1)
GROUP BY to_eoa;
```

### Pattern 3: Market Liquidity
```sql
SELECT
  market_id,
  question,
  COUNT(DISTINCT to_addr) as unique_holders,
  SUM(amount) as total_volume
FROM erc1155_transfers_enriched
GROUP BY market_id, question
ORDER BY total_volume DESC;
```

### Pattern 4: Trading Activity
```sql
SELECT
  maker_address,
  COUNT(*) as trade_count,
  SUM(size * price) as volume_usd,
  AVG(price) as avg_price
FROM pm_trades
WHERE timestamp >= now() - INTERVAL 7 DAY
GROUP BY maker_address
ORDER BY volume_usd DESC;
```

---

## Performance Considerations

### Table Sizes (Estimated)
```
erc1155_transfers:           1M - 100M rows   (source, read-only)
pm_erc1155_flats:            1M - 10M rows    (decoded transfers)
pm_user_proxy_wallets:       10k - 100k rows  (active proxies)
ctf_token_map:               50k - 500k rows  (unique tokens)
gamma_markets:               10k - 100k rows  (all markets)
market_resolutions_final:    5k - 50k rows    (resolved markets)
pm_trades:                   100k - 10M rows  (CLOB fills)
```

### Query Performance
- **pm_erc1155_flats:** Partitioned by month, ordered by (block_number, tx_hash, log_index)
- **pm_user_proxy_wallets:** Ordered by proxy_wallet for fast lookups
- **ctf_token_map:** Bloom filters on condition_id_norm and market_id
- **pm_trades:** Partitioned by month, bloom filters on addresses

### Optimization Tips
1. Use partitioning for time-based queries
2. Use bloom filters for high-cardinality string lookups
3. Materialize frequently-used aggregations
4. Use projections for different sort orders

---

**End of Diagram**
