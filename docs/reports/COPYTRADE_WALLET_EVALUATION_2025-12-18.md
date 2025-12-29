# User Wallet Copy-Trading Evaluation Report
**Generated:** 2025-12-18
**Methodology:** V19s Realized PnL (cash_flow + final_tokens × resolution_price)
**Lookback Period:** 60 days
**Total Wallets Evaluated:** 37 (2 had no activity)

---

## Executive Summary

Of 39 wallets provided, **37 had trading activity** in the past 60 days. Analysis reveals:

| Category | Count | Notes |
|----------|-------|-------|
| **RECOMMENDED** | 10 | Strong metrics, copyable strategy |
| **CAUTION** | 15 | Profitable but red flags (grinder/scalper) |
| **AVOID** | 5 | Negative edge or major issues |
| **INSUFFICIENT DATA** | 7 | Too few resolved positions |

### Key Findings
1. **Best overall performer**: @kch123 (+$3.19M, omega 1.27, 52.5% win rate, 50c entry)
2. **Highest omega**: @Super forecaster (24.63 omega) - but is a **GRINDER** (92c entry)
3. **Major losers identified**: @darkrider11 (-$1.7M), @antman-batman (-$1.4M), @piastri (-$453k)
4. **Grinder pattern detected**: 5 wallets with avg entry > 85c (safe-bet grinding)
5. **Scalper pattern detected**: 6 wallets with avg hold < 1 hour

---

## Full Evaluation Results

### Tier 1: RECOMMENDED (10 wallets)
These wallets show strong fundamentals for copy-trading: positive omega, reasonable entry prices, and sufficient history.

| Rank | Name | Category | PnL 60d | Omega | Win% | Entry | Hold Hrs | Flags |
|------|------|----------|---------|-------|------|-------|----------|-------|
| 1 | **@kch123** | Sports | +$3,194,847 | 1.27 | 52.5% | 0.50 | 3.3h | - |
| 2 | **@gmanas** | Sports | +$1,912,439 | 1.15 | 52.1% | 0.52 | 3.3h | - |
| 3 | **@primm** | Sports | +$1,100,108 | 1.58 | 48.2% | 0.42 | 1.8h | - |
| 4 | **@ZerOptimist** | Sports | +$777,443 | 1.36 | 56.3% | 0.56 | 2.2h | - |
| 5 | **@chungguskhan** | Geopolitics | +$393,590 | 2.34 | 57.6% | 0.61 | 59.1h | - |
| 6 | **@easyclap** | Crypto | +$352,812 | 1.31 | 49.1% | 0.55 | 47.0h | - |
| 7 | **@kingofcoinflips** | Crypto | +$288,582 | 1.19 | 51.4% | 0.56 | 55.5h | - |
| 8 | **@justdance** | Crypto | +$139,725 | 1.10 | 47.4% | 0.49 | 18.9h | - |
| 9 | **@Anjun** | Geopolitics | +$133,704 | 1.11 | 65.9% | 0.70 | 52.3h | - |
| 10 | **@eightpenguins** | Entertainment | +$36,864 | 3.19 | 62.6% | 0.38 | 52.1h | - |

**Why these are recommended:**
- All have omega > 1.0 (profitable edge)
- Entry prices between 0.38-0.70 (not safe-bet grinding)
- Hold times > 1h (not scalping, gives time to copy)
- Diversified across categories

---

### Tier 2: CAUTION - Grinders (5 wallets)
These wallets are profitable but buy at very high prices (>85c), meaning they mostly bet on near-certain outcomes. Copy-trading may have limited edge after slippage.

| Rank | Name | Category | PnL 60d | Omega | Win% | Entry | Hold Hrs | Issue |
|------|------|----------|---------|-------|------|-------|----------|-------|
| 11 | **@Sharky6999** | Crypto | +$167,247 | 7.27 | 99.3% | **0.99** | 1.1h | GRINDER |
| 12 | **@LlamaEnjoyer** | Sports | +$52,703 | 4.63 | 94.9% | **0.98** | 10.6h | GRINDER |
| 13 | **@VvVv** | Geopolitics | +$44,574 | 2.59 | 94.1% | 0.71 | 41.0h | HIGH_WIN_RATE |
| 14 | **@scottilicious** | Geopolitics | +$58,325 | 2.03 | 73.4% | **0.90** | 210.1h | GRINDER |
| 15 | **Super forecaster** | Unknown | +$11,814 | 24.63 | 94.7% | **0.92** | 143.6h | GRINDER |

**Grinder Warning:**
- These wallets have >90% win rates because they only bet on near-certain outcomes
- At 99c entry price, a win yields only 1c per share
- If you copy-trade and slip to 99.5c, your profit is halved
- The 99.3% win rate of @Sharky6999 means: 6535 wins × ~$3 avg profit = $19k, but 44 losses × ~$606 avg loss = $27k potential
- **Copy-trading grinders is very fragile to slippage**

---

### Tier 3: CAUTION - Scalpers (6 wallets)
These wallets hold positions for very short periods (< 1 hour average). Copy-trading is difficult because:
- By the time you detect their trade and execute, price has moved
- 30-second copy delay erases edge on rapid trades

| Rank | Name | Category | PnL 60d | Omega | Win% | Entry | Hold Hrs | Issue |
|------|------|----------|---------|-------|------|-------|----------|-------|
| 16 | **@0x066423...** | Crypto | +$179,957 | 1.09 | 49.0% | 0.41 | **0.0h** | SCALPER |
| 17 | **@Qualitative** | Crypto | +$162,346 | 1.10 | 51.6% | 0.50 | **0.2h** | SCALPER |
| 18 | **@FirstOrder** | Crypto | +$113,698 | 1.07 | 50.3% | 0.49 | **0.0h** | SCALPER |
| 19 | **@1TickWonder2** | Crypto | +$29,740 | 1.06 | 50.2% | 0.51 | **0.0h** | SCALPER |
| 20 | **@SynthDataDotCo** | Crypto | +$10,895 | 1.01 | 50.1% | 0.47 | **0.2h** | SCALPER |

**Scalper Warning:**
- These wallets typically enter and exit within minutes
- 0.0h hold time means same-block or near-instant trades
- Copy-trade latency (30s+) would likely cause you to enter at a worse price
- @Qualitative does 193k trades in 60 days = ~130 trades/hour average
- **Not suitable for copy-trading due to speed requirements**

---

### Tier 4: CAUTION - Other Concerns (4 wallets)

| Rank | Name | Category | PnL 60d | Omega | Win% | Entry | Hold Hrs | Issue |
|------|------|----------|---------|-------|------|-------|----------|-------|
| 21 | **@RN1** | Sports | +$1,246,372 | 1.14 | 50.6% | 0.45 | 7.3h | HIGH_VOLUME |
| 22 | **@0xheavy888** | Esports | +$52,929 | 1.15 | 48.6% | 0.43 | 2.8h | LOW_MARGIN |
| 23 | **@esports095** | Esports | +$9,967 | 1.05 | 62.1% | 0.54 | 12.5h | LOW_MARGIN |
| 24 | **Profile link 1** | Unknown | +$76,038 | 6.65 | 81.5% | 0.78 | 170.4h | LIMITED_ACTIVITY |

**Notes:**
- @RN1 has very high volume (231k trades) - may be algorithmic/MEV
- Esports traders have low omega (1.05-1.15) - thin margin after copy fees
- Profile link 1 has only 27 resolved positions

---

### Tier 5: AVOID (5 wallets)
These wallets have negative edge (omega < 1.0) - copying them would lose money.

| Rank | Name | Category | PnL 60d | Omega | Win% | Entry | Hold Hrs | Issue |
|------|------|----------|---------|-------|------|-------|----------|-------|
| 33 | **@coinman2** | Crypto | **-$71,224** | 0.94 | 51.7% | 0.56 | 65.6h | NEGATIVE_EDGE |
| 34 | **@piastri** | Sports | **-$452,796** | 0.93 | 52.6% | 0.53 | 5.3h | NEGATIVE_EDGE |
| 35 | **@antman-batman** | Sports | **-$1,365,250** | 0.72 | 47.7% | 0.47 | 1.9h | NEGATIVE_EDGE |
| 36 | **@darkrider11** | Sports | **-$1,713,264** | 0.64 | 46.3% | 0.48 | 24.0h | NEGATIVE_EDGE |
| 37 | **@jeb2016** | Geopolitics | N/A | N/A | N/A | N/A | 502h | NO_RESOLVED |

**Key Insight:**
- @darkrider11 lost $1.7M in 60 days despite being on "TOP SPORTS TRADERS" list
- @antman-batman lost $1.4M
- These may have been profitable historically but recent performance is very negative
- **Always check recent PnL, not lifetime metrics**

---

### Tier 6: INSUFFICIENT DATA (7 wallets)

| Name | Category | PnL 60d | Resolved | Entry | Issue |
|------|----------|---------|----------|-------|-------|
| @HolyMoses7 | Geopolitics | +$8,353 | 406 | 0.67 | LOW_PROFIT |
| @Toncar16 | Geopolitics | +$7,488 | 142 | 0.21 | LOW_PROFIT |
| @25usdc | Geopolitics | +$16,489 | 463 | 0.19 | LOW_VOLUME |
| Profile link 3 | Unknown | +$777 | 28 | 0.81 | TOO_FEW_TRADES |
| Profile link 4 | Unknown | +$625 | 20 | 0.54 | TOO_FEW_TRADES |
| Profile link 2 | Unknown | +$423 | 130 | **0.97** | GRINDER |
| @Circus | Crypto | - | 0 | - | NO_DATA |
| @stonksgoup | Crypto | - | 0 | - | NO_DATA |

---

## Category Breakdown

### By Source Category

| Category | Wallets | Avg Omega | Avg PnL 60d | Best Performer |
|----------|---------|-----------|-------------|----------------|
| **Sports** | 9 | 1.22 | +$581,399 | @kch123 (+$3.2M) |
| **Geopolitics** | 8 | 1.88 | +$84,569 | @chungguskhan (+$394k) |
| **Crypto** | 12 | 1.13 | +$108,774 | @easyclap (+$353k) |
| **Esports** | 2 | 1.10 | +$31,448 | @0xheavy888 (+$53k) |
| **Entertainment** | 1 | 3.19 | +$36,864 | @eightpenguins |
| **Weather** | 1 | 4.81 | +$35,625 | @Hans323 |
| **Unknown** | 4 | 10.33 | +$22,329 | Profile link 1 (+$76k) |

### Trading Styles Detected

| Style | Count | Characteristics | Copy-Tradeable? |
|-------|-------|-----------------|-----------------|
| **Value Bettor** | 10 | Entry 0.30-0.70, holds hours-days | YES |
| **Grinder** | 5 | Entry >0.85, high win rate | RISKY |
| **Scalper** | 6 | Hold <1h, high frequency | NO |
| **Passive Holder** | 4 | Hold >100h, few trades | MAYBE |
| **Negative Edge** | 4 | Omega <1.0 | NO |

---

## Recommended Copy-Trade Portfolio

Based on this analysis, here's a diversified portfolio of the **top 5 wallets** for copy-trading:

| Wallet | Name | Category | Weight | Rationale |
|--------|------|----------|--------|-----------|
| 0x6a72... | **@kch123** | Sports | 30% | Highest PnL, balanced metrics |
| 0xd38b... | **@primm** | Sports | 25% | Best omega (1.58), value betting |
| 0x7744... | **@chungguskhan** | Geopolitics | 20% | Diversification, high omega |
| 0x71a7... | **@easyclap** | Crypto | 15% | Crypto exposure, solid metrics |
| 0x3c59... | **@eightpenguins** | Entertainment | 10% | Highest omega, diversification |

**Expected characteristics:**
- Combined omega: ~1.5
- Win rate: ~55%
- Category diversification: Sports (55%), Geo (20%), Crypto (15%), Ent (10%)
- No scalpers or extreme grinders

---

## Crowding/View Count Hypothesis

**User's hypothesis:** High-view wallets have diminished edge because copy-traders jack up prices immediately.

**To validate this hypothesis, we would need to:**
1. Scrape view counts from all 37 wallet profiles
2. Correlate view counts with:
   - Average entry slippage (entry price vs market price at time)
   - Omega degradation over time
   - Trade execution timing patterns

**Initial observations supporting the hypothesis:**
- Scalpers (0h hold time) may be MEV bots front-running copy trades
- High omega wallets like @Sharky6999 have very thin margins (99c entry)
- The "TOP" lists may be self-selecting for already-crowded wallets

**Next steps to validate:**
1. Use Playwright to scrape view counts from polymarket.com/@username
2. Compare view count quartiles against realized slippage
3. Simulate copy-trade execution with 30s delay to measure edge loss

---

## Summary Verdict Table

| Verdict | Count | Wallet Names |
|---------|-------|--------------|
| RECOMMENDED | 10 | @kch123, @gmanas, @primm, @ZerOptimist, @chungguskhan, @easyclap, @kingofcoinflips, @justdance, @Anjun, @eightpenguins |
| CAUTION (Grinder) | 5 | @Sharky6999, @LlamaEnjoyer, @VvVv, @scottilicious, Super forecaster |
| CAUTION (Scalper) | 6 | @0x066423..., @Qualitative, @FirstOrder, @1TickWonder2, @SynthDataDotCo |
| CAUTION (Other) | 4 | @RN1, @0xheavy888, @esports095, Profile link 1 |
| AVOID | 5 | @coinman2, @piastri, @antman-batman, @darkrider11, @jeb2016 |
| INSUFFICIENT | 7 | @HolyMoses7, @Toncar16, @25usdc, Profile link 2/3/4, @Circus, @stonksgoup |

---

## Appendix: Raw Data

### Wallet Address Reference

| Name | Address | Category |
|------|---------|----------|
| @Anjun | 0x43372356634781eea88d61bbdd7824cdce958882 | Geopolitics |
| @Toncar16 | 0x41583f2efc720b8e2682750fffb67f2806fece9f | Geopolitics |
| @25usdc | 0x75e765216a57942d738d880ffcda854d9f869080 | Geopolitics |
| @HolyMoses7 | 0xa4b366ad22fc0d06f1e934ff468e8922431a87b8 | Geopolitics |
| @jeb2016 | 0x4638d71d7b2d36eb590b5e1824955712dc8ad587 | Geopolitics |
| @chungguskhan | 0x7744bfd749a70020d16a1fcbac1d064761c9999e | Geopolitics |
| @VvVv | 0xa9b44dca52ed35e59ac2a6f49d1203b8155464ed | Geopolitics |
| @scottilicious | 0x000d257d2dc7616feaef4ae0f14600fdf50a758e | Geopolitics |
| @gmanas | 0xe90bec87d9ef430f27f9dcfe72c34b76967d5da2 | Sports |
| @primm | 0xd38b71f3e8ed1af71983e5c309eac3dfa9b35029 | Sports |
| @ZerOptimist | 0x2c57db9e442ef5ffb2651f03afd551171738c94d | Sports |
| @darkrider11 | 0x82a1b239e7e0ff25a2ac12a20b59fd6b5f90e03a | Sports |
| @LlamaEnjoyer | 0x9b979a065641e8cfde3022a30ed2d9415cf55e12 | Sports |
| @antman-batman | 0x42592084120b0d5287059919d2a96b3b7acb936f | Sports |
| @kch123 | 0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee | Sports |
| @piastri | 0x2f09642639aedd6ced432519c1a86e7d52034632 | Sports |
| @RN1 | 0x2005d16a84ceefa912d4e380cd32e7ff827875ea | Sports |
| @Hans323 | 0x0f37cb80dee49d55b5f6d9e595d52591d6371410 | Weather |
| @0xheavy888 | 0xec981ed70ae69c5cbcac08c1ba063e734f6bafcd | Esports |
| @esports095 | 0x40471b34671887546013ceb58740625c2efe7293 | Esports |
| @eightpenguins | 0x3c593aeb73ebdadbc9ce76d4264a6a2af4011766 | Entertainment |
| @SynthDataDotCo | 0x557bed924a1bb6f62842c5742d1dc789b8d480d4 | Crypto |
| Super forecaster | 0x00090e8b4fa8f88dc9c1740e460dd0f670021d43 | Unknown |
| Profile link 1 | 0x1521b47bf0c41f6b7fd3ad41cdec566812c8f23e | Unknown |
| Profile link 2 | 0x153bd1a568460b5b4e56f67691dca1b54b83275e | Unknown |
| Profile link 3 | 0x01caaea830076f1dfd77c38375bff51c8305038c | Unknown |
| Profile link 4 | 0x0185f2e4dd9c3183eff6208e8fc2385c85760bd3 | Unknown |
| @kingofcoinflips | 0xe9c6312464b52aa3eff13d822b003282075995c9 | Crypto |
| @Qualitative | 0x0f863d92dd2b960e3eb6a23a35fd92a91981404e | Crypto |
| @easyclap | 0x71a70f24538d885d1b45f9cea158a2cdf2e56fcf | Crypto |
| @FirstOrder | 0xeffcc79a8572940cee2238b44eac89f2c48fda88 | Crypto |
| @1TickWonder2 | 0x7485d661b858b117a66e1b4fcbecfaea87ac1393 | Crypto |
| @stonksgoup | 0x4a38e6e0330c2463fb5ac2188a620634039abfe8 | Crypto |
| @coinman2 | 0x55be7aa03ecfbe37aa5460db791205f7ac9ddca3 | Crypto |
| @Sharky6999 | 0x751a2b86cab503496efd325c8344e10159349ea1 | Crypto |
| @justdance | 0xcc500cbcc8b7cf5bd21975ebbea34f21b5644c82 | Crypto |
| @completion | 0xfeb581080aee6dc26c264a647b30a9cd44d5a393 | Crypto |
| @Circus | 0x28065f1b88027422274fb33e1e22bf3dad5736e7 | Crypto |
| @0x066423... | 0x8749194e5105c97c3d134e974e103b44eea44ea4 | Crypto |
