-- Add "Smart-Money Imbalance Value Trade" Strategy
-- Goal: Find underpriced outcomes where smart money is heavily on one side
-- Strategy: Scan markets for lopsided smart-money positions with meaningful edge remaining

INSERT INTO strategy_definitions (
  strategy_name,
  strategy_description,
  strategy_type,
  is_predefined,
  is_archived,
  node_graph
) VALUES (
  'Smart-Money Imbalance Value Trade',
  'Market-scanning strategy that identifies underpriced outcomes where top wallets are heavily stacked on one side. Looks for markets with >10¢ upside after fees, preferring NO positions since most markets resolve NO. Targets medium-term opportunities (12h-7d out) with strong smart-money conviction.',
  'SCREENING',
  TRUE,
  FALSE,
  '{
    "nodes": [
      {
        "type": "DATA_SOURCE",
        "id": "markets_source",
        "config": {
          "source": "MARKETS",
          "mode": "BATCH",
          "prefilters": {
            "table": "markets_dim_seed",
            "where": "status = '\''active'\''"
          }
        }
      },
      {
        "type": "FILTER",
        "id": "category_filter",
        "config": {
          "field": "category",
          "operator": "EQUALS",
          "value": "US politics",
          "description": "Focus on specific category (configurable)"
        }
      },
      {
        "type": "FILTER",
        "id": "time_window_medium",
        "config": {
          "field": "hours_to_close",
          "operator": "LESS_THAN_OR_EQUAL",
          "value": 168,
          "description": "Markets closing within 7 days (168 hours)"
        }
      },
      {
        "type": "FILTER",
        "id": "time_window_min",
        "config": {
          "field": "hours_to_close",
          "operator": "GREATER_THAN",
          "value": 1,
          "description": "Avoid last-minute markets, keep window >1 hour"
        }
      },
      {
        "type": "FILTER",
        "id": "min_liquidity",
        "config": {
          "field": "volume",
          "operator": "GREATER_THAN",
          "value": 1000,
          "description": "Ensure sufficient market liquidity"
        }
      },
      {
        "type": "FILTER",
        "id": "price_range_no",
        "config": {
          "field": "current_price_no",
          "operator": "LESS_THAN_OR_EQUAL",
          "value": 0.90,
          "description": "NO side has meaningful upside potential"
        }
      },
      {
        "type": "FILTER",
        "id": "avoid_extreme_prices",
        "config": {
          "field": "current_price_no",
          "operator": "GREATER_THAN_OR_EQUAL",
          "value": 0.05,
          "description": "Avoid extreme longshot bets"
        }
      },
      {
        "type": "LOGIC",
        "id": "combine_market_filters",
        "config": {
          "operator": "AND",
          "inputs": [
            "category_filter",
            "time_window_medium",
            "time_window_min",
            "min_liquidity",
            "price_range_no",
            "avoid_extreme_prices"
          ]
        }
      },
      {
        "type": "AGGREGATION",
        "id": "sort_by_volume",
        "config": {
          "function": "MAX",
          "field": "volume",
          "description": "Prioritize high-liquidity markets for best execution"
        }
      }
    ],
    "edges": [
      {"from": "markets_source", "to": "category_filter"},
      {"from": "markets_source", "to": "time_window_medium"},
      {"from": "markets_source", "to": "time_window_min"},
      {"from": "markets_source", "to": "min_liquidity"},
      {"from": "markets_source", "to": "price_range_no"},
      {"from": "markets_source", "to": "avoid_extreme_prices"},
      {"from": "category_filter", "to": "combine_market_filters"},
      {"from": "time_window_medium", "to": "combine_market_filters"},
      {"from": "time_window_min", "to": "combine_market_filters"},
      {"from": "min_liquidity", "to": "combine_market_filters"},
      {"from": "price_range_no", "to": "combine_market_filters"},
      {"from": "avoid_extreme_prices", "to": "combine_market_filters"},
      {"from": "combine_market_filters", "to": "sort_by_volume"}
    ]
  }'::jsonb
);

-- Add detailed comment explaining execution requirements
COMMENT ON COLUMN strategy_definitions.node_graph IS '
Smart-Money Imbalance Value Trade strategy requires execution engine enhancements:

1. Smart-Money Imbalance Calculation (to be implemented in execution engine):
   - Pull positions for top 20 wallets by category P&L
   - Calculate stake_on_yes vs stake_on_no (with /128 correction)
   - Determine imbalance_side and imbalance_ratio
   - Require: imbalance_ratio >= 0.7, supporting_wallet_count >= 2

2. Edge Calculation (to be implemented in execution engine):
   - fair_value_estimate = f(imbalance_ratio, category base rates)
   - edge_cents = (fair_value - market_price - fees - spread)
   - Require: edge_cents >= $0.10

3. Position Sizing:
   - Scale by edge_cents (more edge = larger size)
   - Cap per-market exposure
   - Prefer NO side (most markets resolve NO)

4. Exit Logic:
   - Hold to resolution (conviction carry)
   - OR exit if imbalance inverts (smart money flips sides)

This node graph provides the market scanning and filtering foundation.
The execution engine must implement imbalance detection and edge calculation.
';
