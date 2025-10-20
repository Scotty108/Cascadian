import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { mockBalances } from "../data"

export function BalanceSummary() {
  const totalBalance = mockBalances.reduce((sum, balance) => {
    // Simple calculation - in real app, you'd convert to USD
    if (balance.asset === "USDT") return sum + balance.total
    if (balance.asset === "BTC") return sum + balance.total * 42831.07
    if (balance.asset === "ETH") return sum + balance.total * 2456.78
    if (balance.asset === "BNB") return sum + balance.total * 312.45
    return sum
  }, 0)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Account Balance</CardTitle>
        <CardDescription>${totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {mockBalances.map((balance) => (
          <div key={balance.asset} className="flex justify-between">
            <span className="text-sm text-muted-foreground">{balance.asset} Balance</span>
            <span className="font-medium">
              {balance.total.toLocaleString(undefined, {
                minimumFractionDigits: balance.asset === "USDT" ? 2 : 8,
              })}{" "}
              {balance.asset}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
