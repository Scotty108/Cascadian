"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TransactionIcon } from "../../shared/transaction-icon"
import { formatCrypto, formatCurrency, formatDate } from "../../../utils"
import type { Transaction } from "../../../types"

interface RecentActivityProps {
  transactions: Transaction[]
  onViewAll: () => void
}

export function RecentActivity({ transactions, onViewAll }: RecentActivityProps) {
  const recentTransactions = transactions.slice(0, 3)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {recentTransactions.map((tx) => (
            <div key={tx.id} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <TransactionIcon type={tx.type} />
                <div>
                  <p className="font-medium capitalize">{tx.type.replace("-", " ")}</p>
                  <p className="text-sm text-muted-foreground">{formatDate(tx.timestamp)}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-medium">
                  {tx.type === "receive" ? "+" : tx.type === "send" ? "-" : ""}
                  {formatCrypto(tx.amount)} {tx.symbol}
                </p>
                <p className="text-sm text-muted-foreground">{formatCurrency(tx.usdValue)}</p>
              </div>
            </div>
          ))}
        </div>
        {transactions.length > 3 && (
          <div className="mt-4 text-center">
            <Button variant="ghost" className="text-sm" onClick={onViewAll}>
              View All Transactions
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
