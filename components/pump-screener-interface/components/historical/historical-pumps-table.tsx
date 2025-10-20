"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { PumpDetailsModal } from "../../modal/pump-details-modal";
import type { HistoricalPump } from "../../types";
import { getProfitPotentialColor } from "../../utils";

interface HistoricalPumpsTableProps {
  pumps: HistoricalPump[];
}

export function HistoricalPumpsTable({ pumps }: HistoricalPumpsTableProps) {
  const [selectedPump, setSelectedPump] = useState<HistoricalPump | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleViewDetails = (pump: HistoricalPump) => {
    setSelectedPump(pump);
    setIsModalOpen(true);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-4 flex-wrap justify-between">
          <div>
            <CardTitle className="text-lg">Historical Pump Analysis</CardTitle>
            <CardDescription>Learn from past pump events to identify future opportunities</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Price Change</TableHead>
              <TableHead>Volume Increase</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead>Profit Potential</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pumps.map((pump, index) => (
              <TableRow key={index}>
                <TableCell className="font-medium">{pump.symbol}</TableCell>
                <TableCell>{pump.date}</TableCell>
                <TableCell className="text-green-500">+{pump.priceChangePct}%</TableCell>
                <TableCell>+{pump.volumeIncreasePct}%</TableCell>
                <TableCell>{pump.duration}</TableCell>
                <TableCell>{pump.trigger}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={getProfitPotentialColor(pump.profitPotential)}>
                    {pump.profitPotential}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleViewDetails(pump)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <PumpDetailsModal pump={selectedPump} isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </Card>
  );
}
