-- Add "Consensus Copy Trade" Strategy
-- Goal: Bet with top wallets when they agree on an outcome near resolution
-- Strategy: Follow proven wallets when 2+ agree on same side within 12h of close

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
  'CUSTOM',
  TRUE,
  FALSE,
  '{
    "nodes": [
      {
        "id": "markets_source",
        "type": "DATA_SOURCE",
        "position": {"x": 100, "y": 100},
        "config": {
          "source": "MARKETS",
          "mode": "BATCH",
          "prefilters": {
            "table": "markets_dim_seed",
            "where": "status = ''active''"
          }
        }
      },
      {
        "id": "category_filter",
        "type": "FILTER",
        "position": {"x": 100, "y": 200},
        "config": {
          "field": "category",
          "operator": "EQUALS",
          "value": "US politics",
          "description": "Filter to specific category (configurable per strategy instance)"
        }
      },
      {
        "id": "time_filter",
        "type": "FILTER",
        "position": {"x": 100, "y": 300},
        "config": {
          "field": "hours_to_close",
          "operator": "LESS_THAN_OR_EQUAL",
          "value": 12,
          "description": "Only markets closing within 12 hours"
        }
      },
      {
        "id": "wallet_source",
        "type": "DATA_SOURCE",
        "position": {"x": 400, "y": 100},
        "config": {
          "source": "WALLETS",
          "mode": "BATCH",
          "prefilters": {
            "table": "audited_wallet_pnl_extended",
            "where": "realized_pnl_usd > 0"
          }
        }
      },
      {
        "id": "wallet_quality_filter",
        "type": "ENHANCED_FILTER",
        "position": {"x": 400, "y": 200},
        "config": {
          "conditions": [
            {
              "id": "pnl_positive",
              "field": "realized_pnl_usd",
              "operator": "GREATER_THAN",
              "value": 0,
              "description": "Wallet must be profitable"
            },
            {
              "id": "coverage_threshold",
              "field": "coverage_pct",
              "operator": "GREATER_THAN_OR_EQUAL",
              "value": 2,
              "description": "At least 2% market coverage"
            },
            {
              "id": "min_positions",
              "field": "closed_positions",
              "operator": "GREATER_THAN_OR_EQUAL",
              "value": 20,
              "description": "Sufficient trading history"
            }
          ],
          "logic": "AND",
          "description": "Identify proven, quality wallets"
        }
      },
      {
        "id": "top_wallets",
        "type": "AGGREGATION",
        "position": {"x": 400, "y": 300},
        "config": {
          "function": "TOP_N",
          "field": "realized_pnl_usd",
          "limit": 20,
          "order": "DESC",
          "description": "Keep top 20 wallets by realized P&L"
        }
      },
      {
        "id": "consensus_detector",
        "type": "LOGIC",
        "position": {"x": 700, "y": 200},
        "config": {
          "operator": "CONSENSUS_CHECK",
          "inputs": ["time_filter", "top_wallets"],
          "params": {
            "min_supporting_wallets": 2,
            "require_no_conflict": true,
            "check_positions_api": true,
            "description": "Check if 2+ quality wallets agree on same side with no opposition"
          }
        }
      },
      {
        "id": "conflict_check",
        "type": "LOGIC",
        "position": {"x": 700, "y": 300},
        "config": {
          "operator": "AND",
          "inputs": ["consensus_detector"],
          "params": {
            "reject_if_split": true,
            "description": "Reject markets where quality wallets are on both sides"
          }
        }
      },
      {
        "id": "trade_signal",
        "type": "SIGNAL",
        "position": {"x": 1000, "y": 200},
        "config": {
          "signal_type": "ENTRY",
          "conditions": {
            "consensus_achieved": true,
            "no_conflict": true,
            "near_close": true
          },
          "metadata": {
            "confidence_source": "wallet_count",
            "conviction_tracking": "wallet_addresses",
            "side_source": "consensus_side"
          }
        }
      },
      {
        "id": "orchestrator",
        "type": "ORCHESTRATOR",
        "position": {"x": 1000, "y": 300},
        "config": {
          "mode": "execution",
          "portfolio_size_usd": 10000,
          "risk_tolerance": 3,
          "position_sizing_rules": {
            "method": "confidence_scaled",
            "base_pct": 0.5,
            "max_pct_per_market": 1.0,
            "scale_by": "supporting_wallet_count",
            "cap_at": 5
          },
          "entry_rules": {
            "order_type": "post_only_limit",
            "execution_window": "within_12h_of_close"
          },
          "exit_rules": {
            "hold_to_resolution": true,
            "early_exit_if": "all_supporting_wallets_exit",
            "stop_loss": null
          },
          "description": "Execute with directional conviction sizing based on wallet consensus"
        }
      }
    ],
    "edges": [
      {"from": "markets_source", "to": "category_filter"},
      {"from": "category_filter", "to": "time_filter"},
      {"from": "wallet_source", "to": "wallet_quality_filter"},
      {"from": "wallet_quality_filter", "to": "top_wallets"},
      {"from": "time_filter", "to": "consensus_detector"},
      {"from": "top_wallets", "to": "consensus_detector"},
      {"from": "consensus_detector", "to": "conflict_check"},
      {"from": "conflict_check", "to": "trade_signal"},
      {"from": "trade_signal", "to": "orchestrator"}
    ]
  }'::jsonb
);

-- Add comment
COMMENT ON COLUMN strategy_definitions.node_graph IS 'Consensus Copy Trade: Follows proven wallets when they align on same outcome near market close. Requires position tracking API and consensus detection logic in execution engine.';
