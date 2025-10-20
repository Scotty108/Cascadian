"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AccountsFilters } from "./accounts-filters"
import { AccountsTable } from "./accounts-table"
import type { Account, FilterState } from "../../types"

interface AccountsSectionProps {
  accounts: Account[]
  filters: FilterState
  onFilterChange: (key: keyof FilterState, value: string) => void
}

export function AccountsSection({ accounts, filters, onFilterChange }: AccountsSectionProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <CardTitle>Accounts</CardTitle>
            <CardDescription>{accounts.length.toString().padStart(2, "0")} Accounts</CardDescription>
          </div>
          <AccountsFilters
            search={filters.accountSearch}
            accountType={filters.accountType}
            onSearchChange={(value) => onFilterChange("accountSearch", value)}
            onAccountTypeChange={(value) => onFilterChange("accountType", value)}
          />
        </div>
      </CardHeader>
      <CardContent>
        <AccountsTable accounts={accounts} />
      </CardContent>
    </Card>
  )
}
