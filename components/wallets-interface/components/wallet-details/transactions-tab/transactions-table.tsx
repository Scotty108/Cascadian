import { MoreHorizontal, ExternalLink, Copy, Zap } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Network</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.map((tx) => (
              <TableRow key={tx.id}>
                <TableCell>
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
                </TableCell>
                <TableCell>
                  <div>
                    <p>{formatDate(tx.timestamp)}</p>
                  </div>
                </TableCell>
                <TableCell>
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
                </TableCell>
                <TableCell>
                  <NetworkBadge networkId={tx.networkId} showName />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <StatusIcon status={tx.status} />
                    <span className="capitalize">{tx.status}</span>
                  </div>
                </TableCell>
                <TableCell className="text-right">
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
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
