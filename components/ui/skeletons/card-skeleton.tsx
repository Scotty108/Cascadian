import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"

interface CardSkeletonProps {
  className?: string
  showHeader?: boolean
  lines?: number
}

export function CardSkeleton({ className, showHeader = true, lines = 3 }: CardSkeletonProps) {
  return (
    <Card className={cn("p-6 animate-pulse", className)}>
      {showHeader && (
        <div className="mb-4">
          <div className="h-6 w-32 bg-muted rounded mb-2" />
          <div className="h-4 w-48 bg-muted/60 rounded" />
        </div>
      )}
      <div className="space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="h-4 bg-muted rounded"
            style={{ width: `${Math.random() * 40 + 60}%` }}
          />
        ))}
      </div>
    </Card>
  )
}
