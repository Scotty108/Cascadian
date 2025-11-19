# Pipeline Quick Start Guide

## 🚀 One-Command Execution

```bash
# Set your ClickHouse credentials
export CLICKHOUSE_HOST="https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443"
export CLICKHOUSE_USER="default"
export CLICKHOUSE_PASSWORD="8miOkWI~OhsDb"
export CLICKHOUSE_DATABASE="default"
export CONDITIONAL_TOKENS="0x4d97dcd97ec945f40cf65f87097ace5ea0476045"

# Run the complete pipeline
./scripts/run-pipeline-complete.sh
```

---

## 📋 What Gets Executed

The pipeline runs 7 sequential steps in order:

### Step 1: Build EOA → Proxy Mapping
```bash
npx tsx scripts/build-approval-proxies.ts
```
- Reads: `erc1155_transfers` table (ApprovalForAll events)
- Creates: `pm_user_proxy_wallets` table
- Time: ~2-5 minutes
- Output: Maps real trader EOAs to their Polymarket proxy wallets

### Step 2: Flatten ERC1155 Transfers
```bash
npx tsx scripts/flatten-erc1155.ts
```
- Reads: `erc1155_transfers` table (TransferSingle + TransferBatch events)
- Creates: `pm_erc1155_flats` table
- Time: ~5-10 minutes
- Output: Decoded conditional token transfers with operator, from/to, amounts

### Step 3: Map Token IDs to Markets
```bash
npx tsx scripts/map-tokenid-to-market.ts
```
- Reads: Gamma API (polymarket.com markets)
- Creates: `pm_tokenid_market_map` table
- Time: ~2-3 minutes
- Output: Token ID → Market ID + Outcome label mappings

### Step 4: Build Position Flows
```bash
npx tsx scripts/build-positions-from-erc1155.ts
```
- Reads: `pm_erc1155_flats`, `pm_tokenid_market_map`, `pm_user_proxy_wallets`
- Computes: Position aggregations by proxy/market
- Time: ~5-10 minutes
- Output: Net quantities, buy/sell counts per position

### Step 5: Ingest CLOB Fills
```bash
npx tsx scripts/ingest-clob-fills.ts
```
- Reads: CLOB API (polymarket.com trades)
- Creates: `pm_trades` table
- Time: ~10-30 minutes (depends on # of active proxies)
- Output: Actual fills with execution prices, sides, fees

### Step 6: Calculate USDC Funding
```bash
npx tsx scripts/usdc-cashflows.ts
```
- Reads: `erc20_transfers` table, `pm_user_proxy_wallets`
- Output: USDC deposits/withdrawals per proxy (NOT trading volume)
- Time: ~2-3 minutes

### Step 7: Validate Known Wallets
```bash
npx tsx scripts/validate-three.ts
```
- Reads: `pm_trades`, `pm_user_proxy_wallets`, `erc20_transfers`
- Validates: Against HolyMoses7 (2,182), niggemon (1,087), Wallet3 (0)
- Time: ~1 minute
- Output: Accuracy % of trade capture vs expected

---

## 📊 Success Criteria

### After Step 1 (Proxy Mapping)
**Expected Output:**
```
✅ pm_user_proxy_wallets table ready
Processed: [X] events
Approvals: [X]
Revocations: [Y]
Active EOA→Proxy pairs: [Z]
Unique EOAs: [W]
```

### After Step 2 (ERC1155 Flattening)
**Expected Output:**
```
✅ pm_erc1155_flats table ready
TransferSingle: [X] events
TransferBatch: [Y] events (may have 0 due to TODO decoding)
```

### After Step 3 (Token ID Mapping)
**Expected Output:**
```
✅ Created [X] token_id → market mappings
Total Token IDs: ~10K-100K
Unique Markets: ~5K-50K
```

### After Step 5 (CLOB Fills)
**Expected Output:**
```
✅ Ingested [X] fills from CLOB API
Found [Y] active proxy wallets
Total Trades: [Z]
Top traders: [List of proxies]
```

### After Step 7 (Validation)
**Expected Output:**
```
HolyMoses7: [X] trades vs 2,182 expected (accuracy: [Y]%)
niggemon: [X] trades vs 1,087 expected (accuracy: [Y]%)
Wallet3: [X] trades vs 0 expected
```

**Target Accuracy:** > 80%
**Minimum Accuracy:** > 50%

---

## 🔍 Troubleshooting

### Low Accuracy (< 50%)

**Issue:** Not finding trades for known wallets

**Checklist:**
1. Verify proxy wallet mapping
   ```bash
   # Check that EOAs map to proxies
   clickhouse-client -h <host> -u <user> -p
   SELECT COUNT(*) FROM pm_user_proxy_wallets;
   ```

2. Verify token ID encoding
   ```bash
   # Check sample mappings
   SELECT * FROM pm_tokenid_market_map LIMIT 5;
   ```

3. Verify CLOB fills
   ```bash
   # Check trade volume
   SELECT COUNT(*) FROM pm_trades;
   ```

### Empty Tables After Step 1

**Issue:** No proxy wallets found

**Solution:**
- Verify `erc1155_transfers` table has ApprovalForAll events
- Check `CONDITIONAL_TOKENS` environment variable is correct
- Verify event signature: `0xa39707aee45523880143dba1da92036e62aa63c0`

### Timeout Errors During Step 5 (CLOB)

**Issue:** CLOB API requests timing out

**Solution:**
- Reduce number of proxies queried (edit script to use LIMIT 1000)
- Increase timeout in ClickHouse config
- Run during off-peak hours

### Database Connection Errors

**Issue:** Cannot connect to ClickHouse

**Solution:**
```bash
# Test connectivity
echo "SELECT 1" | clickhouse-client \
  --host=$CLICKHOUSE_HOST \
  --user=$CLICKHOUSE_USER \
  --password=$CLICKHOUSE_PASSWORD
```

---

## 📈 Performance Notes

### Typical Execution Time
- Step 1 (Proxies): 2-5 min
- Step 2 (ERC1155): 5-10 min
- Step 3 (Tokens): 2-3 min
- Step 4 (Positions): 5-10 min
- Step 5 (CLOB): 10-30 min ⏱️ (slowest)
- Step 6 (USDC): 2-3 min
- Step 7 (Validate): 1 min
- **Total: ~30-70 minutes**

### Data Volume Expectations
- pm_user_proxy_wallets: 100K-500K rows
- pm_erc1155_flats: 10M-50M rows
- pm_tokenid_market_map: 10K-100K rows
- pm_trades: 100M+ rows
- **Total storage: ~100-200 GB**

---

## 🔗 Reference Links

**Polymarket:**
- Profile format: https://polymarket.com/profile/{EOA_ADDRESS}
- Markets: https://polymarket.com

**APIs:**
- Gamma API: https://gamma-api.polymarket.com
- CLOB API: https://clob.polymarket.com/api/v1/docs

**Blockchain Data:**
- ConditionalTokens contract: `0x4d97dcd97ec945f40cf65f87097ace5ea0476045`
- Polygon: https://polygonscan.com

---

## ✅ Next Steps

After successful pipeline execution:

1. **Verify accuracy** - Should be > 80% on known wallets
2. **Build PnL calculations** - Use pm_trades + execution_price
3. **Create leaderboard** - Aggregate by proxy_wallet
4. **Connect to API** - Serve data to dashboard
5. **Set up monitoring** - Track daily updates

---

**Last Updated:** 2025-11-06
**Status:** Ready to execute
