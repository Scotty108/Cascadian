# Polymarket Subgraph PnL Formula Flow

**Visual Reference for Formula Application**

---

## Buy Operation Flow

```
┌─────────────────────────────────────────────────────────────┐
│ BUY EVENT (OrderFilled / FPMMBuy / PositionSplit)           │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ INPUT VALIDATION                                             │
│ • amount > 0?  → Yes: continue, No: skip                    │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ LOAD OR CREATE UserPosition                                 │
│ • If new: amount=0, avgPrice=0, realizedPnl=0              │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ UPDATE AVERAGE PRICE (Weighted)                             │
│                                                              │
│   numerator = (avgPrice_old × amount_old) + (price × buyAmount) │
│   denominator = amount_old + buyAmount                      │
│   avgPrice_new = numerator / denominator                    │
│                                                              │
│ Example:                                                     │
│   Old: 100 shares @ $0.60 avg                               │
│   Buy: 50 shares @ $0.80                                    │
│   New avgPrice = (60¢×100 + 80¢×50) / 150 = 66.67¢         │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ UPDATE POSITION AMOUNT                                       │
│   amount_new = amount_old + buyAmount                       │
│                                                              │
│ Example: 100 + 50 = 150 shares                              │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ UPDATE TOTAL BOUGHT                                          │
│   totalBought_new = totalBought_old + buyAmount             │
│                                                              │
│ (Never decreases - cumulative acquisition tracker)          │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ REALIZED PNL: NO CHANGE                                      │
│   realizedPnl_new = realizedPnl_old                         │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ SAVE UserPosition                                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Sell Operation Flow

```
┌─────────────────────────────────────────────────────────────┐
│ SELL EVENT (OrderFilled / FPMMSell / Merge / Redemption)    │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ LOAD OR CREATE UserPosition                                 │
│ • Get current: amount, avgPrice, realizedPnl               │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ INVENTORY GUARD (Critical!)                                  │
│                                                              │
│   if (sellAmount > amount_tracked):                         │
│       adjustedAmount = amount_tracked                       │
│   else:                                                      │
│       adjustedAmount = sellAmount                           │
│                                                              │
│   adjustedAmount = min(sellAmount, amount_tracked)          │
│                                                              │
│ Example:                                                     │
│   Tracked: 100 shares                                       │
│   Sell request: 150 shares (user got 50 via transfer)      │
│   Adjusted: 100 shares (only track what we know about)     │
│                                                              │
│ WHY: User may have received tokens via direct ERC1155       │
│      Transfer events that aren't tracked by subgraph        │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ CALCULATE REALIZED PNL                                       │
│                                                              │
│   ΔrealizedPnL = adjustedAmount × (sellPrice - avgPrice)   │
│                  ÷ COLLATERAL_SCALE                         │
│                                                              │
│   ΔrealizedPnL = adjustedAmount × (sellPrice - avgPrice)   │
│                  ÷ 1,000,000                                │
│                                                              │
│ Example:                                                     │
│   Sell: 100 shares @ $0.75                                  │
│   Avg cost: $0.60                                           │
│   Profit: 100 × (0.75 - 0.60) = $15.00                     │
│                                                              │
│ Internal units:                                              │
│   ΔrealizedPnL = 100,000,000 × (750,000 - 600,000)         │
│                  ÷ 1,000,000                                │
│                = 100,000,000 × 150,000 ÷ 1,000,000         │
│                = 15,000,000 (= $15.00)                      │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ UPDATE REALIZED PNL                                          │
│   realizedPnl_new = realizedPnl_old + ΔrealizedPnL         │
│                                                              │
│ (Cumulative - each sell adds to running total)              │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ UPDATE POSITION AMOUNT                                       │
│   amount_new = amount_old - adjustedAmount                  │
│                                                              │
│ Example: 150 - 100 = 50 shares remaining                    │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ AVERAGE PRICE: NO CHANGE                                     │
│   avgPrice_new = avgPrice_old                               │
│                                                              │
│ Cost basis stays the same until next buy                    │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ TOTAL BOUGHT: NO CHANGE                                      │
│   totalBought_new = totalBought_old                         │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ SAVE UserPosition                                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Complete Trading Lifecycle Example

```
SCENARIO: Trader activity on single position over time

═══════════════════════════════════════════════════════════════════════

EVENT 1: BUY 100 shares @ $0.60
─────────────────────────────────────────────────────────────────────
BEFORE:  amount=0, avgPrice=$0, realizedPnl=$0, totalBought=0

PROCESS:
  avgPrice = (0×0 + 600,000×100,000,000) / 100,000,000 = 600,000
  amount = 0 + 100,000,000 = 100,000,000
  totalBought = 0 + 100,000,000 = 100,000,000
  realizedPnl = 0 (no change)

AFTER:   amount=100, avgPrice=$0.60, realizedPnl=$0, totalBought=100

═══════════════════════════════════════════════════════════════════════

EVENT 2: BUY 50 shares @ $0.80
─────────────────────────────────────────────────────────────────────
BEFORE:  amount=100, avgPrice=$0.60, realizedPnl=$0, totalBought=100

PROCESS:
  avgPrice = (600,000×100,000,000 + 800,000×50,000,000) / 150,000,000
           = (60,000,000,000,000 + 40,000,000,000,000) / 150,000,000
           = 100,000,000,000,000 / 150,000,000
           = 666,666 ($0.666666...)
  amount = 100,000,000 + 50,000,000 = 150,000,000
  totalBought = 100,000,000 + 50,000,000 = 150,000,000
  realizedPnl = 0 (no change)

AFTER:   amount=150, avgPrice=$0.67, realizedPnl=$0, totalBought=150

═══════════════════════════════════════════════════════════════════════

EVENT 3: SELL 80 shares @ $0.90
─────────────────────────────────────────────────────────────────────
BEFORE:  amount=150, avgPrice=$0.67, realizedPnl=$0, totalBought=150

PROCESS:
  adjustedAmount = min(80,000,000, 150,000,000) = 80,000,000
  ΔrealizedPnl = 80,000,000 × (900,000 - 666,666) / 1,000,000
               = 80,000,000 × 233,334 / 1,000,000
               = 18,666,720 ($18.67)
  realizedPnl = 0 + 18,666,720 = 18,666,720
  amount = 150,000,000 - 80,000,000 = 70,000,000
  avgPrice = 666,666 (no change)
  totalBought = 150,000,000 (no change)

AFTER:   amount=70, avgPrice=$0.67, realizedPnl=$18.67, totalBought=150

═══════════════════════════════════════════════════════════════════════

EVENT 4: RECEIVE 30 shares via TRANSFER (not tracked!)
─────────────────────────────────────────────────────────────────────
REALITY: User now has 100 shares in wallet (70 + 30)
TRACKED: amount=70, avgPrice=$0.67, realizedPnl=$18.67, totalBought=150

PROCESS:
  (No event handler fires - Transfer not tracked)

AFTER:   amount=70, avgPrice=$0.67, realizedPnl=$18.67, totalBought=150
         (Subgraph doesn't know about the 30 shares!)

═══════════════════════════════════════════════════════════════════════

EVENT 5: SELL 100 shares @ $0.85 (70 tracked + 30 untracked)
─────────────────────────────────────────────────────────────────────
BEFORE:  amount=70, avgPrice=$0.67, realizedPnl=$18.67, totalBought=150

PROCESS:
  ★ INVENTORY GUARD ACTIVATES ★
  adjustedAmount = min(100,000,000, 70,000,000) = 70,000,000
  (Sell clamped to tracked amount - ignoring 30 untracked shares)

  ΔrealizedPnl = 70,000,000 × (850,000 - 666,666) / 1,000,000
               = 70,000,000 × 183,334 / 1,000,000
               = 12,833,380 ($12.83)
  realizedPnl = 18,666,720 + 12,833,380 = 31,500,100
  amount = 70,000,000 - 70,000,000 = 0
  avgPrice = 666,666 (no change)
  totalBought = 150,000,000 (no change)

AFTER:   amount=0, avgPrice=$0.67, realizedPnl=$31.50, totalBought=150

REALITY: User actually sold 100 shares (30 more than tracked)
         But PnL only counted for the 70 tracked shares
         The 30 untracked shares generated $0 PnL (as desired)

═══════════════════════════════════════════════════════════════════════

FINAL STATE SUMMARY:
─────────────────────────────────────────────────────────────────────
Tracked Buys:     150 shares @ $0.67 avg = $100.00 cost
Tracked Sells:    150 shares (80 @ $0.90, 70 @ $0.85) = $131.50 proceeds
Realized PnL:     $31.50 profit ✓

Untracked:        30 shares received, 30 sold → $0 PnL impact ✓
```

---

## Price Calculation by Event Type

```
┌──────────────────────────────────────────────────────────────────┐
│ EXCHANGE ORDER FILLED                                            │
├──────────────────────────────────────────────────────────────────┤
│ price = (quoteAmount × 1,000,000) / baseAmount                  │
│                                                                  │
│ Example:                                                         │
│   User trades 100 tokens for 65 USDC                            │
│   quoteAmount = 65,000,000 (65 USDC in 6 decimals)             │
│   baseAmount = 100,000,000 (100 tokens in 6 decimals)          │
│   price = (65,000,000 × 1,000,000) / 100,000,000               │
│         = 650,000 ($0.65)                                       │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ FPMM BUY                                                         │
├──────────────────────────────────────────────────────────────────┤
│ price = (investmentAmount × 1,000,000) / outcomeTokensBought   │
│                                                                  │
│ Example:                                                         │
│   User spends 42 USDC, receives 60 tokens from AMM             │
│   investmentAmount = 42,000,000                                 │
│   outcomeTokensBought = 60,000,000                              │
│   price = (42,000,000 × 1,000,000) / 60,000,000                │
│         = 700,000 ($0.70)                                       │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ FPMM SELL                                                        │
├──────────────────────────────────────────────────────────────────┤
│ price = (returnAmount × 1,000,000) / outcomeTokensSold         │
│                                                                  │
│ Example:                                                         │
│   User sells 50 tokens, receives 38 USDC from AMM              │
│   returnAmount = 38,000,000                                     │
│   outcomeTokensSold = 50,000,000                                │
│   price = (38,000,000 × 1,000,000) / 50,000,000                │
│         = 760,000 ($0.76)                                       │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ POSITION SPLIT                                                   │
├──────────────────────────────────────────────────────────────────┤
│ price = FIFTY_CENTS = 500,000 ($0.50)                          │
│                                                                  │
│ Both YES and NO outcomes treated as buy @ $0.50                │
│ (User deposits 1 USDC collateral, receives 1 YES + 1 NO)       │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ POSITIONS MERGE                                                  │
├──────────────────────────────────────────────────────────────────┤
│ price = FIFTY_CENTS = 500,000 ($0.50)                          │
│                                                                  │
│ Both YES and NO outcomes treated as sell @ $0.50               │
│ (User burns 1 YES + 1 NO, receives 1 USDC collateral)          │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ PAYOUT REDEMPTION                                                │
├──────────────────────────────────────────────────────────────────┤
│ price = (payoutNumerator × 1,000,000) / payoutDenominator      │
│                                                                  │
│ Binary YES wins:                                                 │
│   payoutNumerators = [1, 0]                                     │
│   payoutDenominator = 1                                         │
│   YES price = (1 × 1,000,000) / 1 = 1,000,000 ($1.00)         │
│   NO price = (0 × 1,000,000) / 1 = 0 ($0.00)                  │
│                                                                  │
│ Binary NO wins:                                                  │
│   payoutNumerators = [0, 1]                                     │
│   payoutDenominator = 1                                         │
│   YES price = 0 ($0.00)                                         │
│   NO price = 1,000,000 ($1.00)                                 │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ POSITIONS CONVERTED (NegRisk)                                    │
├──────────────────────────────────────────────────────────────────┤
│ Step 1: Calculate average NO price across questions             │
│   avgNoPrice = sum(userPosition.avgPrice for NO) / noCount     │
│                                                                  │
│ Step 2: Compute YES price from NO prices                        │
│   yesPrice = (avgNoPrice × noCount                              │
│             - 1,000,000 × (noCount - 1))                        │
│             / (questionCount - noCount)                         │
│                                                                  │
│ Step 3: Sell NO at avgNoPrice, Buy YES at yesPrice             │
│                                                                  │
│ Result: Usually ~$0 realized PnL (sell at cost basis)          │
└──────────────────────────────────────────────────────────────────┘
```

---

## State Transitions

```
┌─────────────────────────────────────────────────────────────────┐
│ UserPosition State Machine                                      │
└─────────────────────────────────────────────────────────────────┘

                    ┌────────────────┐
                    │  NONEXISTENT   │
                    │  (not created) │
                    └────────┬───────┘
                             │
                    First Buy or Sell
                             │
                             ↓
                    ┌────────────────┐
                    │   INITIALIZED  │
                    │ amount=0       │
                    │ avgPrice=0     │
                    │ realizedPnl=0  │
                    │ totalBought=0  │
                    └────────┬───────┘
                             │
                      BUY EVENT
                             │
                             ↓
                    ┌────────────────┐
                    │   LONG         │
                    │ amount>0       │
          ┌─────────┤ avgPrice>0     ├──────────┐
          │         │ realizedPnl=?  │          │
      BUY │         │ totalBought>0  │          │ SELL
          │         └────────────────┘          │
          │                  ↑                  │
          │                  │                  │
          └──────────────────┘                  ↓
                             │         ┌────────────────┐
                        SELL │         │  LONG (reduced)│
                             │         │ amount>0       │
                             │         │ avgPrice same  │
                             │         │ realizedPnl↑   │
                             │         │ totalBought↑   │
                             │         └────────┬───────┘
                             │                  │
                        SELL ALL                │
                             │                  │
                             ↓                  │
                    ┌────────────────┐          │
                    │   FLAT         │          │
                    │ amount=0       │ ←────────┘
                    │ avgPrice>0     │   SELL ALL
                    │ realizedPnl>0  │
                    │ totalBought>0  │
                    └────────┬───────┘
                             │
                      BUY EVENT
                             │
                             ↓
                    ┌────────────────┐
                    │ LONG (reopened)│
                    │ amount>0       │
                    │ avgPrice=new   │
                    │ realizedPnl=old│
                    │ totalBought↑   │
                    └────────────────┘

Note: avgPrice recalculates when reopening position
      realizedPnl persists across position closures
      totalBought is lifetime cumulative
```

---

## Edge Cases

```
┌─────────────────────────────────────────────────────────────────┐
│ EDGE CASE 1: First Sell Before Any Buy                          │
├─────────────────────────────────────────────────────────────────┤
│ SCENARIO: User receives tokens via Transfer (not tracked)       │
│           Then tries to sell them                               │
│                                                                  │
│ STATE: amount=0, avgPrice=0, realizedPnl=0                      │
│ EVENT: SELL 50 @ $0.75                                          │
│                                                                  │
│ PROCESS:                                                         │
│   adjustedAmount = min(50,000,000, 0) = 0                      │
│   ΔrealizedPnl = 0 × (750,000 - 0) / 1,000,000 = 0            │
│   realizedPnl = 0 + 0 = 0                                       │
│   amount = 0 - 0 = 0                                            │
│                                                                  │
│ RESULT: No-op (no PnL impact, correct behavior)                │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ EDGE CASE 2: Sell More Than Tracked                             │
├─────────────────────────────────────────────────────────────────┤
│ SCENARIO: User has 100 tracked + 50 untracked shares            │
│           Tries to sell 150                                     │
│                                                                  │
│ STATE: amount=100, avgPrice=$0.60, realizedPnl=$0              │
│ EVENT: SELL 150 @ $0.80                                         │
│                                                                  │
│ PROCESS:                                                         │
│   adjustedAmount = min(150,000,000, 100,000,000) = 100,000,000│
│   ΔrealizedPnl = 100,000,000 × (800,000 - 600,000) / 1,000,000│
│                = 20,000,000 ($20.00)                           │
│   realizedPnl = 0 + 20,000,000 = 20,000,000                    │
│   amount = 100,000,000 - 100,000,000 = 0                       │
│                                                                  │
│ RESULT: Only tracked shares generate PnL ✓                     │
│         Untracked 50 shares → $0 PnL ✓                         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ EDGE CASE 3: Zero Amount Buy/Sell                               │
├─────────────────────────────────────────────────────────────────┤
│ SCENARIO: Event with amount=0                                   │
│                                                                  │
│ BUY with amount=0:                                               │
│   if (amount.gt(BigInt.zero())) → false                        │
│   RESULT: No-op (entire function skipped)                       │
│                                                                  │
│ SELL with amount=0:                                              │
│   adjustedAmount = min(0, position.amount) = 0                 │
│   ΔrealizedPnl = 0 × (price - avgPrice) / 1,000,000 = 0       │
│   RESULT: No change to any fields                              │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ EDGE CASE 4: Reopening Closed Position                          │
├─────────────────────────────────────────────────────────────────┤
│ SCENARIO: Sell all shares, then buy again later                 │
│                                                                  │
│ STATE 1: amount=100, avgPrice=$0.60, realizedPnl=$10           │
│ EVENT A: SELL 100 @ $0.70                                       │
│   ΔrealizedPnl = 100 × (0.70 - 0.60) = $10                    │
│   STATE 2: amount=0, avgPrice=$0.60, realizedPnl=$20          │
│                                                                  │
│ EVENT B: BUY 50 @ $0.65                                         │
│   avgPrice_new = (0.60×0 + 0.65×50) / 50 = $0.65              │
│   STATE 3: amount=50, avgPrice=$0.65, realizedPnl=$20         │
│                                                                  │
│ RESULT: avgPrice recalculates from $0 base                     │
│         realizedPnl preserved ($20 not reset)                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Quick Debugging Checklist

When PnL doesn't match expected:

```
□ Check if inventory guard activated (sell > tracked position)
□ Verify avgPrice is weighted average, not FIFO
□ Confirm PnL realized at sell time, not redemption
□ Check for untracked Transfer events (not indexed)
□ Verify COLLATERAL_SCALE division (1,000,000)
□ Check for integer truncation in division
□ Confirm split/merge at $0.50 (not market price)
□ Verify redemption uses payout numerator/denominator
□ Check NegRisk conversion uses avgNoPrice (not market)
□ Confirm position amount never goes negative (guard)
```

---

**Files:**
- Full Analysis: `/docs/reports/POLYMARKET_SUBGRAPH_PNL_ANALYSIS.md`
- Formula Reference: `/docs/systems/pnl/POLYMARKET_SUBGRAPH_PNL_FORMULAS.md`
- This Document: `/docs/systems/pnl/POLYMARKET_SUBGRAPH_FORMULA_FLOW.md`
