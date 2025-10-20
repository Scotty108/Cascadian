import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowDownUp, TrendingUp, TrendingDown } from "lucide-react"
import type { ExecutionLog } from "../../types"
import { formatAmount } from "../../utils"

interface LogTradeTabProps {
  log: ExecutionLog
}

export const LogTradeTab = ({ log }: LogTradeTabProps) => {
  // Check if this log has trade information
  const hasTrade = log.details?.pair && (log.details?.amount || log.details?.price)

  if (!hasTrade) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <ArrowDownUp className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">No trade information</h3>
        <p className="text-muted-foreground max-w-md">This log entry does not contain any trade-related information.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Trade Overview */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Trade Overview</CardTitle>
          <CardDescription>Summary of the trade execution</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">Trading Pair</p>
              <p className="text-sm font-mono">{log.details?.pair}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Exchange</p>
              <p className="text-sm capitalize">{log.details?.exchange || "Unknown"}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Side</p>
              <div className="flex items-center">
                {log.details?.side === "buy" ? (
                  <TrendingUp className="h-4 w-4 text-green-500 mr-1" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-red-500 mr-1" />
                )}
                <span className="text-sm capitalize">{log.details?.side || "Unknown"}</span>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Order ID</p>
              <p className="text-sm font-mono">{log.details?.orderId || "N/A"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Trade Details */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Trade Details</CardTitle>
          <CardDescription>Financial details of the trade</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-muted">
              <p className="text-sm text-muted-foreground mb-1">Amount</p>
              <p className="text-lg font-medium">{log.details?.amount ? log.details.amount.toFixed(8) : "N/A"}</p>
              <p className="text-xs text-muted-foreground">{log.details?.pair?.split("/")[0] || ""}</p>
            </div>
            <div className="p-4 rounded-lg bg-muted">
              <p className="text-sm text-muted-foreground mb-1">Price</p>
              <p className="text-lg font-medium">{log.details?.price ? formatAmount(log.details.price) : "N/A"}</p>
              <p className="text-xs text-muted-foreground">{log.details?.pair?.split("/")[1] || ""}</p>
            </div>
            <div className="p-4 rounded-lg bg-muted">
              <p className="text-sm text-muted-foreground mb-1">Total Value</p>
              <p className="text-lg font-medium">
                {log.details?.amount && log.details?.price
                  ? formatAmount(log.details.amount * log.details.price)
                  : "N/A"}
              </p>
              <p className="text-xs text-muted-foreground">{log.details?.pair?.split("/")[1] || ""}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
