-- Seed ALL Available Strategies (8 of 11)
-- Strategies 1-8 have all required metrics in wallet_metrics_complete
-- Strategies 9-11 need custom metrics (Phase 3)

-- Delete existing seeds to avoid conflicts
DELETE FROM strategy_definitions WHERE is_predefined = TRUE;

-- ============================================================================
-- Strategy 1: "Aggressive Growth" (Austin's "Make Money Now" Plan)
-- ============================================================================

INSERT INTO strategy_definitions (strategy_name, strategy_description, strategy_type, is_predefined, node_graph) VALUES
(
  'Aggressive Growth',
  'Maximize capital growth by finding the most profitable, asymmetric, and fast-moving traders. Filters for copy-able wallets with high convex returns, then sorts by fastest compounding metric (EV per hour).',
  'SCREENING',
  TRUE,
  '{
    "nodes": [
      {
        "type": "DATA_SOURCE",
        "id": "wallets",
        "config": {
          "source": "WALLETS",
          "prefilters": {
            "table": "wallet_metrics_complete",
            "where": "closed_positions >= 25"
          },
          "mode": "BATCH"
        }
      },
      {
        "type": "FILTER",
        "id": "activity",
        "config": {
          "field": "bets_per_week",
          "operator": "GREATER_THAN",
          "value": 3
        }
      },
      {
        "type": "FILTER",
        "id": "significance",
        "config": {
          "field": "closed_positions",
          "operator": "GREATER_THAN",
          "value": 25
        }
      },
      {
        "type": "FILTER",
        "id": "integrity",
        "config": {
          "field": "deposit_driven_pnl",
          "operator": "LESS_THAN",
          "value": 0.2
        }
      },
      {
        "type": "FILTER",
        "id": "quality",
        "config": {
          "field": "omega_ratio",
          "operator": "GREATER_THAN",
          "value": 3.0
        }
      },
      {
        "type": "FILTER",
        "id": "copyability",
        "config": {
          "field": "omega_lag_30s",
          "operator": "GREATER_THAN",
          "value": 2.0
        }
      },
      {
        "type": "FILTER",
        "id": "asymmetry",
        "config": {
          "field": "tail_ratio",
          "operator": "GREATER_THAN",
          "value": 3.0
        }
      },
      {
        "type": "LOGIC",
        "id": "combine",
        "config": {
          "operator": "AND",
          "inputs": ["activity", "significance", "integrity", "quality", "copyability", "asymmetry"]
        }
      },
      {
        "type": "AGGREGATION",
        "id": "sort_by_ev",
        "config": {
          "function": "MAX",
          "field": "ev_per_hour_capital"
        }
      }
    ],
    "edges": [
      {"from": "wallets", "to": "activity"},
      {"from": "wallets", "to": "significance"},
      {"from": "wallets", "to": "integrity"},
      {"from": "wallets", "to": "quality"},
      {"from": "wallets", "to": "copyability"},
      {"from": "wallets", "to": "asymmetry"},
      {"from": "activity", "to": "combine"},
      {"from": "significance", "to": "combine"},
      {"from": "integrity", "to": "combine"},
      {"from": "quality", "to": "combine"},
      {"from": "copyability", "to": "combine"},
      {"from": "asymmetry", "to": "combine"},
      {"from": "combine", "to": "sort_by_ev"}
    ]
  }'::jsonb
);

-- ============================================================================
-- Strategy 2: "Balanced Hybrid" (Already seeded, but re-insert for completeness)
-- ============================================================================

INSERT INTO strategy_definitions (strategy_name, strategy_description, strategy_type, is_predefined, node_graph) VALUES
(
  'Balanced Hybrid',
  'Find the most profitable traders who also pass a strong competency and risk-management test. Uses broad quality filter (Omega >= 2.0) and sorts by pure dollar profit.',
  'SCREENING',
  TRUE,
  '{
    "nodes": [
      {
        "type": "DATA_SOURCE",
        "id": "wallets",
        "config": {
          "source": "WALLETS",
          "prefilters": {
            "table": "wallet_scores",
            "where": "meets_minimum_trades = true"
          },
          "mode": "BATCH"
        }
      },
      {
        "type": "FILTER",
        "id": "activity",
        "config": {
          "field": "bets_per_week",
          "operator": "GREATER_THAN",
          "value": 1
        }
      },
      {
        "type": "FILTER",
        "id": "significance",
        "config": {
          "field": "closed_positions",
          "operator": "GREATER_THAN",
          "value": 50
        }
      },
      {
        "type": "FILTER",
        "id": "quality",
        "config": {
          "field": "omega_ratio",
          "operator": "GREATER_THAN",
          "value": 2.0
        }
      },
      {
        "type": "FILTER",
        "id": "risk",
        "config": {
          "field": "calmar_ratio",
          "operator": "GREATER_THAN",
          "value": 1.0
        }
      },
      {
        "type": "LOGIC",
        "id": "combine",
        "config": {
          "operator": "AND",
          "inputs": ["activity", "significance", "quality", "risk"]
        }
      },
      {
        "type": "AGGREGATION",
        "id": "sort_pnl",
        "config": {
          "function": "MAX",
          "field": "total_pnl"
        }
      }
    ],
    "edges": [
      {"from": "wallets", "to": "activity"},
      {"from": "wallets", "to": "significance"},
      {"from": "wallets", "to": "quality"},
      {"from": "wallets", "to": "risk"},
      {"from": "activity", "to": "combine"},
      {"from": "significance", "to": "combine"},
      {"from": "quality", "to": "combine"},
      {"from": "risk", "to": "combine"},
      {"from": "combine", "to": "sort_pnl"}
    ]
  }'::jsonb
);

-- ============================================================================
-- Strategy 3: "Eggman Hunter" (Already seeded, using category metrics)
-- ============================================================================

INSERT INTO strategy_definitions (strategy_name, strategy_description, strategy_type, is_predefined, node_graph) VALUES
(
  'Eggman Hunter (AI Specialist)',
  'Find the next "Eggman" in AI category by identifying true forecasting skill. Filters for category-specific perfection and copy-trade feasibility.',
  'SCREENING',
  TRUE,
  '{
    "nodes": [
      {
        "type": "DATA_SOURCE",
        "id": "category_scores",
        "config": {
          "source": "WALLETS",
          "prefilters": {
            "table": "wallet_metrics_by_category",
            "where": "closed_positions >= 10"
          },
          "mode": "BATCH"
        }
      },
      {
        "type": "FILTER",
        "id": "ai_category",
        "config": {
          "field": "category",
          "operator": "EQUALS",
          "value": "AI"
        }
      },
      {
        "type": "FILTER",
        "id": "specialization",
        "config": {
          "field": "closed_positions",
          "operator": "GREATER_THAN",
          "value": 10,
          "categorySpecific": {"enabled": true, "category": "AI"}
        }
      },
      {
        "type": "FILTER",
        "id": "true_skill",
        "config": {
          "field": "calibration_error",
          "operator": "LESS_THAN",
          "value": 0.1,
          "categorySpecific": {"enabled": true, "category": "AI"}
        }
      },
      {
        "type": "FILTER",
        "id": "copyability",
        "config": {
          "field": "omega_lag_2min",
          "operator": "GREATER_THAN",
          "value": 3.0,
          "categorySpecific": {"enabled": true, "category": "AI"}
        }
      },
      {
        "type": "FILTER",
        "id": "execution_skill",
        "config": {
          "field": "clv_lag_0s",
          "operator": "GREATER_THAN",
          "value": 0,
          "categorySpecific": {"enabled": true, "category": "AI"}
        }
      },
      {
        "type": "LOGIC",
        "id": "combine",
        "config": {
          "operator": "AND",
          "inputs": ["ai_category", "specialization", "true_skill", "copyability", "execution_skill"]
        }
      },
      {
        "type": "AGGREGATION",
        "id": "sort_ev",
        "config": {
          "function": "MAX",
          "field": "ev_per_hour_category"
        }
      }
    ],
    "edges": [
      {"from": "category_scores", "to": "ai_category"},
      {"from": "category_scores", "to": "specialization"},
      {"from": "category_scores", "to": "true_skill"},
      {"from": "category_scores", "to": "copyability"},
      {"from": "category_scores", "to": "execution_skill"},
      {"from": "ai_category", "to": "combine"},
      {"from": "specialization", "to": "combine"},
      {"from": "true_skill", "to": "combine"},
      {"from": "copyability", "to": "combine"},
      {"from": "execution_skill", "to": "combine"},
      {"from": "combine", "to": "sort_ev"}
    ]
  }'::jsonb
);

-- ============================================================================
-- Strategy 4: "Safe & Steady" (Sharpe Ratio Replacement)
-- ============================================================================

INSERT INTO strategy_definitions (strategy_name, strategy_description, strategy_type, is_predefined, node_graph) VALUES
(
  'Safe & Steady',
  'Find the most consistent, lowest-risk compounding wallets. Prioritizes downside protection and consistency using Sortino ratio (superior to Sharpe).',
  'SCREENING',
  TRUE,
  '{
    "nodes": [
      {
        "type": "DATA_SOURCE",
        "id": "wallets",
        "config": {
          "source": "WALLETS",
          "prefilters": {
            "table": "wallet_metrics_complete",
            "where": "closed_positions >= 100"
          },
          "mode": "BATCH"
        }
      },
      {
        "type": "FILTER",
        "id": "activity",
        "config": {
          "field": "bets_per_week",
          "operator": "GREATER_THAN",
          "value": 5
        }
      },
      {
        "type": "FILTER",
        "id": "significance",
        "config": {
          "field": "closed_positions",
          "operator": "GREATER_THAN",
          "value": 100
        }
      },
      {
        "type": "FILTER",
        "id": "drawdown_guard",
        "config": {
          "field": "max_drawdown",
          "operator": "GREATER_THAN",
          "value": -0.2
        }
      },
      {
        "type": "FILTER",
        "id": "recovery_speed",
        "config": {
          "field": "time_in_drawdown_pct",
          "operator": "LESS_THAN",
          "value": 0.3
        }
      },
      {
        "type": "LOGIC",
        "id": "combine",
        "config": {
          "operator": "AND",
          "inputs": ["activity", "significance", "drawdown_guard", "recovery_speed"]
        }
      },
      {
        "type": "AGGREGATION",
        "id": "sort_sortino",
        "config": {
          "function": "MAX",
          "field": "sortino_ratio"
        }
      }
    ],
    "edges": [
      {"from": "wallets", "to": "activity"},
      {"from": "wallets", "to": "significance"},
      {"from": "wallets", "to": "drawdown_guard"},
      {"from": "wallets", "to": "recovery_speed"},
      {"from": "activity", "to": "combine"},
      {"from": "significance", "to": "combine"},
      {"from": "drawdown_guard", "to": "combine"},
      {"from": "recovery_speed", "to": "combine"},
      {"from": "combine", "to": "sort_sortino"}
    ]
  }'::jsonb
);

-- ============================================================================
-- Strategy 5: "Momentum Rider" (Finding the "Hot Hand")
-- ============================================================================

INSERT INTO strategy_definitions (strategy_name, strategy_description, strategy_type, is_predefined, node_graph) VALUES
(
  'Momentum Rider',
  'Find traders currently on a hot streak or "in the zone". Identifies statistically significant improving performance.',
  'MOMENTUM',
  TRUE,
  '{
    "nodes": [
      {
        "type": "DATA_SOURCE",
        "id": "wallets",
        "config": {
          "source": "WALLETS",
          "prefilters": {
            "table": "wallet_metrics_complete",
            "where": "closed_positions >= 100"
          },
          "mode": "BATCH"
        }
      },
      {
        "type": "FILTER",
        "id": "activity",
        "config": {
          "field": "bets_per_week",
          "operator": "GREATER_THAN",
          "value": 5
        }
      },
      {
        "type": "FILTER",
        "id": "significance",
        "config": {
          "field": "closed_positions",
          "operator": "GREATER_THAN",
          "value": 100
        }
      },
      {
        "type": "FILTER",
        "id": "omega_trending_up",
        "config": {
          "field": "omega_momentum_30d",
          "operator": "GREATER_THAN",
          "value": 0
        }
      },
      {
        "type": "FILTER",
        "id": "clv_improving",
        "config": {
          "field": "clv_momentum_30d",
          "operator": "GREATER_THAN",
          "value": 0
        }
      },
      {
        "type": "LOGIC",
        "id": "combine",
        "config": {
          "operator": "AND",
          "inputs": ["activity", "significance", "omega_trending_up", "clv_improving"]
        }
      },
      {
        "type": "AGGREGATION",
        "id": "sort_hot_hand",
        "config": {
          "function": "MAX",
          "field": "hot_hand_z_score"
        }
      }
    ],
    "edges": [
      {"from": "wallets", "to": "activity"},
      {"from": "wallets", "to": "significance"},
      {"from": "wallets", "to": "omega_trending_up"},
      {"from": "wallets", "to": "clv_improving"},
      {"from": "activity", "to": "combine"},
      {"from": "significance", "to": "combine"},
      {"from": "omega_trending_up", "to": "combine"},
      {"from": "clv_improving", "to": "combine"},
      {"from": "combine", "to": "sort_hot_hand"}
    ]
  }'::jsonb
);

-- ============================================================================
-- Strategy 6: "Rising Star" (Finding the Next Elite Trader)
-- ============================================================================

INSERT INTO strategy_definitions (strategy_name, strategy_description, strategy_type, is_predefined, node_graph) VALUES
(
  'Rising Star',
  'Identify new traders demonstrating rapid increase in skill and discipline BEFORE they become famous. Finds wallets rapidly professionalizing.',
  'SCREENING',
  TRUE,
  '{
    "nodes": [
      {
        "type": "DATA_SOURCE",
        "id": "wallets",
        "config": {
          "source": "WALLETS",
          "prefilters": {
            "table": "wallet_metrics_complete",
            "where": "closed_positions >= 75"
          },
          "mode": "BATCH"
        }
      },
      {
        "type": "FILTER",
        "id": "experience",
        "config": {
          "field": "track_record_days",
          "operator": "BETWEEN",
          "value": [90, 365]
        }
      },
      {
        "type": "FILTER",
        "id": "significance",
        "config": {
          "field": "closed_positions",
          "operator": "GREATER_THAN",
          "value": 75
        }
      },
      {
        "type": "FILTER",
        "id": "improving_trend",
        "config": {
          "field": "performance_trend_flag",
          "operator": "EQUALS",
          "value": "Improving"
        }
      },
      {
        "type": "FILTER",
        "id": "professionalizing",
        "config": {
          "field": "sizing_discipline_trend",
          "operator": "LESS_THAN",
          "value": 0
        }
      },
      {
        "type": "LOGIC",
        "id": "combine",
        "config": {
          "operator": "AND",
          "inputs": ["experience", "significance", "improving_trend", "professionalizing"]
        }
      },
      {
        "type": "AGGREGATION",
        "id": "sort_ev_momentum",
        "config": {
          "function": "MAX",
          "field": "ev_per_hour_momentum_30d"
        }
      }
    ],
    "edges": [
      {"from": "wallets", "to": "experience"},
      {"from": "wallets", "to": "significance"},
      {"from": "wallets", "to": "improving_trend"},
      {"from": "wallets", "to": "professionalizing"},
      {"from": "experience", "to": "combine"},
      {"from": "significance", "to": "combine"},
      {"from": "improving_trend", "to": "combine"},
      {"from": "professionalizing", "to": "combine"},
      {"from": "combine", "to": "sort_ev_momentum"}
    ]
  }'::jsonb
);

-- ============================================================================
-- Strategy 7: "Alpha Decay Detector" (Who to Stop Copying)
-- ============================================================================

INSERT INTO strategy_definitions (strategy_name, strategy_description, strategy_type, is_predefined, node_graph) VALUES
(
  'Alpha Decay Detector',
  'Identify elite wallets that are no longer profitable to copy due to latency and crowding. Critical defensive strategy to know when to STOP copying.',
  'SCREENING',
  TRUE,
  '{
    "nodes": [
      {
        "type": "DATA_SOURCE",
        "id": "wallets",
        "config": {
          "source": "WALLETS",
          "prefilters": {
            "table": "wallet_metrics_complete",
            "where": "closed_positions >= 200"
          },
          "mode": "BATCH"
        }
      },
      {
        "type": "FILTER",
        "id": "was_elite",
        "config": {
          "field": "omega_ratio",
          "operator": "GREATER_THAN",
          "value": 5.0
        }
      },
      {
        "type": "FILTER",
        "id": "significance",
        "config": {
          "field": "closed_positions",
          "operator": "GREATER_THAN",
          "value": 200
        }
      },
      {
        "type": "FILTER",
        "id": "declining",
        "config": {
          "field": "performance_trend_flag",
          "operator": "EQUALS",
          "value": "Declining"
        }
      },
      {
        "type": "LOGIC",
        "id": "combine",
        "config": {
          "operator": "AND",
          "inputs": ["was_elite", "significance", "declining"]
        }
      },
      {
        "type": "AGGREGATION",
        "id": "sort_latency_penalty",
        "config": {
          "function": "MAX",
          "field": "latency_penalty_index"
        }
      }
    ],
    "edges": [
      {"from": "wallets", "to": "was_elite"},
      {"from": "wallets", "to": "significance"},
      {"from": "wallets", "to": "declining"},
      {"from": "was_elite", "to": "combine"},
      {"from": "significance", "to": "combine"},
      {"from": "declining", "to": "combine"},
      {"from": "combine", "to": "sort_latency_penalty"}
    ]
  }'::jsonb
);

-- ============================================================================
-- Strategy 8: "Fortress" (Survival-First Approach)
-- ============================================================================

INSERT INTO strategy_definitions (strategy_name, strategy_description, strategy_type, is_predefined, node_graph) VALUES
(
  'Fortress',
  'Identify wallets with the lowest possible chance of catastrophic loss. For the most risk-averse users seeking capital preservation.',
  'SCREENING',
  TRUE,
  '{
    "nodes": [
      {
        "type": "DATA_SOURCE",
        "id": "wallets",
        "config": {
          "source": "WALLETS",
          "prefilters": {
            "table": "wallet_metrics_complete",
            "where": "closed_positions >= 50"
          },
          "mode": "BATCH"
        }
      },
      {
        "type": "FILTER",
        "id": "single_trade_risk",
        "config": {
          "field": "max_single_trade_loss_pct",
          "operator": "LESS_THAN",
          "value": 0.05
        }
      },
      {
        "type": "FILTER",
        "id": "kelly_min",
        "config": {
          "field": "kelly_utilization_pct",
          "operator": "GREATER_THAN_OR_EQUAL",
          "value": 0.2
        }
      },
      {
        "type": "FILTER",
        "id": "kelly_max",
        "config": {
          "field": "kelly_utilization_pct",
          "operator": "LESS_THAN_OR_EQUAL",
          "value": 0.7
        }
      },
      {
        "type": "FILTER",
        "id": "tail_risk",
        "config": {
          "field": "cvar_95",
          "operator": "GREATER_THAN",
          "value": -0.1
        }
      },
      {
        "type": "LOGIC",
        "id": "combine",
        "config": {
          "operator": "AND",
          "inputs": ["single_trade_risk", "kelly_min", "kelly_max", "tail_risk"]
        }
      },
      {
        "type": "AGGREGATION",
        "id": "sort_safety",
        "config": {
          "function": "MIN",
          "field": "risk_of_ruin"
        }
      }
    ],
    "edges": [
      {"from": "wallets", "to": "single_trade_risk"},
      {"from": "wallets", "to": "kelly_min"},
      {"from": "wallets", "to": "kelly_max"},
      {"from": "wallets", "to": "tail_risk"},
      {"from": "single_trade_risk", "to": "combine"},
      {"from": "kelly_min", "to": "combine"},
      {"from": "kelly_max", "to": "combine"},
      {"from": "tail_risk", "to": "combine"},
      {"from": "combine", "to": "sort_safety"}
    ]
  }'::jsonb
);

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE strategy_definitions IS 'All 11 predefined strategies from DATABASE_ARCHITECT_SPEC.md. 8 available now, 3 need custom metrics (Phase 3).';
