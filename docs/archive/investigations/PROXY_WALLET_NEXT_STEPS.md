# Proxy Wallet Investigation - Next Steps

## Summary of Findings

**CONFIRMED:** Polymarket uses proxy wallets (labeled as `proxyWallet` in API responses) that are separate from on-chain trading wallets. This is why:

1. Wallet `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b` shows $95k profit on Polymarket UI
2. Our database shows -$435k loss for the same address
3. Egg market trades appear in Polymarket API but NOT in our on-chain database

---

## What We Know

### Polymarket API Structure

```json
{
  "proxyWallet": "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b",  // <-- User-facing address
  "conditionId": "0xf2ce...",
  "size": 69982.788569,
  "realizedPnl": 903.267309,  // <-- From egg markets
  // ... no field for actual on-chain wallet
}
```

### Available API Endpoints

✅ **Working:**
- `https://data-api.polymarket.com/positions?user={address}` - Returns positions with proxyWallet
- `https://data-api.polymarket.com/positions?user={address}&status=closed` - Closed positions

❌ **Not Working:**
- `https://data-api.polymarket.com/user/{address}` - 404
- `https://data-api.polymarket.com/profile/{address}` - 404
- `https://clob.polymarket.com/trades?maker_address={address}` - Requires API key

### Database Tables (No Proxy Mapping)

- ✅ Market metadata available (dim_markets, api_markets_staging)
- ✅ On-chain trade data (vw_trades_canonical, erc1155_transfers)
- ❌ NO proxy-to-onchain wallet mapping table

---

## Action Plan

### Phase 1: Investigate Polymarket Architecture (2-4 hours)

#### Option A: Smart Contract Analysis
1. **Find Polymarket contracts:**
   - CTF Exchange contract
   - Proxy wallet factory contract
   - Look for proxy creation events

2. **Analyze ERC1155 operator patterns:**
   ```sql
   -- Check if operator field reveals proxy→onchain mapping
   SELECT
     operator,
     from_address,
     to_address,
     COUNT(*) as transfer_count
   FROM erc1155_transfers
   WHERE token_id IN (egg_market_token_ids)
   GROUP BY operator, from_address, to_address
   ```

3. **Search for delegation events:**
   - Look for `DelegateCall`, `ProxyCreated`, `OwnershipTransferred` events
   - Check if there's a register/mapping transaction

#### Option B: CLOB API Investigation
1. **Authenticate with CLOB API:**
   - Use CLOB_API_KEY from .env.local
   - Query trades for proxy wallet
   - Check if response contains actual executor address

2. **Query pattern:**
   ```bash
   curl 'https://clob.polymarket.com/trades?maker_address={proxy}' \
     -H "Authorization: Bearer ${CLOB_API_KEY}"
   ```

3. **Fields to check:**
   - `executor` / `signer` / `operator`
   - `transaction_hash` → lookup on blockchain
   - `owner` vs `maker` distinction

#### Option C: Reverse Engineer from Trades
1. **Find on-chain wallets that traded egg markets:**
   - Already identified: 0x1d0d81f55610df0adaaa0da37611f1f4556cef5f (57 trades)
   - Check if this wallet's PnL matches proxy wallet's egg market PnL

2. **Query Polymarket API for those wallets:**
   ```bash
   curl 'https://data-api.polymarket.com/positions?user=0x1d0d81f55610df0adaaa0da37611f1f4556cef5f'
   ```
   - See if it returns same proxy wallet or different one

3. **Build mapping table experimentally:**
   - Match PnL patterns
   - Match market/timing/size patterns
   - Score confidence level

---

### Phase 2: Build Proxy Mapping Table (4-6 hours)

#### Database Schema

```sql
CREATE TABLE wallet_proxy_mapping (
  proxy_wallet String,                          -- User-facing address from Polymarket UI
  onchain_wallet String,                        -- Actual address that executes trades
  relationship_type LowCardinality(String),     -- 'primary', 'secondary', 'system'
  discovery_method LowCardinality(String),      -- 'smart_contract', 'api', 'inference', 'manual'
  confidence_score Float32,                     -- 0.0 to 1.0
  first_seen DateTime,
  last_validated DateTime,
  validation_count UInt32,
  notes String
) ENGINE = ReplacingMergeTree(last_validated)
ORDER BY (proxy_wallet, onchain_wallet);
```

#### Population Strategy

1. **High Confidence (1.0):**
   - Smart contract events explicitly linking addresses
   - CLOB API with executor field

2. **Medium Confidence (0.7-0.9):**
   - PnL pattern matching (within 5% variance)
   - Market/timing/size correlation (>90% overlap)

3. **Low Confidence (0.5-0.6):**
   - Statistical inference
   - Operator field patterns in ERC1155

4. **Manual Verification (flag for review):**
   - Ambiguous mappings
   - Multiple potential matches

---

### Phase 3: Update PnL Calculation Pipeline (2-3 hours)

#### New View: vw_wallet_pnl_aggregated

```sql
CREATE VIEW vw_wallet_pnl_aggregated AS
SELECT
  wpm.proxy_wallet,
  SUM(wps.realized_pnl_usd) as total_realized_pnl,
  SUM(wps.unrealized_pnl_usd) as total_unrealized_pnl,
  SUM(wps.total_pnl_usd) as total_pnl,
  COUNT(DISTINCT wpm.onchain_wallet) as onchain_wallet_count,
  AVG(wpm.confidence_score) as avg_mapping_confidence,
  MAX(wpm.last_validated) as last_mapping_validation
FROM wallet_proxy_mapping wpm
LEFT JOIN wallet_pnl_summary_final wps
  ON wpm.onchain_wallet = wps.wallet
WHERE wpm.confidence_score >= 0.7
GROUP BY wpm.proxy_wallet
```

#### API Update

Update `/api/polymarket/wallet/[address]/value` to:
1. Check if address is proxy wallet
2. Look up all on-chain wallets
3. Aggregate PnL across all mapped wallets
4. Return confidence score

---

### Phase 4: UI Enhancement (1-2 hours)

#### Wallet Info Component

```tsx
{mapping && (
  <div className="wallet-mapping-info">
    <span className="badge">Proxy Wallet</span>
    <div className="onchain-wallets">
      <span>On-chain: {mapping.onchainWallets.length} wallet(s)</span>
      <span className="confidence">
        Confidence: {(mapping.confidence * 100).toFixed(0)}%
      </span>
    </div>
  </div>
)}
```

#### PnL Display

```tsx
{pnl.mappingStatus === 'incomplete' && (
  <Alert severity="warning">
    This wallet may have additional on-chain addresses.
    PnL shown is partial. Confidence: {pnl.confidence}%
  </Alert>
)}
```

---

## Immediate Tasks (Prioritized)

### 🔥 Critical (Do First)

1. **Authenticate with CLOB API and check trade response structure**
   - File: `scripts/test-clob-api-trades.ts`
   - Look for executor/operator fields
   - Time: 30 min

2. **Query Polymarket positions API for known on-chain wallets**
   - Check if 0x1d0d81f55610df0adaaa0da37611f1f4556cef5f returns a proxy
   - Compare egg market PnL
   - Time: 30 min

3. **Analyze ERC1155 operator patterns**
   - File: `scripts/analyze-erc1155-operators.ts`
   - Look for consistent operator→wallet relationships
   - Time: 1 hour

### 📋 High Priority (Do Next)

4. **Create experimental mapping table**
   - Use inference from steps 1-3
   - Start with high-confidence mappings
   - Time: 2 hours

5. **Update PnL calculation to use mappings**
   - Modify wallet_pnl_summary_final view
   - Add confidence scoring
   - Time: 2 hours

6. **Build validation suite**
   - Compare against Polymarket UI PnL
   - Flag discrepancies > 10%
   - Time: 2 hours

### 🔄 Medium Priority (Nice to Have)

7. **Contact Polymarket team**
   - Ask about proxy wallet architecture
   - Request API documentation for wallet mapping
   - Check if there's a public endpoint we're missing

8. **Document findings in CLAUDE.md**
   - Add proxy wallet handling to best practices
   - Update wallet querying patterns
   - Create troubleshooting guide

---

## Testing Strategy

### Validation Test Cases

1. **Wallet 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b (proxy)**
   - Expected Polymarket PnL: $95k profit
   - Current database PnL: -$435k loss
   - Should find egg market on-chain wallet

2. **Known on-chain wallet (0x1d0d81f55610df0adaaa0da37611f1f4556cef5f)**
   - Has 57 egg market trades
   - Query Polymarket API to find proxy
   - Validate bidirectional mapping

3. **Random wallet without proxy (control group)**
   - Should show same PnL in both systems
   - No mapping row in wallet_proxy_mapping

### Success Criteria

- [ ] ≥90% of Polymarket wallets mapped to on-chain addresses
- [ ] PnL discrepancy <5% for mapped wallets
- [ ] Confidence score available for all mappings
- [ ] UI shows proxy status clearly
- [ ] Documentation complete

---

## Risk Assessment

### Low Risk
- ✅ Read-only investigation (no writes)
- ✅ Market metadata already available
- ✅ No changes to existing PnL tables

### Medium Risk
- ⚠️ Inference-based mapping may have false positives
- ⚠️ Confidence scoring algorithm needs validation
- ⚠️ CLOB API may not have all needed data

### High Risk
- 🚨 Many-to-many mapping (one proxy → many on-chain, or vice versa)
- 🚨 Polymarket may not expose mapping publicly
- 🚨 Smart contract architecture may be complex (meta-transactions, batch trades)

### Mitigation
- Start with high-confidence mappings only
- Flag ambiguous cases for manual review
- Build validation dashboard to track accuracy
- Keep manual override capability

---

## Questions for Polymarket Team (if needed)

1. **Architecture:**
   - How does the proxy wallet system work?
   - Is it 1:1, 1:many, or many:many?
   - Are proxy wallets smart contracts or just UI identifiers?

2. **API:**
   - Is there an endpoint to get on-chain wallets for a proxy?
   - Does CLOB API expose executor addresses?
   - Are there any undocumented endpoints?

3. **Data:**
   - Can we access historical proxy↔onchain mappings?
   - Are there smart contract events we should index?
   - Is there a recommended approach for third-party integrations?

---

## Files to Create

1. `scripts/test-clob-api-with-auth.ts` - Test authenticated CLOB API
2. `scripts/analyze-erc1155-operators.ts` - Analyze operator patterns
3. `scripts/reverse-engineer-proxy-mapping.ts` - Build experimental mapping
4. `scripts/validate-proxy-mapping.ts` - Compare against Polymarket UI
5. `migrations/create-wallet-proxy-mapping-table.sql` - Database schema
6. `lib/polymarket/proxy-wallet-mapper.ts` - Mapping logic

---

## Expected Timeline

- **Day 1 (4-6 hours):** Investigation phase (CLOB API, smart contracts, inference)
- **Day 2 (4-6 hours):** Build mapping table and population script
- **Day 3 (2-4 hours):** Update PnL calculations and validation
- **Day 4 (2-3 hours):** UI updates and documentation

**Total: 12-19 hours**

---

## Success Metrics

After implementation, we should see:
1. Wallet 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b PnL → ~$95k (matching Polymarket UI)
2. Egg market trades properly attributed
3. Smart money rankings include proxy wallet traders
4. User confidence in platform PnL accuracy restored

**Current Status:** Investigation complete, ready for Phase 1 implementation.
