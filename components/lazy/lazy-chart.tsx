"use client"

import dynamic from "next/dynamic"
import { ChartSkeleton } from "@/components/ui/skeletons"

// Lazy load ECharts with loading state
export const LazyEChart = dynamic(
  () => import("echarts-for-react").then((mod) => mod.default),
  {
    loading: () => <ChartSkeleton />,
    ssr: false, // Disable SSR for charts
  }
)

// Lazy load heavy market components
export const LazyMarketDetail = dynamic(
  () => import("@/components/market-detail-interface").then((mod) => ({ default: mod.MarketDetail })),
  {
    loading: () => (
      <div className="flex flex-col gap-6 p-6">
        <ChartSkeleton className="mb-4" />
        <div className="grid grid-cols-2 gap-4">
          <ChartSkeleton height="h-[200px]" />
          <ChartSkeleton height="h-[200px]" />
        </div>
      </div>
    ),
  }
)

export const LazyWalletDetail = dynamic(
  () => import("@/components/wallet-detail-interface").then((mod) => ({ default: mod.WalletDetail })),
  {
    loading: () => (
      <div className="flex flex-col gap-6 p-6">
        <ChartSkeleton className="mb-4" />
        <ChartSkeleton height="h-[300px]" />
      </div>
    ),
  }
)

export const LazyEventDetail = dynamic(
  () => import("@/components/event-detail").then((mod) => ({ default: mod.EventDetail })),
  {
    loading: () => (
      <div className="flex flex-col gap-6 p-6">
        <ChartSkeleton height="h-[250px]" className="mb-4" />
      </div>
    ),
  }
)
