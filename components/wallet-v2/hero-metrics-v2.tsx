"use client";

import { motion } from "framer-motion";
import { MetricCard } from "@/components/ui/metric-card";
import {
  TrendingUp,
  Target,
  Activity,
  DollarSign,
  BarChart3,
  Calendar,
  Percent,
  Zap,
} from "lucide-react";
import type { FingerprintMetric } from "./types";

interface HeroMetricsV2Props {
  // From WIO fingerprint
  metrics: FingerprintMetric[];
  overallScore: number;

  // From Polymarket hooks
  totalPnL: number;
  unrealizedPnL: number;
  activePositions: number;
  activeValue: number;
  totalInvested: number;
  totalTrades: number;
  marketsTraded: number;
  daysActive: number;
  pnlSparkline?: number[];
}

export function HeroMetricsV2({
  metrics,
  overallScore,
  totalPnL,
  unrealizedPnL,
  activePositions,
  activeValue,
  totalInvested,
  totalTrades,
  marketsTraded,
  daysActive,
  pnlSparkline,
}: HeroMetricsV2Props) {
  const formatPnL = (value: number) => {
    const abs = Math.abs(value);
    if (abs >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
    if (abs >= 1000) return `$${(value / 1000).toFixed(1)}k`;
    return `$${value.toFixed(0)}`;
  };

  // Find specific metrics from fingerprint
  const winRateMetric = metrics.find((m) => m.key === "win_rate");
  const roiMetric = metrics.find((m) => m.key === "roi");
  const credibilityMetric = metrics.find((m) => m.key === "credibility");
  const edgeMetric = metrics.find((m) => m.key === "edge");

  const winRate = winRateMetric?.raw ?? 0;
  const roi = roiMetric?.raw ?? 0;

  // ROI percentage for display
  const roiPct = roi * 100;

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.05,
      },
    },
  };

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 },
  };

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="grid grid-cols-2 md:grid-cols-4 gap-4"
    >
      {/* Total PnL */}
      <motion.div variants={item}>
        <MetricCard
          label="Total PnL"
          value={formatPnL(totalPnL)}
          change={`${roiPct >= 0 ? "+" : ""}${roiPct.toFixed(1)}% ROI`}
          changeType={totalPnL >= 0 ? "positive" : "negative"}
          icon={<TrendingUp className="h-4 w-4" />}
          sparklineData={pnlSparkline}
        />
      </motion.div>

      {/* Win Rate */}
      <motion.div variants={item}>
        <MetricCard
          label="Win Rate"
          value={`${(winRate * 100).toFixed(1)}%`}
          change={winRateMetric?.displayValue || ""}
          changeType={
            winRate >= 0.6 ? "positive" : winRate >= 0.5 ? "neutral" : "negative"
          }
          icon={<Target className="h-4 w-4" />}
        />
      </motion.div>

      {/* Overall Score */}
      <motion.div variants={item}>
        <MetricCard
          label="Fingerprint Score"
          value={`${overallScore}/100`}
          change={
            overallScore >= 80
              ? "Excellent"
              : overallScore >= 60
              ? "Good"
              : overallScore >= 40
              ? "Average"
              : "Below Average"
          }
          changeType={
            overallScore >= 70
              ? "positive"
              : overallScore >= 50
              ? "neutral"
              : "negative"
          }
          icon={<Zap className="h-4 w-4" />}
        />
      </motion.div>

      {/* Active Positions */}
      <motion.div variants={item}>
        <MetricCard
          label="Active Positions"
          value={activePositions}
          change={`${formatPnL(activeValue)} invested`}
          changeType={unrealizedPnL >= 0 ? "positive" : "negative"}
          icon={<Activity className="h-4 w-4" />}
        />
      </motion.div>

      {/* Total Invested */}
      <motion.div variants={item}>
        <MetricCard
          label="Total Invested"
          value={formatPnL(totalInvested)}
          change={`${daysActive} days active`}
          changeType="neutral"
          icon={<DollarSign className="h-4 w-4" />}
        />
      </motion.div>

      {/* Credibility */}
      <motion.div variants={item}>
        <MetricCard
          label="Credibility"
          value={credibilityMetric?.displayValue || "N/A"}
          change={
            (credibilityMetric?.raw ?? 0) >= 0.7
              ? "High trust"
              : (credibilityMetric?.raw ?? 0) >= 0.5
              ? "Moderate"
              : "Building"
          }
          changeType={
            (credibilityMetric?.raw ?? 0) >= 0.7
              ? "positive"
              : (credibilityMetric?.raw ?? 0) >= 0.5
              ? "neutral"
              : "negative"
          }
          icon={<Percent className="h-4 w-4" />}
        />
      </motion.div>

      {/* Edge (CLV) */}
      <motion.div variants={item}>
        <MetricCard
          label="Market Edge"
          value={edgeMetric?.displayValue || "N/A"}
          change={
            (edgeMetric?.raw ?? 0) > 0
              ? "Beats market"
              : (edgeMetric?.raw ?? 0) === 0
              ? "Neutral"
              : "Chased odds"
          }
          changeType={
            (edgeMetric?.raw ?? 0) > 0
              ? "positive"
              : (edgeMetric?.raw ?? 0) === 0
              ? "neutral"
              : "negative"
          }
          icon={<BarChart3 className="h-4 w-4" />}
        />
      </motion.div>

      {/* Markets Traded */}
      <motion.div variants={item}>
        <MetricCard
          label="Markets Traded"
          value={marketsTraded}
          change={`${totalTrades} trades`}
          changeType="neutral"
          icon={<Calendar className="h-4 w-4" />}
        />
      </motion.div>
    </motion.div>
  );
}
