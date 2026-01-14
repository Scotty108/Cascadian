"use client";

import { Card } from "@/components/ui/card";
import { CoreMetricsGrid } from "./core-metrics-grid";
import type { WalletMetrics, TimeWindow } from "@/hooks/use-wallet-wio";
import type { FingerprintMetric } from "./types";

interface CombinedMetricsSectionProps {
  metrics: WalletMetrics;
  allMetrics: WalletMetrics[];
  fingerprintMetrics: FingerprintMetric[] | null | undefined;
  selectedWindow: TimeWindow;
  onWindowChange: (window: TimeWindow) => void;
}

export function CombinedMetricsSection({
  metrics,
  allMetrics,
  fingerprintMetrics,
  selectedWindow,
  onWindowChange,
}: CombinedMetricsSectionProps) {
  return (
    <Card className="p-5 bg-card border-border/50">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-muted-foreground">Performance Metrics</h3>
          <div className="flex gap-1">
            {(["30d", "90d", "ALL"] as TimeWindow[]).map((window) => (
              <button
                key={window}
                onClick={() => onWindowChange(window)}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  selectedWindow === window
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {window === "ALL" ? "All" : window.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        {fingerprintMetrics && fingerprintMetrics.length > 0 && (
          <CoreMetricsGrid metrics={fingerprintMetrics} />
        )}
      </div>
    </Card>
  );
}
