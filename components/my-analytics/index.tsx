"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { AnalyticsTabs } from "./components/analytics-tabs";
import { KpiCards } from "./components/kpi-cards";
import { MarketSummary } from "./components/market-summary";
import { PerformanceChart } from "./components/performance-chart";
import { useColumns } from "./hooks/use-columns";
import { useFilters } from "./hooks/use-filters";
import type { SignalBot, SignalProvider, Trader } from "./types";

export function MyAnalytics() {
  const { filters, handleFilterChange, resetFilters } = useFilters();
  const { visibleColumns, handleColumnVisibilityChange, resetColumns } = useColumns();
  const { toast } = useToast();

  // Handler functions for button actions
  const handleEdit = (item: SignalBot | Trader | SignalProvider) => {
    console.log("Editing item:", item);
    toast({
      title: "Edit Initiated",
      description: `Editing ${item.name}`,
    });
    // Here you would typically open a modal or navigate to an edit page
  };

  const handleFollow = (item: Trader) => {
    console.log("Following trader:", item);
    toast({
      title: "Following Trader",
      description: `You are now following ${item.name}`,
      variant: "default",
    });
    // Implement follow functionality
  };

  const handleSubscribe = (item: SignalProvider) => {
    console.log("Subscribing to provider:", item);
    toast({
      title: "Subscribed",
      description: `You are now subscribed to ${item.name}`,
      variant: "default",
    });
    // Implement subscribe functionality
  };

  return (
    <div className="flex flex-col gap-4">
      <KpiCards />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <PerformanceChart />
        <MarketSummary />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col space-y-2">
            <CardTitle className="text-2xl">Signal Bots Performance</CardTitle>
            <CardTitle className="text-sm text-muted-foreground">Track and analyze your trading bots performance</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <AnalyticsTabs
            filters={filters}
            visibleColumns={visibleColumns}
            onFilterChange={handleFilterChange}
            onResetFilters={resetFilters}
            onColumnChange={handleColumnVisibilityChange}
            onResetColumns={resetColumns}
            onEdit={handleEdit}
            onFollow={handleFollow}
            onSubscribe={handleSubscribe}
          />
        </CardContent>
      </Card>
    </div>
  );
}
