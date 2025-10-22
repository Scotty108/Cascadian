import { MoreHorizontal, ExternalLink, Copy, Zap } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { TransactionIcon } from "../../shared/transaction-icon"
import { StatusIcon } from "../../shared/status-icon"
import { NetworkBadge } from "../../shared/network-badge"
import { formatCrypto, formatCurrency, formatDate, shortenAddress } from "../../../utils"
import { cn } from "@/lib/utils"
import type { Transaction } from "../../../types"

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
                  <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Date</th>
                  <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Amount</th>
                  <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Network</th>
                  <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Status</th>
                  <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-border hover:bg-muted/30 transition">
                    <td className="px-2 py-1.5 align-middle">
                      <div className="flex items-center gap-2">
                        <TransactionIcon type={tx.type} />
                        <div>
                          <p className="font-medium capitalize">{tx.type.replace("-", " ")}</p>
                          <p className="text-xs text-muted-foreground">
                            {tx.type === "send"
                              ? `To: ${shortenAddress(tx.to)}`
                              : tx.type === "receive"
                                ? `From: ${shortenAddress(tx.from)}`
                                : `${shortenAddress(tx.from)}`}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 align-middle">
                      <div>
                        <p>{formatDate(tx.timestamp)}</p>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 align-middle">
                      <div>
                        <p
                          className={cn(
                            "font-medium",
                            tx.type === "receive" ? "text-green-600" : tx.type === "send" ? "text-red-600" : "",
                          )}
                        >
                          {tx.type === "receive" ? "+" : tx.type === "send" ? "-" : ""}
                          {formatCrypto(tx.amount)} {tx.symbol}
                        </p>
                        <p className="text-sm text-muted-foreground">{formatCurrency(tx.usdValue)}</p>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 align-middle">
                      <NetworkBadge networkId={tx.networkId} showName />
                    </td>
                    <td className="px-2 py-1.5 align-middle">
                      <div className="flex items-center gap-1">
                        <StatusIcon status={tx.status} />
                        <span className="capitalize">{tx.status}</span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 align-middle text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>
                            <ExternalLink className="mr-2 h-4 w-4" />
                            <span>View on Explorer</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <Copy className="mr-2 h-4 w-4" />
                            <span>Copy Transaction ID</span>
                          </DropdownMenuItem>
                          {tx.status === "pending" && (
                            <DropdownMenuItem>
                              <Zap className="mr-2 h-4 w-4" />
                              <span>Speed Up</span>
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
