-- Update strategies to use proper ENHANCED_FILTER, SIGNAL, and ORCHESTRATOR nodes
-- Now that the UI bugs are fixed, we can use the advanced node types

-- Delete the simplified versions
DELETE FROM strategy_definitions
WHERE strategy_name IN ('Consensus Copy Trade', 'Smart-Money Imbalance Value Trade')
AND is_predefined = TRUE;

-- ============================================================================
-- Strategy 1: Consensus Copy Trade (with proper advanced nodes)
-- ============================================================================

INSERT INTO strategy_definitions (
  strategy_name,
  strategy_description,
  strategy_type,
  is_predefined,
  is_archived,
  node_graph
) VALUES (
  'Consensus Copy Trade',
  'Follow top wallets when they agree on an outcome. Enter only in final 12 hours before resolution when 2+ proven wallets align on the same side with no opposing positions. Maximize accuracy while keeping capital liquid.',
  'SCREENING',
  TRUE,
  FALSE,
  '{
    "nodes": [
      {
        "id": "wallets_source",
        "type": "DATA_SOURCE",
        "position": {"x": 100, "y": 100},
        "data": {
          "config": {
            "source": "WALLETS",
            "mode": "BATCH",
            "prefilters": {
              "table": "wallet_scores",
              "where": "meets_minimum_trades = true"
            }
          }
        }
      },
      {
        "id": "wallet_quality_filter",
        "type": "ENHANCED_FILTER",
        "position": {"x": 400, "y": 100},
        "data": {
          "config": {
            "conditions": [
              {
                "id": "cond_profitable",
                "field": "total_pnl",
                "operator": "GREATER_THAN",
                "value": 0,
                "fieldType": "number"
              },
              {
                "id": "cond_omega",
                "field": "omega_ratio",
                "operator": "GREATER_THAN_OR_EQUAL",
                "value": 2.0,
                "fieldType": "number"
              },
              {
                "id": "cond_positions",
                "field": "closed_positions",
                "operator": "GREATER_THAN_OR_EQUAL",
                "value": 20,
                "fieldType": "number"
              },
              {
                "id": "cond_winrate",
                "field": "win_rate",
                "operator": "GREATER_THAN_OR_EQUAL",
                "value": 0.55,
                "fieldType": "number"
              }
            ],
            "logic": "AND",
            "version": 2
          }
        }
      },
      {
        "id": "top_wallets_aggregation",
        "type": "AGGREGATION",
        "position": {"x": 700, "y": 100},
        "data": {
          "config": {
            "function": "TOP_N",
            "field": "total_pnl",
            "limit": 20
          }
        }
      },
      {
        "id": "consensus_signal",
        "type": "SIGNAL",
        "position": {"x": 1000, "y": 100},
        "data": {
          "config": {
            "signalType": "ENTRY",
            "condition": "2+ wallets agree on same side, no conflicts",
            "direction": "NO",
            "strength": "STRONG"
          }
        }
      },
      {
        "id": "orchestrator",
        "type": "ORCHESTRATOR",
        "position": {"x": 1000, "y": 300},
        "data": {
          "config": {
            "version": 1,
            "mode": "approval",
            "portfolio_size_usd": 10000,
            "risk_tolerance": 5,
            "position_sizing_rules": {
              "fractional_kelly_lambda": 0.375,
              "max_per_position": 0.02,
              "min_bet": 10,
              "max_bet": 200,
              "portfolio_heat_limit": 0.30,
              "risk_reward_threshold": 2.0,
              "drawdown_protection": {
                "enabled": true,
                "drawdown_threshold": 0.10,
                "size_reduction": 0.50
              },
              "volatility_adjustment": {
                "enabled": false
              }
            }
          }
        }
      }
    ],
    "edges": [
      {"from": "wallets_source", "to": "wallet_quality_filter"},
      {"from": "wallet_quality_filter", "to": "top_wallets_aggregation"},
      {"from": "top_wallets_aggregation", "to": "consensus_signal"},
      {"from": "consensus_signal", "to": "orchestrator"}
    ]
  }'::jsonb
);

-- ============================================================================
-- Strategy 2: Smart-Money Imbalance Value Trade (with proper advanced nodes)
-- ============================================================================

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
        "id": "markets_source",
        "type": "DATA_SOURCE",
        "position": {"x": 100, "y": 100},
        "data": {
          "config": {
            "source": "MARKETS",
            "mode": "BATCH",
            "prefilters": {
              "table": "markets_dim_seed",
              "where": "status = '\''active'\''"
            }
          }
        }
      },
      {
        "id": "market_filters",
        "type": "ENHANCED_FILTER",
        "position": {"x": 400, "y": 100},
        "data": {
          "config": {
            "conditions": [
              {
                "id": "cond_category",
                "field": "category",
                "operator": "EQUALS",
                "value": "US politics",
                "fieldType": "string"
              },
              {
                "id": "cond_time_max",
                "field": "hours_to_close",
                "operator": "LESS_THAN_OR_EQUAL",
                "value": 168,
                "fieldType": "number"
              },
              {
                "id": "cond_time_min",
                "field": "hours_to_close",
                "operator": "GREATER_THAN",
                "value": 1,
                "fieldType": "number"
              },
              {
                "id": "cond_liquidity",
                "field": "volume",
                "operator": "GREATER_THAN",
                "value": 1000,
                "fieldType": "number"
              },
              {
                "id": "cond_price_max",
                "field": "current_price_no",
                "operator": "LESS_THAN_OR_EQUAL",
                "value": 0.90,
                "fieldType": "number"
              },
              {
                "id": "cond_price_min",
                "field": "current_price_no",
                "operator": "GREATER_THAN_OR_EQUAL",
                "value": 0.05,
                "fieldType": "number"
              }
            ],
            "logic": "AND",
            "version": 2
          }
        }
      },
      {
        "id": "imbalance_signal",
        "type": "SIGNAL",
        "position": {"x": 700, "y": 100},
        "data": {
          "config": {
            "signalType": "ENTRY",
            "condition": "70%+ smart money on one side, >10¢ edge remaining",
            "direction": "NO",
            "strength": "MODERATE"
          }
        }
      },
      {
        "id": "orchestrator",
        "type": "ORCHESTRATOR",
        "position": {"x": 1000, "y": 100},
        "data": {
          "config": {
            "version": 1,
            "mode": "approval",
            "portfolio_size_usd": 10000,
            "risk_tolerance": 6,
            "position_sizing_rules": {
              "fractional_kelly_lambda": 0.40,
              "max_per_position": 0.03,
              "min_bet": 15,
              "max_bet": 300,
              "portfolio_heat_limit": 0.40,
              "risk_reward_threshold": 1.5,
              "drawdown_protection": {
                "enabled": true,
                "drawdown_threshold": 0.15,
                "size_reduction": 0.50
              },
              "volatility_adjustment": {
                "enabled": true
              }
            }
          }
        }
      }
    ],
    "edges": [
      {"from": "markets_source", "to": "market_filters"},
      {"from": "market_filters", "to": "imbalance_signal"},
      {"from": "imbalance_signal", "to": "orchestrator"}
    ]
  }'::jsonb
);

COMMENT ON TABLE strategy_definitions IS 'Updated strategies now use ENHANCED_FILTER, SIGNAL, and ORCHESTRATOR nodes with proper configurations';
