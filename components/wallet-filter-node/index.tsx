"use client";

import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * Wallet Filter Node Component
 *
 * Flexible formula controls for filtering wallets based on:
 * - Omega ratio
 * - ROI per bet
 * - Number of trades
 * - Grade levels
 * - Momentum direction
 * - Market categories
 *
 * Use in:
 * - Strategy builder workflows
 * - Copy trading setup
 * - Custom alerts
 */

export interface WalletFilterCriteria {
  min_omega_ratio?: number;
  max_omega_ratio?: number;
  min_roi_per_bet?: number;
  min_closed_positions?: number;
  allowed_grades?: string[];
  allowed_momentum?: string[];
  categories?: string[];
}

interface WalletFilterNodeProps {
  onFilterChange?: (criteria: WalletFilterCriteria, matchCount?: number) => void;
  initialCriteria?: WalletFilterCriteria;
  showPreview?: boolean;
}

const GRADES = ['S', 'A', 'B', 'C', 'D', 'F'];
const MOMENTUM_OPTIONS = [
  { value: 'improving', label: '📈 Improving', color: 'text-emerald-400' },
  { value: 'declining', label: '📉 Declining', color: 'text-rose-400' },
  { value: 'stable', label: '➡️ Stable', color: 'text-slate-400' },
];

const CATEGORIES = [
  'Politics',
  'Crypto',
  'Sports',
  'Business',
  'Science',
  'Pop Culture',
];

export function WalletFilterNode({
  onFilterChange,
  initialCriteria,
  showPreview = true
}: WalletFilterNodeProps) {
  const [minOmega, setMinOmega] = useState(initialCriteria?.min_omega_ratio || 1.0);
  const [maxOmega, setMaxOmega] = useState(initialCriteria?.max_omega_ratio || 50);
  const [minRoiPerBet, setMinRoiPerBet] = useState(initialCriteria?.min_roi_per_bet || 0);
  const [minTrades, setMinTrades] = useState(initialCriteria?.min_closed_positions || 10);
  const [selectedGrades, setSelectedGrades] = useState<string[]>(initialCriteria?.allowed_grades || ['S', 'A', 'B']);
  const [selectedMomentum, setSelectedMomentum] = useState<string[]>(initialCriteria?.allowed_momentum || ['improving']);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(initialCriteria?.categories || []);
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const toggleGrade = (grade: string) => {
    setSelectedGrades(prev =>
      prev.includes(grade) ? prev.filter(g => g !== grade) : [...prev, grade]
    );
  };

  const toggleMomentum = (momentum: string) => {
    setSelectedMomentum(prev =>
      prev.includes(momentum) ? prev.filter(m => m !== momentum) : [...prev, momentum]
    );
  };

  const toggleCategory = (category: string) => {
    setSelectedCategories(prev =>
      prev.includes(category) ? prev.filter(c => c !== category) : [...prev, category]
    );
  };

  const applyFilter = async () => {
    const criteria: WalletFilterCriteria = {
      min_omega_ratio: minOmega,
      max_omega_ratio: maxOmega,
      min_roi_per_bet: minRoiPerBet,
      min_closed_positions: minTrades,
      allowed_grades: selectedGrades.length > 0 ? selectedGrades : undefined,
      allowed_momentum: selectedMomentum.length > 0 ? selectedMomentum : undefined,
      categories: selectedCategories.length > 0 ? selectedCategories : undefined,
    };

    if (showPreview) {
      setLoading(true);
      try {
        const response = await fetch('/api/wallets/filter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(criteria),
        });
        const data = await response.json();
        if (data.success) {
          setMatchCount(data.count);
          onFilterChange?.(criteria, data.count);
        }
      } catch (error) {
        console.error('Error applying filter:', error);
      } finally {
        setLoading(false);
      }
    } else {
      onFilterChange?.(criteria);
    }
  };

  const getGradeColor = (grade: string) => {
    switch (grade) {
      case 'S': return 'border-purple-500/40 bg-purple-500/15 text-purple-300';
      case 'A': return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300';
      case 'B': return 'border-sky-500/30 bg-sky-500/10 text-sky-200';
      case 'C': return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
      case 'D': return 'border-orange-500/30 bg-orange-500/10 text-orange-200';
      case 'F': return 'border-rose-500/40 bg-rose-500/10 text-rose-200';
      default: return 'border-border/30 bg-muted/10 text-muted-foreground';
    }
  };

  return (
    <Card className="border-purple-500/30 bg-card/50 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="text-purple-400">⚙️</span>
          Wallet Filter Node
        </CardTitle>
        <CardDescription>
          Configure criteria to select high-performing wallets
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Omega Ratio Range */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Omega Ratio Range</Label>
            <span className="text-sm font-semibold text-purple-400">
              {minOmega.toFixed(1)} - {maxOmega.toFixed(0)}
            </span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-12">Min:</span>
              <Slider
                min={0.5}
                max={10}
                step={0.5}
                value={[minOmega]}
                onValueChange={(value) => setMinOmega(value[0])}
                className="flex-1"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-12">Max:</span>
              <Slider
                min={5}
                max={100}
                step={5}
                value={[maxOmega]}
                onValueChange={(value) => setMaxOmega(value[0])}
                className="flex-1"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Filter wallets with omega between {minOmega.toFixed(1)} and {maxOmega.toFixed(0)}
          </p>
        </div>

        {/* ROI Per Bet */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Min ROI Per Bet</Label>
            <span className="text-sm font-semibold text-emerald-400">
              ${minRoiPerBet.toLocaleString()}
            </span>
          </div>
          <Slider
            min={0}
            max={5000}
            step={100}
            value={[minRoiPerBet]}
            onValueChange={(value) => setMinRoiPerBet(value[0])}
          />
          <p className="text-xs text-muted-foreground">
            Average profit per trade must be at least ${minRoiPerBet.toLocaleString()}
          </p>
        </div>

        {/* Minimum Trades */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Minimum Trades</Label>
            <span className="text-sm font-semibold text-purple-400">
              {minTrades}+
            </span>
          </div>
          <Slider
            min={5}
            max={100}
            step={5}
            value={[minTrades]}
            onValueChange={(value) => setMinTrades(value[0])}
          />
          <p className="text-xs text-muted-foreground">
            Only wallets with {minTrades}+ closed positions (ensures statistical significance)
          </p>
        </div>

        {/* Grade Selection */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Allowed Grades</Label>
          <div className="flex flex-wrap gap-2">
            {GRADES.map((grade) => (
              <Badge
                key={grade}
                className={`cursor-pointer transition-all ${
                  selectedGrades.includes(grade)
                    ? getGradeColor(grade)
                    : 'border-border/30 bg-muted/10 text-muted-foreground opacity-40'
                }`}
                onClick={() => toggleGrade(grade)}
              >
                {grade}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Selected: {selectedGrades.join(', ') || 'None'}
          </p>
        </div>

        {/* Momentum Selection */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Momentum Direction</Label>
          <div className="flex flex-wrap gap-2">
            {MOMENTUM_OPTIONS.map((option) => (
              <Badge
                key={option.value}
                className={`cursor-pointer transition-all ${
                  selectedMomentum.includes(option.value)
                    ? `border-current ${option.color} bg-current/10`
                    : 'border-border/30 bg-muted/10 text-muted-foreground opacity-40'
                }`}
                onClick={() => toggleMomentum(option.value)}
              >
                {option.label}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Selected: {selectedMomentum.length > 0 ? selectedMomentum.join(', ') : 'All'}
          </p>
        </div>

        {/* Category Selection */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Market Categories</Label>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((category) => (
              <Badge
                key={category}
                className={`cursor-pointer transition-all ${
                  selectedCategories.includes(category)
                    ? 'border-purple-500/40 bg-purple-500/15 text-purple-300'
                    : 'border-border/30 bg-muted/10 text-muted-foreground opacity-40'
                }`}
                onClick={() => toggleCategory(category)}
              >
                {category}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {selectedCategories.length > 0
              ? `Filter to: ${selectedCategories.join(', ')}`
              : 'All categories (coming soon)'}
          </p>
        </div>

        {/* Apply Button */}
        <div className="pt-4 border-t border-border/60">
          <Button
            onClick={applyFilter}
            disabled={loading}
            className="w-full bg-purple-500 hover:bg-purple-600"
          >
            {loading ? 'Filtering...' : 'Apply Filter'}
          </Button>
          {matchCount !== null && (
            <div className="mt-3 text-center">
              <Badge className="border-emerald-500/40 bg-emerald-500/15 text-emerald-300">
                ✓ {matchCount} wallets match
              </Badge>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
