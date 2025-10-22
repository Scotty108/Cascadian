import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Info } from "lucide-react"
import { StatusBadge } from "../shared/status-badge"
import type { Transaction } from "../../types"
import { formatCurrency } from "../../utils"

interface TransactionsTableProps {
  transactions: Transaction[]
}

export function TransactionsTable({ transactions }: TransactionsTableProps) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto" style={{ maxHeight: '600px', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table className="w-full whitespace-nowrap caption-bottom text-sm border-collapse">
              <thead className="sticky top-0 z-40 bg-background border-b border-border">
                <tr>
                  <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Type</th>
                  <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Asset</th>
                  <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Amount</th>
                  <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Price</th>
                  <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Value</th>
                  <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Date</th>
                  <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Status</th>
                  <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Chain</th>
                  <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((transaction) => (
                  <tr key={transaction.id} className="border-b border-border hover:bg-muted/30 transition">
                    <td className="px-2 py-1.5 align-middle">
                      <StatusBadge type="transaction" value={transaction.type} />
                    </td>
                    <td className="px-2 py-1.5 align-middle">{transaction.asset}</td>
                    <td className="px-2 py-1.5 align-middle text-right">{transaction.amount}</td>
                    <td className="px-2 py-1.5 align-middle text-right">${formatCurrency(transaction.price)}</td>
                    <td className="px-2 py-1.5 align-middle text-right">${formatCurrency(transaction.value)}</td>
                    <td className="px-2 py-1.5 align-middle">{new Date(transaction.date).toLocaleDateString()}</td>
                    <td className="px-2 py-1.5 align-middle">
                      <StatusBadge
                        type="status"
                        value={transaction.status}
                        variant={transaction.status === "Completed" ? "outline" : "secondary"}
                      />
                    </td>
                    <td className="px-2 py-1.5 align-middle">{transaction.chain}</td>
                    <td className="px-2 py-1.5 align-middle text-right">
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <span className="sr-only">View details</span>
                        <Info className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex items-center justify-between border-t p-4">
        <div className="text-sm text-muted-foreground">Showing {transactions.length} of 24 transactions</div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled>
            Previous
          </Button>
          <Button variant="outline" size="sm">
            Next
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}
