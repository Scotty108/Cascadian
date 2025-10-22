"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TrendingUp,
  Filter,
  BarChart3,
  Users,
  Zap,
  Target,
  Activity,
  DollarSign,
  Clock,
  LineChart,
  Percent,
  Hash,
  GitBranch,
  Layers,
  AlertTriangle
} from "lucide-react";

// Signal categories and their contents
const signalCategories = {
  momentum: {
    title: "Momentum Signals",
    icon: TrendingUp,
    description: "Track price movement and trading momentum",
    signals: [
      {
        name: "Price Momentum",
        key: "price_momentum",
        description: "Measures the rate of price change over a specific time period",
        inputs: ["timeframe", "threshold"],
        outputs: ["momentum_score", "direction"],
        example: "Price increased 15% in the last 24 hours"
      },
      {
        name: "Volume Momentum",
        key: "volume_momentum",
        description: "Tracks changes in trading volume relative to historical averages",
        inputs: ["lookback_period", "volume_threshold"],
        outputs: ["volume_score", "trend"],
        example: "Volume is 250% above 7-day average"
      },
      {
        name: "Volatility Index",
        key: "volatility",
        description: "Measures price volatility and market uncertainty",
        inputs: ["period", "method"],
        outputs: ["volatility_score", "stability_rating"],
        example: "High volatility detected (score: 75)"
      },
      {
        name: "Trend Strength",
        key: "trend_strength",
        description: "Evaluates the strength and consistency of price trends",
        inputs: ["trend_period", "sensitivity"],
        outputs: ["strength_score", "confidence"],
        example: "Strong upward trend (confidence: 85%)"
      }
    ]
  },
  smartMoney: {
    title: "Smart Money Signals",
    icon: Users,
    description: "Follow high-performing traders and whale activity",
    signals: [
      {
        name: "Whale Activity",
        key: "whale_activity",
        description: "Detects large position changes by high-value traders",
        inputs: ["min_position_size", "timeframe"],
        outputs: ["whale_trades", "net_flow", "direction"],
        example: "3 whales bought $50k YES in last hour"
      },
      {
        name: "Smart Trader Consensus",
        key: "smart_consensus",
        description: "Tracks positioning of top-performing traders (high WIS score)",
        inputs: ["min_wis_score", "sample_size"],
        outputs: ["consensus_side", "agreement_percentage"],
        example: "75% of smart traders hold YES position"
      },
      {
        name: "Position Concentration",
        key: "position_concentration",
        description: "Measures how concentrated positions are among top holders",
        inputs: ["top_n_holders"],
        outputs: ["concentration_score", "holder_distribution"],
        example: "Top 10 holders control 60% of supply"
      },
      {
        name: "Insider Activity",
        key: "insider_activity",
        description: "Tracks trading by wallets with information advantages",
        inputs: ["insider_threshold", "lookback_hours"],
        outputs: ["insider_signal", "confidence"],
        example: "Insider wallets accumulating YES"
      }
    ]
  },
  liquidity: {
    title: "Liquidity & Market Quality",
    icon: DollarSign,
    description: "Assess market depth and trading conditions",
    signals: [
      {
        name: "Bid-Ask Spread",
        key: "spread",
        description: "Measures the gap between bid and ask prices",
        inputs: ["unit"],
        outputs: ["spread_bps", "quality_rating"],
        example: "Tight spread: 15 basis points"
      },
      {
        name: "Liquidity Depth",
        key: "liquidity_depth",
        description: "Evaluates available liquidity at various price levels",
        inputs: ["price_range"],
        outputs: ["depth_score", "support_levels"],
        example: "$10k liquidity within 2% of mid"
      },
      {
        name: "Slippage Estimate",
        key: "slippage",
        description: "Predicts price impact for a given trade size",
        inputs: ["trade_size"],
        outputs: ["expected_slippage", "impact_percentage"],
        example: "$1k trade would move price 0.5%"
      },
      {
        name: "Market Efficiency",
        key: "market_efficiency",
        description: "Assesses how efficiently the market reflects information",
        inputs: ["comparison_markets"],
        outputs: ["efficiency_score", "arbitrage_opportunity"],
        example: "Market is 5% mispriced vs related markets"
      }
    ]
  },
  timing: {
    title: "Timing Signals",
    icon: Clock,
    description: "Identify optimal entry and exit points",
    signals: [
      {
        name: "Urgency Score",
        key: "urgency",
        description: "Combines time to close and recent activity to prioritize markets",
        inputs: ["time_weight", "activity_weight"],
        outputs: ["urgency_score", "recommendation"],
        example: "High urgency: closes in 6 hours with increasing volume"
      },
      {
        name: "Entry Timing",
        key: "entry_timing",
        description: "Identifies favorable moments to enter a position",
        inputs: ["signal_combination", "confidence_threshold"],
        outputs: ["entry_signal", "timing_score"],
        example: "Strong entry signal (score: 80/100)"
      },
      {
        name: "Exit Timing",
        key: "exit_timing",
        description: "Signals when to close or reduce positions",
        inputs: ["profit_target", "stop_loss", "time_decay"],
        outputs: ["exit_signal", "recommended_action"],
        example: "Consider exiting: 90% of max profit captured"
      },
      {
        name: "Event Catalyst",
        key: "event_catalyst",
        description: "Tracks upcoming events that may affect market prices",
        inputs: ["event_calendar", "impact_threshold"],
        outputs: ["catalyst_detected", "expected_impact"],
        example: "Major news event in 2 hours"
      }
    ]
  },
  technical: {
    title: "Technical Indicators",
    icon: LineChart,
    description: "Classic technical analysis tools",
    signals: [
      {
        name: "SII (Signal Intelligence Index)",
        key: "sii",
        description: "CASCADIAN's proprietary composite signal combining multiple factors",
        inputs: ["factors_to_include", "weights"],
        outputs: ["sii_score", "component_breakdown"],
        example: "SII Score: 72 (Strong Buy)"
      },
      {
        name: "Moving Average Crossover",
        key: "ma_crossover",
        description: "Detects when short and long-term moving averages cross",
        inputs: ["short_period", "long_period"],
        outputs: ["crossover_signal", "trend_direction"],
        example: "Bullish crossover: 4h MA crossed above 24h MA"
      },
      {
        name: "RSI (Relative Strength)",
        key: "rsi",
        description: "Identifies overbought or oversold conditions",
        inputs: ["period", "overbought_level", "oversold_level"],
        outputs: ["rsi_value", "condition"],
        example: "RSI: 68 (Approaching overbought)"
      },
      {
        name: "Support & Resistance",
        key: "support_resistance",
        description: "Identifies key price levels based on historical data",
        inputs: ["lookback_period", "strength_threshold"],
        outputs: ["support_levels", "resistance_levels"],
        example: "Strong support at 62¢, resistance at 68¢"
      }
    ]
  }
};

const filterCategories = {
  market: {
    title: "Market Filters",
    icon: Filter,
    description: "Filter markets by characteristics",
    filters: [
      {
        name: "Category",
        key: "category",
        type: "select",
        options: ["Politics", "Sports", "Crypto", "Tech", "Entertainment", "Economics"],
        description: "Filter by market category"
      },
      {
        name: "Volume Range",
        key: "volume_range",
        type: "range",
        min: 0,
        max: 10000000,
        description: "Filter by 24h trading volume"
      },
      {
        name: "Liquidity Range",
        key: "liquidity_range",
        type: "range",
        min: 0,
        max: 1000000,
        description: "Filter by available liquidity"
      },
      {
        name: "Time to Close",
        key: "time_to_close",
        type: "range",
        min: 0,
        max: 720,
        unit: "hours",
        description: "Filter by hours until market closes"
      },
      {
        name: "Price Range",
        key: "price_range",
        type: "range",
        min: 0,
        max: 100,
        unit: "cents",
        description: "Filter by current YES price"
      }
    ]
  },
  signal: {
    title: "Signal Filters",
    icon: Zap,
    description: "Filter by signal strength and conditions",
    filters: [
      {
        name: "SII Score",
        key: "sii_score",
        type: "range",
        min: 0,
        max: 100,
        description: "Filter by Signal Intelligence Index score"
      },
      {
        name: "Momentum",
        key: "momentum",
        type: "select",
        options: ["Strong Positive", "Positive", "Neutral", "Negative", "Strong Negative"],
        description: "Filter by momentum direction"
      },
      {
        name: "Smart Money Position",
        key: "smart_money",
        type: "select",
        options: ["Bullish", "Neutral", "Bearish"],
        description: "Filter by smart trader positioning"
      },
      {
        name: "Confidence Level",
        key: "confidence",
        type: "range",
        min: 0,
        max: 100,
        unit: "%",
        description: "Filter by signal confidence"
      }
    ]
  },
  risk: {
    title: "Risk Filters",
    icon: AlertTriangle,
    description: "Filter by risk characteristics",
    filters: [
      {
        name: "Volatility",
        key: "volatility",
        type: "select",
        options: ["Low", "Medium", "High", "Extreme"],
        description: "Filter by price volatility"
      },
      {
        name: "Spread",
        key: "spread",
        type: "range",
        min: 0,
        max: 500,
        unit: "bps",
        description: "Filter by bid-ask spread"
      },
      {
        name: "Holder Concentration",
        key: "concentration",
        type: "range",
        min: 0,
        max: 100,
        unit: "%",
        description: "Filter by top holder concentration"
      }
    ]
  }
};

const nodes = [
  {
    name: "Condition",
    icon: GitBranch,
    type: "logic",
    description: "Create if/then logic branches",
    inputs: ["condition", "true_path", "false_path"],
    outputs: ["result"],
    example: "IF momentum > 50 THEN buy ELSE wait"
  },
  {
    name: "Combiner",
    icon: Layers,
    type: "logic",
    description: "Combine multiple signals with AND/OR logic",
    inputs: ["signal_a", "signal_b", "operator"],
    outputs: ["combined_result"],
    example: "Buy when (SII > 70) AND (volume > avg)"
  },
  {
    name: "Threshold",
    icon: Target,
    type: "trigger",
    description: "Trigger action when value crosses threshold",
    inputs: ["value", "threshold", "direction"],
    outputs: ["trigger_signal"],
    example: "Alert when price crosses 65¢"
  },
  {
    name: "Aggregator",
    icon: BarChart3,
    type: "calculation",
    description: "Calculate aggregate values (sum, average, max, min)",
    inputs: ["values[]", "function"],
    outputs: ["result"],
    example: "Calculate average SII across 10 markets"
  },
  {
    name: "Comparator",
    icon: Activity,
    type: "logic",
    description: "Compare two values (>, <, =, >=, <=)",
    inputs: ["value_a", "value_b", "operator"],
    outputs: ["comparison_result"],
    example: "Is current_price > yesterday_price?"
  },
  {
    name: "Timer",
    icon: Clock,
    type: "trigger",
    description: "Execute actions on a schedule",
    inputs: ["interval", "start_time"],
    outputs: ["tick_signal"],
    example: "Check signals every 15 minutes"
  },
  {
    name: "Position Sizer",
    icon: Percent,
    type: "calculation",
    description: "Calculate optimal position size based on confidence and risk",
    inputs: ["confidence", "risk_tolerance", "max_position"],
    outputs: ["position_size"],
    example: "Allocate 5% of capital when confidence > 80%"
  },
  {
    name: "Risk Manager",
    icon: AlertTriangle,
    type: "control",
    description: "Apply stop-loss and take-profit rules",
    inputs: ["entry_price", "stop_loss_%", "take_profit_%"],
    outputs: ["exit_signal"],
    example: "Exit if loss > 10% or profit > 25%"
  }
];

export function IntelligenceSignals() {
  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Intelligence Signals</h1>
        <p className="text-muted-foreground mt-2">
          Comprehensive guide to all signals, filters, and nodes available in the Strategy Builder
        </p>
      </div>

      {/* Main Content */}
      <Tabs defaultValue="signals" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="signals">Signals</TabsTrigger>
          <TabsTrigger value="filters">Filters</TabsTrigger>
          <TabsTrigger value="nodes">Nodes</TabsTrigger>
        </TabsList>

        {/* Signals Tab */}
        <TabsContent value="signals" className="space-y-6 mt-6">
          {Object.entries(signalCategories).map(([key, category]) => {
            const IconComponent = category.icon;
            return (
              <Card key={key} className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <IconComponent className="h-6 w-6 text-primary" />
                  <div>
                    <h2 className="text-2xl font-semibold">{category.title}</h2>
                    <p className="text-sm text-muted-foreground">{category.description}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {category.signals.map((signal) => (
                    <Card key={signal.key} className="p-4 border-2 hover:border-primary transition-colors">
                      <div className="flex items-start justify-between mb-3">
                        <h3 className="font-semibold text-lg">{signal.name}</h3>
                        <Badge variant="outline">{signal.key}</Badge>
                      </div>

                      <p className="text-sm text-muted-foreground mb-4">{signal.description}</p>

                      <div className="space-y-2 text-sm">
                        <div>
                          <span className="font-medium text-xs text-muted-foreground">INPUTS:</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {signal.inputs.map((input) => (
                              <Badge key={input} variant="secondary" className="text-xs">
                                {input}
                              </Badge>
                            ))}
                          </div>
                        </div>

                        <div>
                          <span className="font-medium text-xs text-muted-foreground">OUTPUTS:</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {signal.outputs.map((output) => (
                              <Badge key={output} variant="default" className="text-xs">
                                {output}
                              </Badge>
                            ))}
                          </div>
                        </div>

                        <div className="pt-2 border-t mt-3">
                          <span className="font-medium text-xs text-muted-foreground">EXAMPLE:</span>
                          <p className="text-xs mt-1 italic">{signal.example}</p>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </Card>
            );
          })}
        </TabsContent>

        {/* Filters Tab */}
        <TabsContent value="filters" className="space-y-6 mt-6">
          {Object.entries(filterCategories).map(([key, category]) => {
            const IconComponent = category.icon;
            return (
              <Card key={key} className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <IconComponent className="h-6 w-6 text-primary" />
                  <div>
                    <h2 className="text-2xl font-semibold">{category.title}</h2>
                    <p className="text-sm text-muted-foreground">{category.description}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {category.filters.map((filter) => (
                    <Card key={filter.key} className="p-4 border-2">
                      <div className="flex items-start justify-between mb-2">
                        <h3 className="font-semibold">{filter.name}</h3>
                        <Badge variant="outline" className="text-xs">{filter.type}</Badge>
                      </div>

                      <p className="text-sm text-muted-foreground mb-3">{filter.description}</p>

                      {filter.type === "select" && filter.options && (
                        <div className="flex flex-wrap gap-1">
                          {filter.options.map((option) => (
                            <Badge key={option} variant="secondary" className="text-xs">
                              {option}
                            </Badge>
                          ))}
                        </div>
                      )}

                      {filter.type === "range" && (
                        <div className="text-xs text-muted-foreground">
                          Range: {filter.min} - {filter.max} {filter.unit || ""}
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              </Card>
            );
          })}
        </TabsContent>

        {/* Nodes Tab */}
        <TabsContent value="nodes" className="space-y-6 mt-6">
          <Card className="p-6">
            <div className="mb-6">
              <h2 className="text-2xl font-semibold mb-2">Strategy Builder Nodes</h2>
              <p className="text-sm text-muted-foreground">
                Connect these nodes to create complex trading strategies and automation workflows
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {nodes.map((node) => {
                const IconComponent = node.icon;
                return (
                  <Card key={node.name} className="p-5 border-2 hover:border-primary transition-colors">
                    <div className="flex items-center gap-3 mb-3">
                      <IconComponent className="h-5 w-5 text-primary" />
                      <div className="flex-1">
                        <h3 className="font-semibold text-lg">{node.name}</h3>
                        <Badge variant="outline" className="text-xs">{node.type}</Badge>
                      </div>
                    </div>

                    <p className="text-sm text-muted-foreground mb-4">{node.description}</p>

                    <div className="space-y-2 text-sm">
                      <div>
                        <span className="font-medium text-xs text-muted-foreground">INPUTS:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {node.inputs.map((input) => (
                            <Badge key={input} variant="secondary" className="text-xs">
                              {input}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      <div>
                        <span className="font-medium text-xs text-muted-foreground">OUTPUTS:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {node.outputs.map((output) => (
                            <Badge key={output} variant="default" className="text-xs">
                              {output}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      <div className="pt-2 border-t mt-3">
                        <span className="font-medium text-xs text-muted-foreground">EXAMPLE:</span>
                        <p className="text-xs mt-1 italic">{node.example}</p>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
