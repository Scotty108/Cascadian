
## Dome Baseline Comparison

| Metric | Value |
|--------|-------|
| **Dome P&L** | $87,030.505 |
| **Our P&L** | $34,990.557 |
| **Gap** | $52,039.948 |
| **Variance** | -59.80% |
| **Our Markets** | 43 |

### Data Source Analysis

| Source | Count | Coverage |
|--------|-------|----------|
| CLOB fills | 194 | 77.9% |
| Blockchain transfers | 249 | 100% |
| **Missing** | **55** | **22.099999999999994%** |

### Top 10 Markets (Our Data)

| Condition ID | P&L |
|--------------|-----|
| a7cc227d75f9... | $7202.88 |
| 272e4714ca46... | $4186.62 |
| ee3a389d0c13... | $4025.66 |
| 601141063589... | $2857.11 |
| 35a983283f4e... | $2385.91 |
| 8df96ce434fb... | $2312.18 |
| bb977da314ae... | $1966.00 |
| b3d517559b54... | $1695.68 |
| 03bf5c66a49c... | $1627.71 |
| b412d18bf3a1... | $937.99 |

### Root Cause
CLOB data incomplete - missing 55 blockchain transfers

**Missing P&L**: $52039.95
**Solution**: Rebuild P&L from erc1155_transfers instead of clob_fills
**Expected Result**: <2% variance after using blockchain data
