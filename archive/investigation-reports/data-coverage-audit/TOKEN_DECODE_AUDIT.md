# Token Decode Audit - ERC1155 Condition ID Extraction

**Date:** 2025-11-12
**Mission:** Verify our ERC-1155 token decode logic against Polymarket's ground truth

---

## Our Current Decoder

**Source:** `scripts/CRITICAL-rebuild-ctf-token-map.ts` (lines 25-26)

```typescript
// Extract from ERC-1155 token_id (256-bit uint):
condition_id_norm = lower(hex(bitShiftRight(toUInt256(asset_id), 8)))
outcome_index     = toUInt8(bitAnd(toUInt256(asset_id), 255))
```

### Bit Layout (Our Implementation):
```
256-bit token_id (asset_id):
┌─────────────────────────────┬──────────────┐
│   Upper 248 bits            │ Lower 8 bits │
│   (condition_id)            │ (outcome)    │
└─────────────────────────────┴──────────────┘
         >> 8 bits            & 0xFF

Extraction:
- condition_id = token_id >> 8  (shift right 8 bits, take remaining)
- outcome_index = token_id & 0xFF (mask last 8 bits)
```

### Example from Production Data:

**Token ID:** `100000293804690815023609597660894660801582658691499546225810764430851148723524`

**Decoded:**
- condition_id_norm (hex): `dd162918825355fccf4f78f8dd584f6d1d03c1106406152b2f7aaa8fc119b5`
- outcome_index: `68`

**Verification (manual):**
```python
token_id = 100000293804690815023609597660894660801582658691499546225810764430851148723524
condition_id = token_id >> 8
outcome = token_id & 0xFF

# Result:
# condition_id (hex): dd162918825355fccf4f78f8dd584f6d1d03c1106406152b2f7aaa8fc119b5
# outcome: 68 (0x44)
```

---

## Polymarket's Reference Implementation

### Sources to Check:

1. **neg-risk-ctf-adapter**
   - Repo: https://github.com/Polymarket/neg-risk-ctf-adapter
   - Purpose: CTF adapter for negative risk CTF markets
   - Key files to examine:
     - Token encoding/decoding logic
     - Position ID generation
     - Outcome index mapping

2. **uma-ctf-adapter-sdk**
   - Package: `@polymarket/uma-ctf-adapter-sdk`
   - Purpose: SDK for UMA CTF adapter contracts
   - Key functionality:
     - conditionId computation
     - Token ID generation for YES/NO outcomes
     - Market resolution handling

3. **CTF Exchange (CLOB)**
   - Official docs: https://docs.polymarket.com/
   - API docs for asset_id format
   - Token ID structure documentation

---

## Questions to Answer:

1. **Is our bit layout correct?**
   - Does Polymarket use `token_id >> 8` for condition_id?
   - Or is there a different encoding scheme?

2. **Are there multiple token formats?**
   - Binary vs categorical markets?
   - Neg-risk vs standard CTF?
   - Legacy vs current format?

3. **What about the missing "00" prefix?**
   - Our condition_ids: `dd162918825355...` (62 chars)
   - Resolution condition_ids: `0000a3aa2ac9a9...`, `0001bd6b1ce49b...` (64 chars)
   - Is padding the issue, or are these different market types?

4. **Is there a market_id → condition_id mapping required?**
   - Our ctf_token_map has empty market_id fields
   - Do we need to query Gamma API to populate this?

---

## Next Steps:

### A. Fetch Polymarket Reference Code

Use WebFetch or search GitHub for:
1. neg-risk-ctf-adapter token encoding
2. uma-ctf-adapter-sdk condition ID computation
3. Official Polymarket docs on asset_id format

### B. Build Verification Harness

Pick 3-5 real markets from Polymarket UI:
1. Get their expected condition_id from Gamma API
2. Get the CLOB fill asset_id for a trade on that market
3. Run our decoder vs Polymarket's decoder
4. Compare results

### C. Test on Known Markets

**Good test candidates:**
- Biden market (already have response data)
- Recent high-volume binary markets
- Compare:
  - Our decoded condition_id
  - Gamma API's condition_id
  - Resolution data's condition_id

---

## Hypothesis:

**Our decoder might be extracting the wrong portion of token_id**

Evidence:
- Our condition_ids start with `00dd`, `00161c`, `0022`
- Resolution condition_ids start with `0000`, `0001`, `0002`
- This suggests different bit ranges or encoding schemes

**Alternative possibilities:**
1. Token IDs have changed format over time
2. Neg-risk markets use different encoding
3. We need collectionId + positionId, not just shift
4. There's a market_id lookup required first

---

**Status:** Ready to cross-check against Polymarket reference implementations
