# Polymarket Subgraph Research Summary

**Date:** January 9, 2026
**Analyzed Commit:** f5a074a5a3b7622185971c5f18aec342bcbe96a6
**Repository:** https://github.com/Polymarket/polymarket-subgraph

---

## Research Objective

Map the complete Polymarket PnL subgraph structure to understand:
1. All event handlers and data sources
2. How PnL is calculated in real-time
3. Why Cascadian's CLOB-based approach fails for neg risk markets
4. What filtering rules prevent double-counting

---

## Key Findings

### 1. Architecture Overview

The subgraph listens to **5 core contracts** and processes **18 event types**:

| Contract | Events Tracked | Purpose |
|----------|----------------|---------|
| ConditionalTokens | 5 events | Core token operations (split/merge/redeem) |
| Exchange (CTFExchange) | 1 event | Standard CLOB trades |
| NegRiskExchange | 1 event | Neg Risk CLOB trades |
| NegRiskAdapter | 6 events | Neg Risk conversions |
| FixedProductMarketMaker | 4 events | AMM trades + liquidity |

### 2. Core PnL Formula

All PnL tracking uses **two core functions**:

```typescript
// On BUY
newAvgPrice = (oldAvgPrice * oldAmount + buyPrice * buyAmount) / (oldAmount + buyAmount)
amount += buyAmount
totalBought += buyAmount

// On SELL
adjustedAmount = min(sellAmount, currentAmount)
deltaPnL = adjustedAmount * (sellPrice - avgPrice) / COLLATERAL_SCALE
realizedPnl += deltaPnL
amount -= adjustedAmount
```

This is **identical to Cascadian's V1 formula**, but applied to all event types.

### 3. Critical Filtering Rules

The subgraph **ignores specific events** to prevent double-counting:

| Event | Filter Condition | Reason |
|-------|------------------|--------|
| ConditionalTokens.PositionSplit | stakeholder = NegRiskAdapter | Adapter has its own handler |
| ConditionalTokens.PositionSplit | stakeholder = CTFExchange | Internal bookkeeping |
| ConditionalTokens.PositionsMerge | stakeholder = NegRiskAdapter | Adapter has its own handler |
| ConditionalTokens.PositionsMerge | stakeholder = CTFExchange | Internal bookkeeping |
| ConditionalTokens.PayoutRedemption | redeemer = NegRiskAdapter | Adapter has its own handler |
| NegRiskAdapter.PositionSplit | stakeholder = NegRiskExchange | Internal bookkeeping |
| NegRiskAdapter.PositionsMerge | stakeholder = NegRiskExchange | Internal bookkeeping |

**This is the root cause of Cascadian's failure.** The CLOB API includes these filtered events as real trades.

### 4. Neg Risk Conversion Logic

The most complex handler is `PositionsConverted`, which:
1. SELLS NO tokens from some questions at their avgPrice
2. Calculates the implied YES price: `yesPrice = (1.0 - noCount * avgNoPrice) / yesCount`
3. BUYS YES tokens for remaining questions at the calculated price

This logic is **not present in CLOB data** and cannot be reconstructed from it.

### 5. Trade Side Detection

The subgraph determines BUY vs SELL by checking `makerAssetId`:
- If `makerAssetId == 0` → BUY (maker pays USDC)
- If `makerAssetId != 0` → SELL (maker pays tokens)

Both CTFExchange and NegRiskExchange use the **same handler** (`handleOrderFilled`).

---

## Why Cascadian Can't Replicate This

| Factor | Subgraph Approach | Cascadian Limitation |
|--------|-------------------|----------------------|
| **Data Source** | Raw blockchain events | CLOB API (post-processed) |
| **Event Ordering** | Guaranteed sequential | No ordering guarantees |
| **Filtering** | Filters out adapter/exchange internal events | CLOB API includes all events |
| **Redemptions** | Tracks PayoutRedemption events | No redemption tracking |
| **Neg Risk Conversions** | PositionsConverted event + indexSet | No conversion data |
| **AMM Trades** | FPMM event handlers | No AMM data ingestion |

**Bottom line:** The CLOB API contains "phantom trades" (adapter bookkeeping) that the subgraph filters out at the source. Cascadian sees them as real user trades, inflating PnL.

---

## What Cascadian Got Right

1. **FIFO weighted average cost basis** - Same formula as subgraph
2. **Realized vs unrealized PnL separation** - Correct approach
3. **$0.50 split/merge pricing** - Would work if we had the events

---

## What Cascadian Missed

1. **Filtering adapter/exchange internal events** - CLOB API doesn't distinguish them
2. **Neg risk conversion logic** - No way to detect or calculate from CLOB data
3. **Redemption tracking** - Never implemented (too complex without events)
4. **AMM trades** - Not in scope (no data source)
5. **Event ordering** - CLOB data lacks blockchain-guaranteed order

---

## Recommendations

### Immediate (Current State - ACCEPTED)

**Continue using pnlEngineV7 (Polymarket API)** as the primary PnL source.

**Rationale:**
- 100% accuracy (15/15 test wallets)
- Polymarket's API uses their subgraph internally
- No maintenance burden
- Fallback to V1 if API unavailable

**Status:** IMPLEMENTED ✓

### Short Term (1-2 weeks)

**Implement ERC1155 event ingestion for splits/merges/redemptions.**

**What to track:**
- ConditionalTokens.PositionSplit → BUY YES+NO at $0.50
- ConditionalTokens.PositionsMerge → SELL YES+NO at $0.50
- ConditionalTokens.PayoutRedemption → SELL at payout price

**Filtering:**
- Skip if stakeholder/redeemer = NegRiskAdapter address
- Skip if stakeholder = CTFExchange address

**Benefits:**
- Captures cost basis for splits/merges
- Tracks redemptions (missing from V1)
- Reduces reliance on CLOB data

**Effort:** 1-2 weeks

### Medium Term (1-2 months)

**Run own Graph node with Polymarket's PnL subgraph.**

**Setup:**
1. Deploy Graph node (Docker)
2. Deploy Polymarket's pnl-subgraph
3. Query UserPosition entities via GraphQL
4. Supplement with real-time CLOB data

**Benefits:**
- Full control over data source
- Same PnL calculation as Polymarket
- Can customize for Cascadian needs
- Fallback if Polymarket API changes

**Effort:** 1-2 months (including monitoring/maintenance setup)

### Long Term (3+ months)

**Hybrid approach: Subgraph + CLOB + ERC1155.**

**Architecture:**
1. Primary: UserPosition entities from subgraph (historical)
2. Real-time: CLOB OrderFilled events (for latency)
3. Validation: Compare subgraph vs CLOB results
4. Edge cases: ERC1155 events for direct token transfers

**Benefits:**
- Best of all worlds
- Sub-second query performance
- Real-time updates
- Full audit trail

**Effort:** 3+ months (requires Graph node + data pipeline + monitoring)

---

## Technical Details

### Files Analyzed

1. **ConditionalTokensMapping.ts** - 5 event handlers (split/merge/redeem/prepare/resolve)
2. **ExchangeMapping.ts** - 1 event handler (OrderFilled for both exchanges)
3. **NegRiskAdapterMapping.ts** - 6 event handlers (adapter-specific operations)
4. **FixedProductMarketMakerMapping.ts** - 4 event handlers (AMM buy/sell/add/remove)
5. **FixedProductMarketMakerFactoryMapping.ts** - 1 event handler (AMM creation)
6. **updateUserPositionWithBuy.ts** - Core buy logic
7. **updateUserPositionWithSell.ts** - Core sell logic
8. **parseOrderFilled.ts** - Trade side detection
9. **schema.graphql** - Entity definitions
10. **subgraph.template.yaml** - Event mappings

### Key Constants

```typescript
COLLATERAL_SCALE = 10^6          // USDC decimals
FIFTY_CENTS = 500000             // $0.50 in 6-decimal format
TradeType.BUY = 0
TradeType.SELL = 1
```

### Entity Relationships

```
UserPosition (id = "{user}-{tokenId}")
  ├─ amount: Current holdings
  ├─ avgPrice: Weighted average cost basis
  ├─ realizedPnl: Cumulative PnL
  └─ totalBought: Lifetime purchases

Condition (id = conditionId)
  ├─ positionIds: [yesTokenId, noTokenId]
  ├─ payoutNumerators: [winAmount, loseAmount]
  └─ payoutDenominator: sum of numerators

NegRiskEvent (id = marketId)
  └─ questionCount: Number of questions

FPMM (id = fpmmAddress)
  └─ conditionId: Associated condition
```

---

## Generated Documentation

Three comprehensive documents have been created:

### 1. POLYMARKET_SUBGRAPH_COMPLETE_ANALYSIS.md (813 lines)

**Contents:**
- Executive summary
- Contract architecture
- Data model (GraphQL schema)
- Event flow diagrams (6 major flows)
- Critical filtering rules
- State management
- PnL calculation formulas
- Trade side detection
- Edge cases
- Complete trade lifecycle
- Query patterns
- Performance considerations
- Comparison to Cascadian
- Recommendations
- File structure
- Key takeaways

### 2. POLYMARKET_SUBGRAPH_EVENT_FLOW_DIAGRAM.md (373 lines)

**Contents:**
- Visual event handler mapping
- All 5 data sources with events
- Core state operations (buy/sell)
- Entity relationships
- Trade type decision tree
- Critical filter rules
- Complete trade lifecycle example
- ASCII diagrams

### 3. POLYMARKET_SUBGRAPH_QUICK_REF.md (400+ lines)

**Contents:**
- Event handler lookup table
- Contract addresses
- Key constants
- Core function definitions
- Trade side detection
- Filter decision tree
- Entity schemas
- GraphQL query examples
- Neg risk conversion formula
- AMM liquidity formulas
- Common pitfalls
- Why Cascadian can't replicate
- Repository structure

---

## Next Steps

1. **Review** - Read the three generated documents
2. **Validate** - Confirm understanding of subgraph architecture
3. **Decide** - Choose recommendation path (immediate/short/medium/long term)
4. **Plan** - If pursuing ERC1155 ingestion or Graph node, create detailed plan
5. **Document** - Update main CLAUDE.md with findings

---

## Key Quotes

> "The subgraph uses FIFO-style average cost basis tracking with two core operations: updateUserPositionWithBuy and updateUserPositionWithSell. This is identical to Cascadian's V1 formula."

> "The subgraph filters out CTFExchange/NegRiskAdapter internal events. Cascadian sees them in CLOB data as real trades."

> "Cascadian relies on CLOB API which contains adapter-generated bookkeeping trades. The subgraph filters these out at the source."

> "Polymarket's subgraph succeeds because it has access to raw blockchain events with proper filtering. Cascadian's CLOB-only approach fails because the API includes internal bookkeeping trades that should be ignored."

---

## Conclusion

The Polymarket PnL subgraph is **straightforward in concept** but **powerful in execution**:

1. **Simple formula** - FIFO weighted average (same as Cascadian V1)
2. **Smart filtering** - Ignores internal bookkeeping events
3. **Complete coverage** - All event types (CLOB, splits, merges, redemptions, AMM, neg risk conversions)
4. **Event ordering** - Blockchain guarantees sequential processing
5. **Real-time updates** - New events update state immediately

**Cascadian's V7 (API-based) approach is the correct decision** given the complexity of replicating subgraph functionality. The alternative (running own Graph node) is viable but requires significant infrastructure investment.

**The V1 (calculated) fallback** is acceptable for non-neg-risk wallets but will never achieve 100% accuracy due to CLOB API limitations.

---

## Files Generated

1. `/Users/scotty/Projects/Cascadian-app/docs/reports/POLYMARKET_SUBGRAPH_COMPLETE_ANALYSIS.md`
2. `/Users/scotty/Projects/Cascadian-app/docs/reports/POLYMARKET_SUBGRAPH_EVENT_FLOW_DIAGRAM.md`
3. `/Users/scotty/Projects/Cascadian-app/docs/reports/POLYMARKET_SUBGRAPH_QUICK_REF.md`
4. `/Users/scotty/Projects/Cascadian-app/docs/reports/POLYMARKET_SUBGRAPH_RESEARCH_SUMMARY.md` (this file)

**Total:** 1,586+ lines of documentation
**Research Duration:** ~2 hours
**Source Files Analyzed:** 10 TypeScript files + 2 YAML/GraphQL configs
