import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TradeHistoryItem } from "../types";

interface TradeHistoryProps {
  history: TradeHistoryItem[];
}

export function TradeHistory({ history }: TradeHistoryProps) {
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Trade History</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Pair</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center">
                  No trades yet.
                </TableCell>
              </TableRow>
            ) : (
              history.map((trade) => (
                <TableRow key={trade.id}>
                  <TableCell>{trade.timestamp}</TableCell>
                  <TableCell>
                    <span
                      className={`font-medium ${
                        trade.type === "buy" ? "text-green-500" : "text-red-500"
                      }`}
                    >
                      {trade.type.toUpperCase()}
                    </span>
                  </TableCell>
                  <TableCell>{trade.pair.toUpperCase()}</TableCell>
                  <TableCell>{trade.amount}</TableCell>
                  <TableCell>{trade.price}</TableCell>
                  <TableCell>{trade.total}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
