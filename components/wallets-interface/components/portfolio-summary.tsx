import { Shield } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Progress } from "@/components/ui/progress"
import { formatCurrency, calculateTotalBalance } from "../utils"
import { wallets, networks } from "../data"

export function PortfolioSummary() {
  const totalPortfolioBalance = calculateTotalBalance(wallets)
  const totalTransactions = wallets.reduce((sum, wallet) => sum + wallet.transactions.length, 0)
  const secureWallets = wallets.filter((w) => w.securityLevel === "high" || w.securityLevel === "very high").length
  const securityPercentage = Math.round((secureWallets / wallets.length) * 100)

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Total Portfolio Value</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(totalPortfolioBalance)}</div>
          <p className="text-xs text-muted-foreground">Across {wallets.length} wallets</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Connected Networks</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{networks.length}</div>
          <div className="mt-1 flex -space-x-2">
            {networks.slice(0, 5).map((network) => (
              <Avatar key={network.id} className="h-6 w-6 border-2 border-background">
                <AvatarImage src={network.icon || "/placeholder.svg"} alt={network.name} />
                <AvatarFallback>{network.name.substring(0, 2)}</AvatarFallback>
              </Avatar>
            ))}
            {networks.length > 5 && (
              <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-muted text-xs">
                +{networks.length - 5}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Security Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center">
            <Shield className="mr-2 h-4 w-4 text-green-500" />
            <span className="text-green-500 font-medium">Secure</span>
          </div>
          <Progress className="mt-2" value={securityPercentage} />
          <p className="mt-1 text-xs text-muted-foreground">{securityPercentage}% of wallets have high security</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{totalTransactions}</div>
          <p className="text-xs text-muted-foreground">Transactions in the last 30 days</p>
        </CardContent>
      </Card>
    </div>
  )
}
