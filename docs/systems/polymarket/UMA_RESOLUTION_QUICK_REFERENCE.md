# UMA CTF Adapter - Quick Reference Guide

**For:** PnL calculations, market resolution queries, payout verification
**Last Updated:** 2025-11-12
**Full Reference:** [UMA_CTF_ADAPTER_RESEARCH.md](./UMA_CTF_ADAPTER_RESEARCH.md)

---

## Oracle Price → Payout Mapping (THE CORE)

```
Oracle Response  | Payout Array | Outcome
=================================================
0                | [0, 1]       | NO wins 100%
0.5 ether        | [1, 1]       | 50/50 tie
1 ether          | [1, 0]       | YES wins 100%
type(int256).min | N/A          | RESET (ignore price)
anything else    | REVERT       | ERROR
```

**For ClickHouse:**
```sql
-- Map oracle prices to outcomes
SELECT
    market_id,
    oracle_price,
    CASE oracle_price
        WHEN 0 THEN 'NO'
        WHEN 500000000000000000 THEN 'TIE'
        WHEN 1000000000000000000 THEN 'YES'
        ELSE 'INVALID'
    END as outcome
```

---

## ID Derivation (For Lookups)

```solidity
// In smart contract
questionID = keccak256(ancillaryData + ",initializer:" + address)

// In database
condition_id = keccak256(oracle_address || questionID || 2)
```

**In TypeScript/Node:**
```typescript
const keccak256 = require('js-sha3').keccak256;

// Question ID
const questionID = '0x' + keccak256(ancillaryData);

// Condition ID
const oracle = '0x...'; // UMA adapter address
const conditionID = '0x' + keccak256(
    oracle.slice(2) + 
    questionID.slice(2) + 
    '2'.padStart(64, '0')
);
```

---

## Event Monitoring

**Market Created:**
```
QuestionInitialized(questionID, ancillaryData, reward)
→ Extract questionID and ancillaryData
→ Compute conditionID locally
```

**Market Resolved:**
```
QuestionResolved(questionID, price, payouts)
→ price ∈ {0, 0.5e18, 1e18}
→ payouts ∈ {[0,1], [1,1], [1,0]}
→ Trigger PnL recalculation
```

**Dispute Occurred:**
```
QuestionReset(questionID)
→ requestTimestamp updated
→ New price request sent
→ Mark as disputed in database
```

---

## Ready to Resolve Check

```solidity
// Check if market can be resolved
if (adapter.ready(questionID)) {
    // Call resolve() now
    adapter.resolve(questionID);
    // This triggers QuestionResolved event
}
```

**Or with Ethers.js:**
```typescript
const ready = await adapter.ready(questionID);
if (ready) {
    const tx = await adapter.resolve(questionID);
    const receipt = await tx.wait();
    // Extract QuestionResolved event from receipt
}
```

---

## Payout → Token Redemption

**For wallets holding position tokens:**

```
If payouts = [1, 0]:  (YES wins)
  - YES token holder redeems: amount * (1/2) = 50% of collateral
  - NO token holder redeems: amount * (0/2) = 0

If payouts = [0, 1]:  (NO wins)
  - YES token holder redeems: amount * (0/2) = 0
  - NO token holder redeems: amount * (1/2) = 50% of collateral

If payouts = [1, 1]:  (Tie)
  - YES token holder redeems: amount * (1/2) = 50% of collateral
  - NO token holder redeems: amount * (1/2) = 50% of collateral
```

**Note:** Denominator is always 2 (array length). For 3-outcome markets it would be 3, etc.

---

## Database Schema Essentials

**Market Resolutions Table:**
```
market_id (String)           → Link to Polymarket
condition_id (FixedString(64))  → 32-byte hex (lowercase)
question_id (FixedString(64))   → keccak256 hash
oracle_price (Decimal)       → 0, 0.5, or 1 (stored as WEI)
payout_yes, payout_no (UInt8)  → 0 or 1
resolution_status (Enum)     → pending | resolved | disputed | dvm_escalated
resolved_timestamp (DateTime) → When QuestionResolved fired
```

**Lookups:**
```sql
-- Find resolution for a market
SELECT * FROM market_resolutions 
WHERE market_id = 'MARKET_123'
LIMIT 1;

-- Find all resolved markets
SELECT * FROM market_resolutions
WHERE resolution_status = 'resolved'
ORDER BY resolved_timestamp DESC;

-- Find disputed markets (need manual intervention)
SELECT * FROM market_resolutions
WHERE resolution_status IN ('disputed', 'dvm_escalated');
```

---

## Common Queries

**"Is market X resolved?"**
```sql
SELECT resolution_status, oracle_price, payout_yes, payout_no
FROM market_resolutions
WHERE market_id = 'MARKET_ID'
```

**"When was market resolved?"**
```sql
SELECT resolved_timestamp FROM market_resolutions
WHERE market_id = 'MARKET_ID'
```

**"How many disputes happened?"**
```sql
SELECT dispute_count FROM market_resolutions
WHERE market_id = 'MARKET_ID'
```

**"What were the payouts?"**
```sql
SELECT payout_yes, payout_no FROM market_resolutions
WHERE condition_id = 'CONDITION_ID_HEX'
```

---

## Timeline Reference

| Event | Duration | Action |
|-------|----------|--------|
| Market created | T+0 | QuestionInitialized emitted |
| Price request sent | T+0 | Oracle starts liveness timer |
| Liveness period | T+0 to T+2h | Proposer responds, disputes possible |
| First dispute | T+2h | priceDisputed() called → QuestionReset |
| Second request | T+2h to T+4h | New liveness period begins |
| Second dispute | T+4h | Escalates to DVM (48-72 hours) |
| DVM resolution | T+4h to T+72h | Data Verification Mechanism votes |
| Market resolvable | Once price settled | Call resolve() → QuestionResolved |

---

## Data Safety Rules

**NEVER:**
- Assume unpaired questionID = conditionID
- Trust oracle_price without validation (must be 0, 0.5, or 1)
- Resolve same market twice (guard: `!data.resolved`)
- Use payouts without checking `isValidPayoutArray()`

**ALWAYS:**
- Verify QuestionResolved event was emitted before updating PnL
- Cross-check payout arrays: must be exactly 2 elements
- Handle ignore price (`type(int256).min`) → triggers reset
- Track dispute counts for manual intervention scenarios

---

## Integration Checklist (By Priority)

**P0 (This Week):**
- [ ] Set up event listener for QuestionInitialized
- [ ] Create market_resolutions table
- [ ] Implement oracle_price → payout mapping

**P1 (Next 2 Weeks):**
- [ ] Build questionID ↔ market_id mapper
- [ ] Implement ready() polling
- [ ] Add QuestionResolved event handler

**P2 (Next Month):**
- [ ] Dispute tracking and DVM escalation alerts
- [ ] CTF settlement verification
- [ ] Automated PnL recalculation trigger

---

## External References

- **Repository:** https://github.com/Polymarket/uma-ctf-adapter
- **UMA Docs:** https://docs.uma.xyz/
- **UMA Optimistic Oracle V2:** https://github.com/UMAprotocol/protocol
- **Conditional Tokens:** https://docs.gnosis.io/safe/docs/contracts/Conditional_Tokens/

---

**For detailed explanation, see:** [UMA_CTF_ADAPTER_RESEARCH.md](./UMA_CTF_ADAPTER_RESEARCH.md)

