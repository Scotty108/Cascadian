"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Hexagon, Target, PieChart } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FingerprintRadarChart } from "./fingerprint-radar-chart";
import { FingerprintPolarChart } from "./fingerprint-polar-chart";
import { FingerprintHexBadge } from "./fingerprint-hex-badge";
import type { FingerprintMetric, ChartVariant } from "./types";

interface FingerprintSectionProps {
  metrics: FingerprintMetric[];
  overallScore: number;
}

export function FingerprintSection({
  metrics,
  overallScore,
}: FingerprintSectionProps) {
  const [variant, setVariant] = useState<ChartVariant>("radar");

  return (
    <Card className="p-6 shadow-sm rounded-2xl border-0 dark:bg-[#18181b] overflow-hidden relative">
      {/* Subtle glow effect */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#00E0AA]/5 via-transparent to-[#3B82F6]/5 pointer-events-none" />

      <div className="relative z-10">
        {/* Header with title and variant toggle */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
              Wallet Fingerprint
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Multi-dimensional performance profile
            </p>
          </div>

          <Tabs
            value={variant}
            onValueChange={(v) => setVariant(v as ChartVariant)}
          >
            <TabsList className="grid grid-cols-3 gap-1">
              <TabsTrigger
                value="radar"
                className="flex items-center gap-2 px-3"
              >
                <Target className="h-4 w-4" />
                <span className="hidden sm:inline">Radar</span>
              </TabsTrigger>
              <TabsTrigger
                value="polar"
                className="flex items-center gap-2 px-3"
              >
                <PieChart className="h-4 w-4" />
                <span className="hidden sm:inline">Polar</span>
              </TabsTrigger>
              <TabsTrigger
                value="hexagon"
                className="flex items-center gap-2 px-3"
              >
                <Hexagon className="h-4 w-4" />
                <span className="hidden sm:inline">Badge</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Chart container with animation */}
        <div className="relative min-h-[400px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={variant}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0"
            >
              {variant === "radar" && (
                <FingerprintRadarChart metrics={metrics} size={400} />
              )}
              {variant === "polar" && (
                <FingerprintPolarChart metrics={metrics} size={400} />
              )}
              {variant === "hexagon" && (
                <FingerprintHexBadge metrics={metrics} size={400} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Overall score indicator */}
        <div className="mt-4 flex items-center justify-center">
          <div className="flex items-center gap-3 px-4 py-2 rounded-full bg-slate-100 dark:bg-slate-800">
            <span className="text-sm text-muted-foreground">Overall Score</span>
            <span className="text-2xl font-bold text-[#00E0AA]">
              {overallScore}
            </span>
            <span className="text-sm text-muted-foreground">/100</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
