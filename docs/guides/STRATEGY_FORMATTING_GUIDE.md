# Strategy Formatting Guide

Quick reference for writing strategy descriptions that the AI can parse into complete workflows.

---

## Basic Format

```
Strategy Name: "Your Strategy Name"

Goal: What you're trying to accomplish

Filters:
- Filter 1: Description with operator and value
- Filter 2: Description with operator and value
- Filter 3: Description with operator and value

Sort By: Metric name (Ascending or Descending)

Action: What to do with results
```

---

## Filter Syntax

### Comparison Operators

| Syntax | Operator | Example |
|--------|----------|---------|
| `>` | GREATER_THAN | "Omega > 2" |
| `<` | LESS_THAN | "Win rate < 50%" |
| `>=` | GREATER_THAN_OR_EQUAL | "PnL >= $10,000" |
| `<=` | LESS_THAN_OR_EQUAL | "Drawdown <= 10%" |
| `=` | EQUALS | "Bets = 100" |

### Percentile Filters

| Syntax | Example |
|--------|---------|
| "Top X%" | "Top 20% by Brier Score" |
| "Bottom X%" | "Bottom 10% by drawdown" |
| "In top X%" | "Must be in top 10%" |

### Keywords to Use

**Must/Should:**
- "Must have omega > 2"
- "Should show win rate > 60%"

**And/Or:**
- "Omega > 2 AND win rate > 60%"
- "Volume > $100k OR bets > 50"

---

## Available Metrics (102 Total)

### Core Performance (Most Common)
- `omega_ratio` - Risk-adjusted returns
- `net_pnl` - Net profit/loss
- `roi` - Return on investment
- `win_rate` - Percentage of winning trades
- `total_pnl` - Total P&L
- `closed_positions` - Number of closed positions

### Risk Metrics
- `max_drawdown` - Maximum drawdown
- `sharpe_ratio` - Sharpe ratio
- `sortino_ratio` - Sortino ratio
- `calmar_ratio` - Calmar ratio
- `cvar_95` - Conditional value at risk (95%)
- `kelly_utilization` - Kelly criterion utilization

### Activity Metrics
- `bets_per_week` - Average bets per week
- `avg_bet_size` - Average position size
- `total_volume` - Total trading volume
- `track_record_days` - Days of trading history

### Advanced Metrics
- `brier_score` (#25) - Forecasting accuracy
- `crowd_orthogonality` (#68) - Independence from crowd
- `yes_no_bias` (#98) - YES/NO directional bias
- `edge_source_decomposition` (#102) - Where P&L comes from
- `omega_lag_30s` (#48) - Lag-adjusted omega score

[See full list of 102 metrics in database schema]

---

## Sorting

### Syntax
```
Sort By: [metric_name] (Direction)
```

### Examples
- "Sort by: Net PnL (Descending)" → Get highest PnL first
- "Sort by: Crowd Orthogonality (Ascending)" → Get most contrarian first
- "Rank by: Sharpe Ratio (Descending)" → Best risk-adjusted returns first

### Direction Options
- **Ascending**: Lowest to highest (MIN aggregation)
- **Descending**: Highest to lowest (MAX aggregation)

---

## Actions

### Available Actions
- `ADD_TO_WATCHLIST` - Add wallets to a watchlist
- `SEND_ALERT` - Send notification when criteria met
- `WEBHOOK` - Call external webhook
- `LOG_RESULT` - Log results for review

### Syntax
```
Action: [Action type] to [destination]
```

### Examples
- "Action: Add to watchlist 'Contrarian Traders'"
- "Action: Send alert when found"
- "Action: Call webhook for new matches"
- "Action: Log results for review"

---

## Complete Examples

### Example 1: The Contrarian (Orthogonal Alpha)
```
Strategy: "The Contrarian"

Goal: Find skilled, non-consensus thinkers to balance a portfolio

Filters:
- Brier Score: Must be in the top 20%
- YES/NO Direction Bias: Must be < 30%
- Edge Source Decomposition: Must show high post-close drift

Sort By: Crowd Orthogonality (Ascending)

Action: Add to watchlist "Contrarian Traders"
```

**Result:** 7 nodes, 6 connections

---

### Example 2: High-Performance Traders
```
Strategy: "High Performance"

Goal: Find traders with exceptional risk-adjusted returns

Filters:
- Omega Ratio: > 2.0
- Win Rate: > 60%
- Sharpe Ratio: Top 15%
- Minimum 50 closed positions

Sort By: Net PnL (Descending)

Action: Send alert
```

**Result:** 6 nodes, 5 connections

---

### Example 3: Volume Traders
```
Strategy: "Volume Specialists"

Goal: Identify high-volume traders with good track records

Filters:
- Total Volume: > $100,000 OR Bets per week > 50
- Track Record: At least 90 days
- Win Rate: >= 52%

Sort By: Total Volume (Descending)

Action: Add to watchlist "Volume Traders"
```

**Result:** 7 nodes (includes OR logic node)

---

### Example 4: Risk-Averse Winners
```
Strategy: "Conservative Winners"

Goal: Find traders with high win rates and low drawdowns

Filters:
- Win Rate: Top 10%
- Max Drawdown: < 15%
- Kelly Utilization: < 50% (conservative sizing)
- Closed Positions: >= 30

Sort By: Sortino Ratio (Descending)

Action: Add to watchlist "Conservative Winners"
```

**Result:** 6 nodes, 5 connections

---

### Example 5: Emerging Talent
```
Strategy: "Rising Stars"

Goal: Find newer traders showing strong early performance

Filters:
- Track Record: Between 30 and 90 days
- Omega Ratio: > 1.8
- Brier Score: Top 30%
- ROI: > 25%

Sort By: Calmar Ratio (Descending)

Action: Send alert weekly
```

**Result:** 6 nodes, 5 connections

---

## Tips for Best Results

### ✅ DO:
- Use clear metric names (omega_ratio, not "omega")
- Specify units for money ("$100k" or "100000")
- Use percentages as decimals (60% = 0.6) or whole numbers (60)
- Include "Top X%" for percentile filters
- Specify sort direction (Ascending/Descending)
- Name your watchlist in the action

### ❌ DON'T:
- Use ambiguous terms ("good performance" - be specific!)
- Mix AND/OR without parentheses (can be confusing)
- Forget to specify a sort direction
- Use metric names that don't exist
- Create overly complex nested logic (keep it simple)

---

## Troubleshooting

### "Only created 1 node"
**Issue:** AI didn't detect your message as a strategy description

**Solutions:**
- Start with "Strategy:" or "Goal:"
- Include "Filters:" section
- Use keywords like "Must", "Should", "Top X%"
- List 3+ filter conditions

### "Wrong metric names"
**Issue:** Filters using incorrect field names

**Solutions:**
- Check the metric name matches the database
- Use underscores (omega_ratio not omega-ratio)
- Use singular form (bet_size not bet_sizes)
- Check the 102 metrics list above

### "Missing connections"
**Issue:** Nodes created but not connected

**Solutions:**
- The system auto-connects nodes sequentially
- If missing, try refreshing and rebuilding
- Check browser console for errors

### "Wrong operators"
**Issue:** Using EQUALS when you wanted GREATER_THAN

**Solutions:**
- Be explicit: "omega > 2" not "omega of 2"
- Use comparison words: "greater than", "less than"
- For percentiles, use "Top X%" syntax

---

## Advanced Patterns

### Multiple Filter Groups with OR
```
Filters:
- (Volume > $100k OR Bets > 50) AND Omega > 1.5
```
This creates 3 filters + 2 logic nodes (1 OR, 1 AND)

### Percentile Ranges
```
Filters:
- Sharpe Ratio: Between 50th and 80th percentile
```
This uses IN_PERCENTILE with min/max values

### Multiple Actions
```
Action: Add to watchlist "Top Traders" AND send alert
```
This creates 2 action nodes

---

## Strategy Template Library

Copy and customize these templates:

### Template: Momentum Trader
```
Strategy: "Momentum Trader"
Goal: Find traders capitalizing on price momentum
Filters:
- Omega Lag 30s: Top 20%
- Win Rate: > 55%
- Bets per week: > 10
Sort By: Edge Source Decomposition (Descending)
Action: Add to watchlist "Momentum Traders"
```

### Template: Contrarian
```
Strategy: "Contrarian"
Goal: Find independent thinkers
Filters:
- Crowd Orthogonality: Bottom 10% (most contrarian)
- Brier Score: Top 25%
- Win Rate: > 50%
Sort By: Net PnL (Descending)
Action: Add to watchlist "Contrarians"
```

### Template: Risk Manager
```
Strategy: "Risk Manager"
Goal: Find traders with excellent risk management
Filters:
- Max Drawdown: < 10%
- Sharpe Ratio: Top 15%
- Kelly Utilization: < 60%
- Win Rate: > 55%
Sort By: Sortino Ratio (Descending)
Action: Add to watchlist "Risk Masters"
```

---

## Need Help?

If you're stuck:
1. Start with a simple 2-filter strategy
2. Test it works, then add more filters
3. Check the console logs for errors
4. Refer to the 102 metrics list
5. Use one of the templates above

**Remember:** The AI builds the workflow for you - just describe what you want in plain English using the format above!
