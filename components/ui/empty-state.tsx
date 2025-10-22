import { LucideIcon } from "lucide-react"
import { Button } from "./button"

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  action?: {
    label: string
    onClick: () => void
  }
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="rounded-full bg-muted/50 p-6 mb-4">
        <Icon className="h-12 w-12 text-muted-foreground" />
      </div>
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground max-w-md mb-6">{description}</p>
      {action && (
        <Button onClick={action.onClick} className="gap-2">
          {action.label}
        </Button>
      )}
    </div>
  )
}

// Preset empty states
export function NoMarketsFound() {
  return (
    <EmptyState
      icon={require("lucide-react").Search}
      title="No markets found"
      description="Try adjusting your filters or search terms to find what you're looking for."
    />
  )
}

export function NoDataAvailable() {
  return (
    <EmptyState
      icon={require("lucide-react").Database}
      title="No data available"
      description="We don't have any data to display yet. Check back soon!"
    />
  )
}

export function NoPositions() {
  return (
    <EmptyState
      icon={require("lucide-react").Wallet}
      title="No active positions"
      description="You don't have any open positions yet. Start trading to see them here."
    />
  )
}
