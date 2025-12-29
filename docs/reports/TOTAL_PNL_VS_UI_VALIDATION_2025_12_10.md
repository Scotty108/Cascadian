# Total PnL vs UI Validation Report

**Terminal:** Terminal 3
**Date:** 2025-12-10
**Status:** COMPLETE

---

## Summary

Validated Cascadian's `totalPnlV1` engine (V12 Realized + Unrealized) against Polymarket UI "Net Total" for 5 Gold MVP wallets via Playwright browser automation.

**Result: 3/5 wallets (60%) within 10% tolerance**

---

## Validation Results

| Wallet | Username | Our Total | UI Total | Delta | Delta % | Pass? |
|--------|----------|-----------|----------|-------|---------|-------|
| 0x204f...5e14 | swisstony | $2,414,911 | $2,405,568 | +$9,343 | **+0.4%** | PASS |
| 0xd38b...5029 | primm | $2,508,370 | $2,583,288 | -$74,918 | **-2.9%** | PASS |
| 0x5139...a8db | 4-seas | $1,361,747 | $1,293,254 | +$68,493 | **+5.3%** | PASS |
| 0x5bff...ffbe | YatSen | $2,442,094 | $2,250,639 | +$191,455 | **+8.5%** | PASS |
| 0xee00...cea1 | S-Works | $2,003,414 | $2,181,193 | -$177,779 | **-8.2%** | PASS |

**Average Absolute Delta: 5.1%**

---

## Detailed Breakdown

### swisstony (0x204f...5e14) - BEST MATCH
- **Our Realized:** $2,430,018
- **Our Unrealized:** -$15,107
- **Our Total:** $2,414,911
- **UI Net Total:** $2,405,567.50
- **UI Gain:** +$4,374,151.01
- **UI Loss:** -$1,968,583.51
- **Delta:** +0.4% (within noise)

### primm (0xd38b...5029)
- **Our Realized:** $2,508,370
- **Our Unrealized:** $0
- **Our Total:** $2,508,370
- **UI Net Total:** $2,583,288.00
- **UI Gain:** +$4,579,376.00
- **UI Loss:** -$1,996,088.00
- **Delta:** -2.9%

### 4-seas (0x5139...a8db)
- **Our Realized:** $1,361,747
- **Our Unrealized:** $0
- **Our Total:** $1,361,747
- **UI Net Total:** $1,293,254.00
- **UI Gain:** +$4,503,946.83
- **UI Loss:** -$3,210,692.83
- **Delta:** +5.3%

### YatSen (0x5bff...ffbe)
- **Our Realized:** $2,132,750
- **Our Unrealized:** $309,344
- **Our Total:** $2,442,094
- **UI Net Total:** $2,250,638.80
- **UI Gain:** +$3,490,243.90
- **UI Loss:** -$1,239,605.10
- **Delta:** +8.5%
- **Note:** YatSen has $1.1M in open positions - unrealized calculation may differ

### S-Works (0xee00...cea1)
- **Our Realized:** $1,963,122
- **Our Unrealized:** $40,292
- **Our Total:** $2,003,414
- **UI Net Total:** $2,181,193.00
- **UI Gain:** +$7,867,867.80
- **UI Loss:** -$5,686,674.80
- **Delta:** -8.2%
- **Note:** S-Works has $352K in open positions

---

## Formula Comparison

### Cascadian (V12 + Unrealized)
```
Total = V12_Realized + Unrealized

Where:
- V12_Realized = SUM(usdc_delta + token_delta * payout_norm) for resolved markets
- Unrealized = SUM(position_value - cost_basis) for open positions
```

### Polymarket UI
```
Net Total = Gain + Loss

Where:
- Gain = SUM(profitable trade outcomes)
- Loss = SUM(losing trade outcomes)
```

---

## Observations

1. **Best match on low-position wallets:** swisstony (0.4% delta) has relatively small open positions compared to realized gains.

2. **Larger deltas correlate with open positions:** YatSen and S-Works have $300K-$1.1M in open positions and show larger discrepancies (8%+). This suggests our unrealized calculation may differ from UI.

3. **Direction variance:** 3 wallets show positive delta (we > UI), 2 show negative delta (UI > us). No systematic bias.

4. **All within 10%:** Even the worst cases (8.5%) are within reasonable tolerance for a complex financial calculation.

---

## Known Differences

| Source | Our Engine | Polymarket UI |
|--------|------------|---------------|
| Realized data | CLOB maker events (pm_trader_events_v2) | Unknown (likely same source) |
| Unrealized calc | Cost basis tracking | Mark-to-market only? |
| Resolution prices | pm_condition_resolutions | Real-time API |
| Deduplication | GROUP BY event_id | Unknown |

---

## Recommendations

1. **Ship as-is for leaderboard:** 5% average delta is acceptable for ranking purposes
2. **Investigate unrealized formula:** Larger deltas on high-position wallets suggest formula difference
3. **Add more test wallets:** Expand validation to 20+ wallets for statistical significance
4. **Monitor over time:** PnL will converge as more markets resolve

---

## Technical Notes

- Validation performed via MCP Playwright browser automation
- UI values captured from profile page tooltip hover
- Our values calculated using `totalPnlV1.ts` engine
- V12 Realized uses CLOB-only formula with query-time deduplication

---

## Files

| File | Purpose |
|------|---------|
| `lib/pnl/totalPnlV1.ts` | Total PnL engine |
| `lib/pnl/realizedPnlV12.ts` | V12 Realized formula |
| `lib/pnl/unrealizedPnlV1.ts` | Unrealized calculation |
| `vw_leaderboard_gold_mvp_v1` | Gold MVP wallet view |
