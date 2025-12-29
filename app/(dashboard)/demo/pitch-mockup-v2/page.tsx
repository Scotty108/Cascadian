"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PitchDeckDashboard } from "@/components/pitch-mockup-v2/pitch-deck-dashboard";
import { EventIntelligenceDashboardV3 } from "@/components/pitch-mockup-v2/event-intelligence-dashboard-v3";

function PitchMockupContent() {
  const searchParams = useSearchParams();
  const eventSlug = searchParams.get("event");

  // If no event slug provided, show the original hardcoded demo
  if (!eventSlug) {
    return <PitchDeckDashboard />;
  }

  // If event slug provided, show the real event intelligence dashboard (V3)
  return <EventIntelligenceDashboardV3 eventSlug={eventSlug} />;
}

export default function PitchMockupPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <PitchMockupContent />
    </Suspense>
  );
}

function DashboardSkeleton() {
  return (
    <div className="h-[calc(100vh-4rem)] p-2">
      <div className="flex h-full overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
        <div className="flex-1 flex flex-col overflow-hidden animate-pulse">
          {/* Header skeleton */}
          <div className="flex-shrink-0 px-5 pt-3 pb-2">
            <div className="h-8 w-96 bg-zinc-200 dark:bg-zinc-800 rounded" />
            <div className="mt-2 flex gap-4">
              <div className="h-5 w-24 bg-zinc-200 dark:bg-zinc-800 rounded" />
              <div className="h-5 w-24 bg-zinc-200 dark:bg-zinc-800 rounded" />
              <div className="h-5 w-24 bg-zinc-200 dark:bg-zinc-800 rounded" />
            </div>
          </div>
          {/* Chart skeleton */}
          <div className="flex-1 px-5 py-4">
            <div className="h-[360px] bg-zinc-200 dark:bg-zinc-800 rounded-lg" />
          </div>
        </div>
        {/* Sidebar skeleton */}
        <div className="w-[480px] border-l border-zinc-200 dark:border-zinc-800 p-4">
          <div className="h-6 w-48 bg-zinc-200 dark:bg-zinc-800 rounded mb-4" />
          <div className="space-y-3">
            <div className="h-16 bg-zinc-200 dark:bg-zinc-800 rounded" />
            <div className="h-16 bg-zinc-200 dark:bg-zinc-800 rounded" />
            <div className="h-16 bg-zinc-200 dark:bg-zinc-800 rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}
