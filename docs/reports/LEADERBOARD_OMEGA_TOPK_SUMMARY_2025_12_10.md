# Leaderboard Omega Top-K Summary

**Terminal:** Terminal 3
**Date:** 2025-12-10

---

## Omega Top-K Averages (Raw)

| Bucket | N | Avg Omega | Min Omega | Max Omega |
|--------|---|-----------|-----------|-----------|
| top_10 | 10 | 97,011 | 12,630 | 609,005 |
| top_50 | 40 | 3,735 | 999 | 11,988 |
| top_100 | 50 | 560 | 282 | 999 |
| top_200 | 100 | 173 | 104 | 277 |

---

## Omega Top-K Averages (With Robustness Guard)

**Guard:** `total_events >= 200`, `resolved_markets >= 30`, `active_days >= 90`

| Bucket | N | Avg Omega | Min Omega | Max Omega |
|--------|---|-----------|-----------|-----------|
| top_10 | 10 | 97,011 | 12,630 | 609,005 |
| top_50 | 40 | 3,735 | 999 | 11,988 |
| top_100 | 50 | 560 | 282 | 999 |
| top_200 | 100 | 173 | 104 | 277 |

---

## Top 10 Wallets by Omega

| Rank | Wallet | Omega | PnL | Days | Markets | Category |
|------|--------|-------|-----|------|---------|----------|
| 1 | 0x49cd41c0...95e8 | 609,005 | $6,090 | 276 | 287 | sports |
| 2 | 0x5356ba55...ed53 | 159,737 | $6,389 | 255 | 81 | politics |
| 3 | 0x1031db1a...f65f | 44,673 | $128,727 | 215 | 56 | sports |
| 4 | 0x1ca815ed...dc6d | 37,980 | $91,149 | 239 | 95 | sports |
| 5 | 0xae29f7ee...d0c3 | 28,676 | $228,506 | 195 | 93 | sports |
| 6 | 0xb02fbd0f...18c8 | 28,225 | $7,578 | 111 | 84 | politics |
| 7 | 0xa8c297a1...c9c4 | 17,499 | $117,417 | 257 | 102 | sports |
| 8 | 0x66eca8ac...2c17 | 16,328 | $3,579 | 101 | 38 | politics |
| 9 | 0xfab88024...a6d6 | 15,355 | $44,545 | 234 | 49 | other |
| 10 | 0x11ea2635...26ce | 12,630 | $125,188 | 235 | 86 | politics |

---

## Interpretation

1. **Guard makes no difference:** The universe table already filters for the same criteria (200+ events, 30+ markets, 90+ days), so raw and guarded results are identical.

2. **Extreme Omega concentration:** The top 10 wallets have an average Omega of **97,011**, meaning their gains are ~97,000x their losses. This indicates near-perfect win records with minimal downside.

3. **Steep power-law decay:**
   - Top 10: avg 97,011
   - Top 50: avg 3,735 (26x drop)
   - Top 100: avg 560 (7x drop)
   - Top 200: avg 173 (3x drop)

4. **High Omega ≠ High PnL:** The #1 Omega wallet (609,005) has only $6K PnL. The highest PnL in top 10 is $228K at rank #5. Omega measures *consistency of wins*, not *magnitude of wins*.

5. **Sports dominates elite Omega:** 6 of top 10 are sports specialists. Sports markets may have more predictable outcomes for skilled bettors.

---

## Practical Guidance

- **For copy-trading:** Use Omega > 100 as a floor filter. Below that, downside risk is material.
- **For portfolio construction:** Blend Omega ranking with absolute PnL to balance consistency with magnitude.
- **For risk management:** Extremely high Omega (>10,000) often indicates small sample or edge case. Consider capping at 10,000 for display.

---

## Query

```sql
-- Top 200 by Omega with stats
SELECT
  wallet,
  round(omega_proxy, 2) as omega,
  round(realized_pnl, 2) as pnl,
  active_days,
  resolved_markets,
  top_category
FROM vw_leaderboard_v1
WHERE omega_proxy IS NOT NULL
ORDER BY omega_proxy DESC
LIMIT 200
```
