'use client';

import { StrategyDashboardOverview } from "@/components/strategy-dashboard-overview";
import { useStrategies } from "@/hooks/use-strategies";
import { Loader2 } from "lucide-react";

export default function StrategiesPage() {
  const { strategies, loading, error } = useStrategies();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-[#00E0AA]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-red-500">Error: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <StrategyDashboardOverview strategies={strategies} />
    </div>
  );
}
