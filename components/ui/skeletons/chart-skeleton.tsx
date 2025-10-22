import { cn } from "@/lib/utils"

interface ChartSkeletonProps {
  className?: string
  height?: string
}

export function ChartSkeleton({ className, height = "h-[400px]" }: ChartSkeletonProps) {
  return (
    <div className={cn("animate-pulse", height, className)}>
      <div className="h-full bg-gradient-to-br from-muted/50 to-muted/20 rounded-lg flex items-center justify-center">
        <div className="space-y-3 w-full max-w-md px-8">
          {/* Chart bars animation */}
          <div className="flex items-end gap-2 h-32">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="flex-1 bg-[#00E0AA]/20 rounded-t animate-pulse"
                style={{
                  height: `${Math.random() * 100}%`,
                  animationDelay: `${i * 100}ms`,
                }}
              />
            ))}
          </div>
          {/* Labels */}
          <div className="flex justify-between">
            <div className="h-3 w-16 bg-muted rounded" />
            <div className="h-3 w-16 bg-muted rounded" />
            <div className="h-3 w-16 bg-muted rounded" />
          </div>
        </div>
      </div>
    </div>
  )
}
