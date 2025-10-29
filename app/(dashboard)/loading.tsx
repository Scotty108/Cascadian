"use client";

import { Card } from "@/components/ui/card";

export default function DashboardLoading() {
  return (
    <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
      <div className="px-6 pt-5 pb-3 border-b border-border/50">
        <div className="h-8 bg-muted rounded w-1/3 mb-2 animate-pulse"></div>
        <div className="h-4 bg-muted rounded w-2/3 animate-pulse"></div>
      </div>
      <div className="px-6 py-4 border-b border-border/50">
        <div className="flex gap-2">
          <div className="h-9 w-20 bg-muted rounded animate-pulse"></div>
          <div className="h-9 w-20 bg-muted rounded animate-pulse"></div>
          <div className="h-9 w-20 bg-muted rounded animate-pulse"></div>
        </div>
      </div>
      <div className="px-6 py-6">
        <div className="h-[600px] bg-muted rounded-lg animate-pulse"></div>
      </div>
    </Card>
  );
}
