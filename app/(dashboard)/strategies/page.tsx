'use client';

import { StrategyDashboardOverview } from "@/components/strategy-dashboard-overview";
import { useStrategies } from "@/hooks/use-strategies";
import { Loader2, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function StrategiesPage() {
  const { strategies, loading, error, refresh } = useStrategies();

  if (loading) {
    return (
      <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
        <div className="px-6 py-12">
          <div className="flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-[#00E0AA]" />
          </div>
          <p className="text-center text-sm text-muted-foreground mt-4">Loading strategies...</p>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
        <div className="px-6 py-12">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 mb-4">
              <AlertCircle className="h-6 w-6 text-red-500" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Unable to Load Strategies</h3>
            <p className="text-sm text-muted-foreground mb-6">
              {error}
            </p>
            {refresh && (
              <Button onClick={refresh} className="bg-[#00E0AA] text-slate-950 hover:bg-[#00E0AA]/90">
                Retry
              </Button>
            )}
          </div>
        </div>
      </Card>
    );
  }

  return <StrategyDashboardOverview strategies={strategies} />;
}
