"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { AssetData } from "../types";

interface PortfolioChartProps {
  data: AssetData[];
}

export function PortfolioChart({ data }: PortfolioChartProps) {
  return (
    <Card className="lg:col-span-4">
      <CardHeader>
        <CardTitle>Portfolio Distribution</CardTitle>
      </CardHeader>
      <CardContent className="pl-2">
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value">
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip formatter={(value: number) => [`$${value.toLocaleString()}`, "Value"]} labelFormatter={(label) => `${label}`} />
            {/* TODO */}
            {/* <Legend
              verticalAlign="bottom"
              height={36}
              formatter={(value, entry) => (
                <span style={{ color: entry.color }}>
                  {value} ({data.find((item) => item.name === value)?.percentage}%)
                </span>
              )}
            /> */}
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
