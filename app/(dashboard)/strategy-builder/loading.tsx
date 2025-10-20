import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="-m-4 md:-m-6 flex h-[calc(100vh-64px)] w-[calc(100%+2rem)] md:w-[calc(100%+3rem)] flex-col bg-background">
      {/* Header Skeleton */}
      <div className="flex items-center justify-between border-b border-border bg-card px-6 py-4 shrink-0">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-20" />
        </div>
      </div>

      {/* Main Content Skeleton */}
      <div className="flex flex-1 overflow-hidden">
        {/* Node Palette Skeleton */}
        <div className="w-64 border-r border-border bg-card p-4">
          <Skeleton className="mb-4 h-6 w-32" />
          <div className="space-y-2">
            {[...Array(8)].map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        </div>

        {/* Canvas Skeleton */}
        <div className="flex-1 bg-background p-8">
          <div className="space-y-8">
            <div className="flex gap-4">
              <Skeleton className="h-32 w-48 rounded-lg" />
              <Skeleton className="h-32 w-48 rounded-lg" />
            </div>
            <div className="flex gap-4 pl-16">
              <Skeleton className="h-32 w-48 rounded-lg" />
              <Skeleton className="h-32 w-48 rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
