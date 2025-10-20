import type { Transaction } from "../../../types";
import { TransactionFilters } from "./transaction-filters";
import { TransactionsTable } from "./transactions-table";

interface TransactionsTabProps {
  transactions: Transaction[];
  activeNetwork: string;
  onNetworkChange: (network: string) => void;
}

export function TransactionsTab({ transactions, activeNetwork, onNetworkChange }: TransactionsTabProps) {
  return (
    <div className="space-y-4">
      <TransactionFilters />
      <TransactionsTable transactions={transactions} />
    </div>
  );
}
