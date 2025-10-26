/**
 * RISK TOLERANCE SLIDER COMPONENT
 *
 * Task Group 14.5: Interactive slider for risk tolerance configuration
 * - Slider from 1 (conservative) to 10 (aggressive)
 * - Visual markers at 1, 5, 10
 * - Color coding: green (1-3), yellow (4-7), red (8-10)
 * - Dynamic description text based on value
 * - Maps to fractional Kelly lambda
 */

"use client"

import React from 'react';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';

interface RiskToleranceSliderProps {
  value: number;
  onChange: (value: number) => void;
}

export default function RiskToleranceSlider({ value, onChange }: RiskToleranceSliderProps) {
  // Calculate Kelly lambda from risk tolerance
  const calculateKellyLambda = (riskTolerance: number): number => {
    if (riskTolerance <= 3) {
      // Conservative: 1-3 → lambda = 0.10-0.25
      return 0.10 + ((riskTolerance - 1) / 2) * 0.15;
    } else if (riskTolerance <= 7) {
      // Balanced: 4-7 → lambda = 0.25-0.50
      return 0.25 + ((riskTolerance - 4) / 3) * 0.25;
    } else {
      // Aggressive: 8-10 → lambda = 0.50-1.00
      return 0.50 + ((riskTolerance - 8) / 2) * 0.50;
    }
  };

  // Get color based on risk tolerance
  const getColor = (riskTolerance: number): string => {
    if (riskTolerance <= 3) return 'text-green-600 dark:text-green-400';
    if (riskTolerance <= 7) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };

  // Get background color for slider
  const getSliderColor = (riskTolerance: number): string => {
    if (riskTolerance <= 3) return 'bg-green-500';
    if (riskTolerance <= 7) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  // Get description text
  const getDescription = (riskTolerance: number): string => {
    if (riskTolerance <= 3) return 'Conservative - Small, safe bets';
    if (riskTolerance <= 7) return 'Balanced - Moderate position sizes';
    return 'Aggressive - Larger bets with higher risk';
  };

  const kellyLambda = calculateKellyLambda(value);
  const color = getColor(value);
  const description = getDescription(value);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label htmlFor="risk-tolerance" className="text-sm font-semibold">
          Risk Tolerance
        </Label>
        <div className="flex items-center gap-2">
          <span className={`text-2xl font-bold ${color}`}>{value}</span>
          <span className="text-xs text-muted-foreground">/10</span>
        </div>
      </div>

      {/* Slider */}
      <div className="relative px-1">
        <Slider
          id="risk-tolerance"
          min={1}
          max={10}
          step={1}
          value={[value]}
          onValueChange={([newValue]) => onChange(newValue)}
          className="relative"
        />

        {/* Markers */}
        <div className="mt-2 flex justify-between px-0.5">
          <div className="flex flex-col items-center">
            <div className={`h-2 w-0.5 ${value === 1 ? getSliderColor(1) : 'bg-border'}`} />
            <span className="mt-1 text-xs text-muted-foreground">1</span>
          </div>
          <div className="flex flex-col items-center">
            <div className={`h-2 w-0.5 ${value === 5 ? getSliderColor(5) : 'bg-border'}`} />
            <span className="mt-1 text-xs text-muted-foreground">5</span>
          </div>
          <div className="flex flex-col items-center">
            <div className={`h-2 w-0.5 ${value === 10 ? getSliderColor(10) : 'bg-border'}`} />
            <span className="mt-1 text-xs text-muted-foreground">10</span>
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <p className={`text-sm font-semibold ${color}`}>
          {description}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Kelly Fraction: {kellyLambda.toFixed(2)} ({Math.round(kellyLambda * 100)}% of optimal Kelly bet size)
        </p>
      </div>

      {/* Color Legend */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-full bg-green-500" />
          <span className="text-muted-foreground">1-3 Conservative</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-full bg-yellow-500" />
          <span className="text-muted-foreground">4-7 Balanced</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-full bg-red-500" />
          <span className="text-muted-foreground">8-10 Aggressive</span>
        </div>
      </div>
    </div>
  );
}
