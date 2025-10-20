import type { FilterState, Transaction } from "../../types";
import { TransactionFilters } from "./transaction-filters";
import { TransactionsTable } from "./transactions-table";

interface TransactionsTabProps {
  transactions: Transaction[];
  filters: FilterState;
  onFiltersChange: (updates: Partial<FilterState>) => void;
}

export function TransactionsTab({ transactions, filters, onFiltersChange }: TransactionsTabProps) {
  return (
    <div className="space-y-4">
      <TransactionFilters filters={filters} onFiltersChange={onFiltersChange} />
      <TransactionsTable transactions={transactions} />
    </div>
  );
}
