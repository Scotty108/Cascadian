"use client"

import Image from "next/image";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCurrency, getChangeColor } from "../../utils"
import type { Account } from "../../types"

interface AccountsTableProps {
  accounts: Account[]
}

export function AccountsTable({ accounts }: AccountsTableProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead className="text-right">UPNL</TableHead>
            <TableHead className="text-right">Funds Locked</TableHead>
            <TableHead className="text-right">Change (24h)</TableHead>
            <TableHead className="text-right">Total Balance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map((account) => (
            <TableRow key={account.id}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-full overflow-hidden">
                    <Image
                      src={account.avatar || "/placeholder.svg"}
                      alt={account.name}
                      className="h-full w-full object-cover"
                      width={32}
                      height={32}
                    />
                  </div>
                  <div>
                    <p className="font-medium">{account.name}</p>
                    <p className="text-xs text-muted-foreground">{account.type}</p>
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-right">
                <span className={getChangeColor(account.upnl)}>
                  {account.upnl === 0 ? "$0.00" : (account.upnl > 0 ? "+" : "") + formatCurrency(account.upnl)}
                </span>
              </TableCell>
              <TableCell className="text-right">{formatCurrency(account.fundsLocked)}</TableCell>
              <TableCell className="text-right">
                <span className={getChangeColor(account.change)}>
                  {account.change === 0 ? "0.00%" : (account.change > 0 ? "+" : "") + account.change + "%"}
                </span>
              </TableCell>
              <TableCell className="text-right font-medium">{formatCurrency(account.total)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
