# Overnight Data Pulling Strategy (5-6 Hours)

## Objective
Pull complete market metadata, condition IDs, and trade fill data from multiple sources to achieve 95%+ condition_id coverage on 160.9M trades.

## Current State
- **trades_raw**: 160.9M rows, 51.47% with condition_id
- **Missing**: 78.7M rows (48.53%) need condition_id enrichment
- **API attempt**: Gamma API gave us 8K markets (covers only 2M trades)

## Data Gap Analysis

### Primary Gaps
1. **Condition IDs** (78.7M rows missing)
   - What we have: 82.1M complete trades with condition_id
   - What we need: All market_id → condition_id mappings
   - Gaps: Markets active before Gamma API existed, archived markets

2. **Market Fill History** (ERC1155 transfers)
   - What we have: 388M USDC transfers
   - What we need: Complete ERC1155 token transfer history for all markets
   - Gaps: Could be incomplete due to RPC rate limits

3. **CLOB Fill Data**
   - What we have: Some CLOB data from existing backfills
   - What we need: Complete CLOB fill history from polymarket-clob-API
   - Gaps: Historical fills, edge cases

## Recommended Data Sources (Priority Order)

### Source 1: Polymarket CLOB API (HIGHEST PRIORITY)
- **Endpoint**: `https://clob.polymarket.com/`
- **What it provides**: Complete order fills, market metadata, condition IDs
- **Authentication**: CLOB_API_KEY, CLOB_API_SECRET, CLOB_API_PASSPHRASE
- **Rate limits**: 100 req/s per IP
- **Expected coverage**: 85-90% of missing markets
- **Time to complete**: ~2-3 hours for full historical backfill
- **Why**: Direct source, has condition_ids, has market metadata

### Source 2: Alchemy RPC + Event Logs (MEDIUM PRIORITY)
- **Endpoint**: Alchemy Polygon RPC (ALCHEMY_POLYGON_RPC_URL)
- **What it provides**: ERC1155 TransferBatch events with complete transfer history
- **Rate limits**: 300 requests per second
- **Expected coverage**: 60-70% of remaining gaps
- **Time to complete**: ~2-3 hours for full scan
- **Why**: Blockchain source of truth for token transfers

### Source 3: Goldsky/Thegraph (FALLBACK)
- **Endpoint**: Subgraph API (if available)
- **What it provides**: Indexed market data, condition mappings
- **Rate limits**: Generous
- **Expected coverage**: Fills remaining 5-15%
- **Time to complete**: ~30 min
- **Why**: Aggregated indexed data, fast queries

### Source 4: Gamma API (ALREADY TESTED)
- **What it provides**: Current market metadata
- **Coverage**: Only 8K of 150K+ markets
- **Use for**: Fallback for markets not in CLOB/Goldsky

## Worker Architecture

### Design: 8-Worker Parallel Pipeline
```
┌─────────────────────────────────────────────────────────────┐
│ Overnight Data Pull (5-6 hours target)                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Worker 1-2: CLOB API (2 workers)                            │
│    ├─ Fetch all markets with condition_ids                  │
│    ├─ Fetch all fills from past 30 days                     │
│    └─ Map market_id → condition_id                          │
│                                                              │
│  Worker 3-4: Alchemy RPC Events (2 workers)                 │
│    ├─ Scan ERC1155 TransferBatch events (parallel blocks)   │
│    ├─ Extract token_id → condition_id mappings             │
│    └─ Match to trades_raw by tx_hash                        │
│                                                              │
│  Worker 5-6: Goldsky Subgraph (2 workers)                   │
│    ├─ Query market conditions from subgraph                 │
│    ├─ Cross-reference with CLOB data                        │
│    └─ Fill remaining gaps                                   │
│                                                              │
│  Worker 7: Data Reconciliation                              │
│    ├─ Merge results from workers 1-6                        │
│    ├─ Deduplicate condition_id mappings                     │
│    └─ Conflict resolution (majority voting)                 │
│                                                              │
│  Worker 8: Enrichment & Verification                        │
│    ├─ Apply merged mappings to trades_raw                   │
│    ├─ Verify coverage improvement                           │
│    └─ Final statistics                                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Timeline (5-6 Hours)

| Phase | Time | Action | Expected Output |
|-------|------|--------|-----------------|
| 0:00-0:15 | 15m | Start workers 1-4 in parallel | CLOB + RPC scanning begins |
| 0:15-2:00 | 105m | Workers 1-4 running (CLOB markets + RPC events) | ~60-70% coverage data |
| 2:00-2:30 | 30m | Start workers 5-6 (Goldsky queries) | Remaining 20-30% data |
| 2:30-4:00 | 90m | Workers 1-6 complete, worker 7 reconciles | Merged mapping table (150K+ entries) |
| 4:00-5:30 | 90m | Worker 8 applies enrichment in batches | All 160.9M trades enriched |
| 5:30-6:00 | 30m | Final verification + reporting | Coverage: 90%+ |

## Implementation Plan

### Phase 1: Setup (Immediate)
- [ ] Create worker base infrastructure (worker-pool.ts)
- [ ] Create CLOB data puller (worker-clob-api.ts)
- [ ] Create RPC event scanner (worker-rpc-events.ts)
- [ ] Create Goldsky query executor (worker-goldsky.ts)
- [ ] Create data reconciler (worker-reconciler.ts)
- [ ] Create enrichment applier (worker-enrichment.ts)

### Phase 2: Execution (Start: Now)
- [ ] Launch all workers
- [ ] Monitor progress in real-time
- [ ] Handle failures gracefully (retry logic)
- [ ] Track intermediate results

### Phase 3: Validation (Hour 5-6)
- [ ] Verify coverage improvement
- [ ] Run sanity checks
- [ ] Report final statistics

## Data Storage Strategy

### Intermediate Tables
```
clob_market_mapping       → market_id, condition_id, source=CLOB
rpc_transfer_mapping      → market_id, condition_id, source=RPC
goldsky_market_mapping    → market_id, condition_id, source=GOLDSKY

condition_id_merged       → market_id, condition_id (deduplicated)

enriched_trades_final     → [all trade columns] + condition_id
```

### Deduplication Rules
- If all sources agree: Use directly
- If sources conflict:
  1. CLOB (trusted source) wins
  2. RPC event data (blockchain truth) is fallback
  3. Goldsky only if no other source

## Success Criteria
- [ ] 90%+ condition_id coverage (vs 51.47% baseline)
- [ ] All 160.9M rows have condition_id (or marked as unfillable)
- [ ] No data loss or corruption
- [ ] Completion in under 6 hours
- [ ] Full audit trail of enrichment sources

## Fallback Plan (If 5-6 hours not enough)
1. Prioritize CLOB API first (highest coverage)
2. Skip Goldsky if time runs out
3. Use market_id_mapping approach for remaining gaps (deterministic, fast)
4. Accept 85-90% coverage as acceptable if needed

## Next Steps
1. Review this strategy
2. Start implementing workers
3. Launch at: [SCHEDULED TIME]
