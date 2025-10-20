import { Progress } from "@/components/ui/progress"
import type { UsageItem } from "../types"
import { getUsageColor, getUsageVariant } from "../utils"

interface UsageProgressItemProps {
  item: UsageItem
}

export function UsageProgressItem({ item }: UsageProgressItemProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <p className="text-muted-foreground">{item.name}</p>
        <p className={`font-medium ${getUsageColor(item.percentage)}`}>
          {item.used} / {item.total} {item.unit || ""}
        </p>
      </div>
      <Progress
        value={item.percentage}
        className="h-2"
        // @ts-ignore - Progress component doesn't have variant prop in current version
        variant={getUsageVariant(item.percentage)}
      />
    </div>
  )
}
