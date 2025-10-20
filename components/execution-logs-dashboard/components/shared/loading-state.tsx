import { Loader2 } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"

export const LoadingState = () => {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="flex justify-between items-center">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>

      {/* Filters skeleton */}
      <div className="flex gap-2 flex-wrap">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-10 w-32" />
      </div>

      {/* Table skeleton */}
      <div className="border rounded-lg">
        <div className="p-4 border-b bg-muted/40">
          <div className="flex justify-between">
            <Skeleton className="h-5 w-full max-w-[800px]" />
          </div>
        </div>

        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="p-4 border-b">
            <div className="space-y-2">
              <Skeleton className="h-5 w-full" />
              <div className="flex gap-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-32" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Loading indicator */}
      <div className="flex justify-center items-center py-4">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
        <span className="ml-2 text-sm">Loading execution logs...</span>
      </div>
    </div>
  )
}
