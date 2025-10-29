# UI Components Reference - Compact Layout Implementation

**Companion to:** ui-redesign-wallet-market-detail.md
**Purpose:** Developer-ready component specifications with exact Tailwind classes

---

## Metric Cards

### Standard Metric Card (180px × 120px)

```tsx
interface MetricCardProps {
  label: string;
  value: string | number;
  change?: {
    value: string;
    trend: 'up' | 'down' | 'neutral';
  };
  sparklineData?: number[];
  icon?: React.ReactNode;
}

export function MetricCard({ label, value, change, sparklineData, icon }: MetricCardProps) {
  return (
    <div className="border rounded-lg p-4 bg-card w-[180px] h-[120px] flex flex-col justify-between">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </div>

      {/* Value */}
      <div className="flex flex-col">
        <span className="text-2xl font-bold">{value}</span>
        {change && (
          <div className={`text-xs flex items-center gap-1 ${
            change.trend === 'up' ? 'text-green-600' :
            change.trend === 'down' ? 'text-red-600' :
            'text-muted-foreground'
          }`}>
            {change.trend === 'up' && <TrendingUp className="h-3 w-3" />}
            {change.trend === 'down' && <TrendingDown className="h-3 w-3" />}
            {change.value}
          </div>
        )}
      </div>

      {/* Sparkline */}
      {sparklineData && (
        <div className="h-8 -mb-2">
          <MiniSparkline data={sparklineData} height={30} />
        </div>
      )}
    </div>
  );
}
```

**Usage:**
```tsx
<MetricCard
  label="Total PnL"
  value="$57,000"
  change={{ value: '+22.8%', trend: 'up' }}
  sparklineData={[...]}
/>
```

**Tailwind Classes:**
- Container: `w-[180px] h-[120px] border rounded-lg p-4 bg-card`
- Label: `text-sm text-muted-foreground`
- Value: `text-2xl font-bold`
- Change: `text-xs text-green-600/text-red-600`
- Icon: `h-3 w-3`

---

### Large Metric Card (200px × 140px)

```tsx
export function MetricCardLarge({ label, value, subtitle, sparklineData }: MetricCardLargeProps) {
  return (
    <div className="border rounded-lg p-4 bg-card w-[200px] h-[140px] flex flex-col">
      <span className="text-sm text-muted-foreground mb-1">{label}</span>
      <span className="text-2xl font-bold mb-1">{value}</span>
      {subtitle && <span className="text-xs text-muted-foreground mb-2">{subtitle}</span>}
      {sparklineData && (
        <div className="flex-1 mt-auto">
          <MiniSparkline data={sparklineData} height={40} />
        </div>
      )}
    </div>
  );
}
```

---

### Risk Metrics Card (400px × 180px)

```tsx
interface RiskMetricsCardProps {
  sharpeRatio: number;
  sharpeLevel: 'Excellent' | 'Good' | 'Fair' | 'Poor';
  volume30d: number;
  volumeData: { date: string; volume: number }[];
}

export function RiskMetricsCard({ sharpeRatio, sharpeLevel, volume30d, volumeData }: RiskMetricsCardProps) {
  const levelColors = {
    Excellent: 'bg-green-600',
    Good: 'bg-blue-600',
    Fair: 'bg-yellow-600',
    Poor: 'bg-red-600'
  };

  return (
    <div className="border rounded-lg p-4 bg-card w-full md:w-[400px] h-[180px]">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm text-muted-foreground">Sharpe Ratio (30D)</span>
        <Badge className={levelColors[sharpeLevel]}>{sharpeLevel}</Badge>
      </div>

      <div className="text-3xl font-bold mb-3">{sharpeRatio.toFixed(2)}</div>

      <div className="text-xs text-muted-foreground mb-2">
        30D Volume: ${(volume30d / 1000).toFixed(0)}k
      </div>

      <div className="h-20">
        <ReactECharts
          option={volumeSparklineOption(volumeData)}
          style={{ height: '100%', width: '100%' }}
          opts={{ renderer: 'canvas' }}
        />
      </div>
    </div>
  );
}
```

---

## Grid Layouts

### Metric Cards Grid

```tsx
export function MetricsGrid({ metrics }: { metrics: MetricData[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-4">
      {metrics.map((metric, i) => (
        <MetricCard key={i} {...metric} />
      ))}
    </div>
  );
}
```

**Responsive Breakpoints:**
- Mobile: `grid-cols-1` - Stack vertically
- Small: `grid-cols-2` - 2 columns (≥640px)
- Large: `grid-cols-4` - 4 columns (≥1024px)
- XL: `grid-cols-6` - 6 columns (≥1280px)

---

### Two-Column Split Layout

```tsx
export function TwoColumnSection({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div>{left}</div>
      <div>{right}</div>
    </div>
  );
}
```

**Usage:**
```tsx
<TwoColumnSection
  left={<WinRateChart height={250} />}
  right={<CategoryDonutChart height={250} />}
/>
```

---

### Asymmetric Split (60/40)

```tsx
export function AsymmetricSplit({
  main,
  sidebar
}: {
  main: React.ReactNode;
  sidebar: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2">{main}</div>
      <div className="lg:col-span-1">{sidebar}</div>
    </div>
  );
}
```

---

## Chart Components

### Primary Chart (Full Width, 350px)

```tsx
export function PrimaryChart({ title, data, timeframe, onTimeframeChange }: PrimaryChartProps) {
  return (
    <div className="border rounded-lg p-6 bg-card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">{title}</h2>
        <TimeframeSelector value={timeframe} onChange={onTimeframeChange} />
      </div>
      <div className="h-[350px]">
        <ReactECharts
          option={chartOption}
          style={{ height: '100%', width: '100%' }}
          opts={{ renderer: 'canvas' }}
        />
      </div>
    </div>
  );
}
```

**Tailwind Classes:**
- Container: `border rounded-lg p-6 bg-card`
- Header: `flex items-center justify-between mb-4`
- Title: `text-xl font-semibold`
- Chart wrapper: `h-[350px]`

---

### Secondary Chart (50% width, 250px)

```tsx
export function SecondaryChart({ title, data }: SecondaryChartProps) {
  return (
    <div className="border rounded-lg p-4 bg-card">
      <h3 className="text-lg font-semibold mb-4">{title}</h3>
      <div className="h-[250px]">
        <ReactECharts
          option={chartOption}
          style={{ height: '100%', width: '100%' }}
          opts={{ renderer: 'canvas' }}
        />
      </div>
    </div>
  );
}
```

**Tailwind Classes:**
- Container: `border rounded-lg p-4 bg-card`
- Title: `text-lg font-semibold mb-4`
- Chart wrapper: `h-[250px]`

---

### Mini Sparkline Component

```tsx
interface MiniSparklineProps {
  data: number[];
  height: number;
  color?: string;
  showArea?: boolean;
}

export function MiniSparkline({
  data,
  height = 30,
  color = '#3b82f6',
  showArea = true
}: MiniSparklineProps) {
  const option = {
    xAxis: {
      type: 'category',
      data: data.map((_, i) => i),
      show: false,
    },
    yAxis: {
      type: 'value',
      show: false,
    },
    grid: {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    },
    series: [
      {
        type: 'line',
        data: data,
        smooth: true,
        symbol: 'none',
        lineStyle: {
          color: color,
          width: 2,
        },
        ...(showArea && {
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${color}4D` }, // 30% opacity
                { offset: 1, color: `${color}0D` }, // 5% opacity
              ],
            },
          },
        }),
      },
    ],
  };

  return (
    <ReactECharts
      option={option}
      style={{ height: `${height}px`, width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  );
}
```

---

## Tables with Truncation

### Truncated Table Component

```tsx
interface TruncatedTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  initialRows?: number;
  expandButtonText?: string;
}

export function TruncatedTable<T>({
  data,
  columns,
  initialRows = 5,
  expandButtonText = 'Show All'
}: TruncatedTableProps<T>) {
  const [expanded, setExpanded] = useState(false);
  const displayData = expanded ? data : data.slice(0, initialRows);

  return (
    <div className="border rounded-lg overflow-hidden bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col, i) => (
              <TableHead key={i}>{col.header}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {displayData.map((row, i) => (
            <TableRow key={i}>
              {columns.map((col, j) => (
                <TableCell key={j}>{col.cell(row)}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {data.length > initialRows && !expanded && (
        <div className="border-t p-3 text-center bg-muted/20">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(true)}
            className="text-sm"
          >
            {expandButtonText} ({data.length} total)
          </Button>
        </div>
      )}
    </div>
  );
}
```

**Usage:**
```tsx
<TruncatedTable
  data={tradingHistory}
  columns={tradeColumns}
  initialRows={10}
  expandButtonText="Show All Trades"
/>
```

---

### Compact Table Row (for side panels)

```tsx
export function CompactTableRow({
  label,
  value,
  trend
}: {
  label: string;
  value: string;
  trend?: 'up' | 'down';
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <span className={`text-sm font-medium ${
          trend === 'up' ? 'text-green-600' :
          trend === 'down' ? 'text-red-600' :
          ''
        }`}>
          {value}
        </span>
        {trend === 'up' && <TrendingUp className="h-3 w-3 text-green-600" />}
        {trend === 'down' && <TrendingDown className="h-3 w-3 text-red-600" />}
      </div>
    </div>
  );
}
```

---

## Collapsible Sections

### Basic Collapsible Section

```tsx
interface CollapsibleSectionProps {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function CollapsibleSection({
  title,
  count,
  defaultOpen = true,
  children
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border rounded-lg bg-card overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">{title}</h3>
          {count !== undefined && (
            <Badge variant="secondary">{count}</Badge>
          )}
        </div>
        <ChevronDown
          className={`h-5 w-5 transition-transform ${
            isOpen ? 'transform rotate-180' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div className="p-4 pt-0 border-t">
          {children}
        </div>
      )}
    </div>
  );
}
```

**Usage:**
```tsx
<CollapsibleSection title="Trading Bubble Map" count={20} defaultOpen={true}>
  <TradingBubbleChart height={400} />
</CollapsibleSection>
```

---

### Category Accordion (for Finished Positions)

```tsx
interface CategoryAccordionProps {
  categories: {
    name: string;
    count: number;
    pnl: number;
    positions: Position[];
  }[];
  defaultExpanded?: string[];
}

export function CategoryAccordion({ categories, defaultExpanded = [] }: CategoryAccordionProps) {
  return (
    <Accordion type="multiple" defaultValue={defaultExpanded} className="space-y-2">
      {categories.map((category) => (
        <AccordionItem key={category.name} value={category.name} className="border rounded-lg">
          <AccordionTrigger className="px-4 hover:bg-muted/50">
            <div className="flex items-center gap-3 flex-1 text-left">
              <span className="font-semibold">{category.name}</span>
              <Badge variant="secondary">{category.count} positions</Badge>
              <span className={`text-sm font-medium ml-auto mr-4 ${
                category.pnl >= 0 ? 'text-green-600' : 'text-red-600'
              }`}>
                {category.pnl >= 0 ? '+' : ''}${(category.pnl / 1000).toFixed(1)}k
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <CategoryPositionsList
              positions={category.positions}
              initialVisible={3}
            />
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
```

---

## Text Truncation

### Truncated Text with Expand

```tsx
interface TruncatedTextProps {
  text: string;
  maxLength?: number;
  className?: string;
}

export function TruncatedText({ text, maxLength = 150, className }: TruncatedTextProps) {
  const [expanded, setExpanded] = useState(false);
  const shouldTruncate = text.length > maxLength;

  if (!shouldTruncate) {
    return <p className={className}>{text}</p>;
  }

  return (
    <p className={className}>
      {expanded ? text : `${text.slice(0, maxLength)}...`}
      <Button
        variant="link"
        size="sm"
        onClick={() => setExpanded(!expanded)}
        className="ml-1 h-auto p-0 text-sm"
      >
        {expanded ? 'Show less' : 'Read more'}
      </Button>
    </p>
  );
}
```

**Usage:**
```tsx
<TruncatedText
  text={market.description}
  maxLength={150}
  className="text-sm text-muted-foreground"
/>
```

---

### Truncated Table Cell

```tsx
export function TruncatedCell({
  text,
  maxLength = 30
}: {
  text: string;
  maxLength?: number;
}) {
  return (
    <TableCell>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="truncate max-w-[200px] inline-block">
              {text.length > maxLength ? `${text.slice(0, maxLength)}...` : text}
            </span>
          </TooltipTrigger>
          {text.length > maxLength && (
            <TooltipContent>
              <p className="max-w-xs">{text}</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    </TableCell>
  );
}
```

---

## Section Headers

### Standard Section Header

```tsx
export function SectionHeader({
  title,
  subtitle,
  action
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
        )}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
```

**Usage:**
```tsx
<SectionHeader
  title="Trading History"
  subtitle="Last 156 trades"
  action={
    <Button variant="outline" size="sm">
      Export CSV
    </Button>
  }
/>
```

---

### Compact Section Header (for cards)

```tsx
export function CompactSectionHeader({ title, badge }: { title: string; badge?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <h3 className="text-lg font-semibold">{title}</h3>
      {badge}
    </div>
  );
}
```

---

## Highlight Cards

### Best/Worst Trade Card

```tsx
interface TradeSummaryProps {
  title: string;
  pnl: number;
  roi: number;
  type: 'best' | 'worst';
}

export function BestWorstTradesCard({ bestTrade, worstTrade }: {
  bestTrade: TradeSummaryProps;
  worstTrade: TradeSummaryProps;
}) {
  return (
    <div className="border rounded-lg p-4 bg-card h-full">
      <h3 className="text-lg font-semibold mb-4">Performance Highlights</h3>

      {/* Best Trade */}
      <div className="pb-4 mb-4 border-b">
        <div className="flex items-center gap-2 mb-2">
          <Trophy className="h-4 w-4 text-yellow-600" />
          <span className="text-sm text-muted-foreground font-medium">Best Trade</span>
        </div>
        <p className="text-sm mb-1 truncate">{bestTrade.title}</p>
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold text-green-600">
            +${(bestTrade.pnl / 1000).toFixed(1)}k
          </span>
          <span className="text-sm text-green-600">
            +{bestTrade.roi.toFixed(0)}%
          </span>
        </div>
      </div>

      {/* Worst Trade */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <TrendingDown className="h-4 w-4 text-red-600" />
          <span className="text-sm text-muted-foreground font-medium">Worst Trade</span>
        </div>
        <p className="text-sm mb-1 truncate">{worstTrade.title}</p>
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold text-red-600">
            -${Math.abs(worstTrade.pnl / 1000).toFixed(1)}k
          </span>
          <span className="text-sm text-red-600">
            {worstTrade.roi.toFixed(0)}%
          </span>
        </div>
      </div>
    </div>
  );
}
```

---

### Trading DNA Badge Display

```tsx
interface DNABadgeProps {
  icon: string;
  label: string;
  value: string | number;
  tooltip?: string;
}

export function DNABadge({ icon, label, value, tooltip }: DNABadgeProps) {
  const badge = (
    <div className="flex items-center gap-2 py-1.5 px-3 bg-muted rounded-md">
      <span className="text-base">{icon}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold ml-auto">{value}</span>
    </div>
  );

  if (tooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{badge}</TooltipTrigger>
          <TooltipContent>
            <p className="max-w-xs text-xs">{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return badge;
}

export function TradingDNACard({ wallet }: { wallet: WalletProfile }) {
  return (
    <div className="border rounded-lg p-4 bg-card w-[250px]">
      <h3 className="text-md font-semibold mb-3">Trading DNA</h3>
      <div className="space-y-2">
        <DNABadge
          icon="🎯"
          label="Contrarian"
          value={`${wallet.contrarian_pct}%`}
          tooltip="Percentage of entries below 50¢"
        />
        <DNABadge
          icon="💼"
          label="Bagholder"
          value={`${wallet.bagholder_pct}%`}
          tooltip="Positions currently below entry price"
        />
        <DNABadge
          icon="🐋"
          label="Whale Splashes"
          value={wallet.whale_splash_count}
          tooltip="Positions over $20k"
        />
        <DNABadge
          icon="🎰"
          label="Lottery Tickets"
          value={wallet.lottery_ticket_count}
          tooltip="Long-shot bets under 20¢"
        />
      </div>
    </div>
  );
}
```

---

## Timeframe Selector

```tsx
type Timeframe = '1h' | '24h' | '7d' | '30d' | '90d' | 'all';

interface TimeframeSelectorProps {
  value: Timeframe;
  onChange: (value: Timeframe) => void;
  options?: Timeframe[];
}

export function TimeframeSelector({
  value,
  onChange,
  options = ['1h', '24h', '7d', '30d']
}: TimeframeSelectorProps) {
  return (
    <div className="flex gap-1 border rounded-lg p-1 bg-muted/20">
      {options.map((tf) => (
        <button
          key={tf}
          onClick={() => onChange(tf)}
          className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
            value === tf
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          }`}
        >
          {tf.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
```

---

## PnL Leaderboard Ranks Card

```tsx
interface PnLRanksCardProps {
  ranks: {
    d1: { rank: number; pnl_usd: number };
    d7: { rank: number; pnl_usd: number };
    d30: { rank: number; pnl_usd: number };
    all: { rank: number; pnl_usd: number };
  };
}

export function PnLRanksCard({ ranks }: PnLRanksCardProps) {
  return (
    <div className="border rounded-lg p-4 bg-card">
      <h3 className="text-md font-semibold mb-3">PnL Leaderboard</h3>
      <div className="space-y-2">
        {Object.entries(ranks).map(([period, data]) => (
          <div key={period} className="flex items-center justify-between py-1.5 border-b last:border-0">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="w-12 justify-center">
                {period === 'd1' ? '1D' : period === 'd7' ? '7D' : period === 'd30' ? '30D' : 'All'}
              </Badge>
              <span className="text-sm font-medium">Rank #{data.rank}</span>
            </div>
            <span className={`text-sm font-semibold ${
              data.pnl_usd >= 0 ? 'text-green-600' : 'text-red-600'
            }`}>
              {data.pnl_usd >= 0 ? '+' : ''}${(data.pnl_usd / 1000).toFixed(1)}k
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## Responsive Container

```tsx
export function ResponsiveContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-full space-y-4 p-4 md:p-6 max-w-[1600px] mx-auto">
      {children}
    </div>
  );
}
```

---

## Loading States

### Skeleton Card

```tsx
export function MetricCardSkeleton() {
  return (
    <div className="border rounded-lg p-4 bg-card w-[180px] h-[120px]">
      <Skeleton className="h-4 w-20 mb-3" />
      <Skeleton className="h-8 w-24 mb-2" />
      <Skeleton className="h-3 w-16" />
    </div>
  );
}
```

### Skeleton Chart

```tsx
export function ChartSkeleton({ height = 350 }: { height?: number }) {
  return (
    <div className="border rounded-lg p-6 bg-card">
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-8 w-48" />
      </div>
      <Skeleton className="w-full" style={{ height: `${height}px` }} />
    </div>
  );
}
```

---

## Utility Classes Reference

### Spacing
```css
/* Section spacing */
.space-y-4 /* 16px vertical gap between sections */
.gap-4     /* 16px gap in grids */

/* Card internal spacing */
.p-4       /* 16px padding */
.p-6       /* 24px padding (larger cards) */

/* Compact spacing */
.gap-2     /* 8px gap */
.space-y-2 /* 8px vertical gap */
```

### Typography
```css
/* Labels */
.text-sm .text-muted-foreground  /* 14px muted */
.text-xs .text-muted-foreground  /* 12px secondary text */

/* Values */
.text-2xl .font-bold             /* 24px bold metric values */
.text-xl .font-semibold          /* 20px section headers */
.text-lg .font-semibold          /* 18px subsection headers */

/* Changes/trends */
.text-xs .text-green-600         /* 12px positive change */
.text-xs .text-red-600           /* 12px negative change */
```

### Layout
```css
/* Containers */
.border .rounded-lg .bg-card     /* Standard card */
.border .rounded-lg .p-4 .bg-card /* Card with padding */

/* Responsive grids */
.grid .grid-cols-1 .lg:grid-cols-2 .gap-4  /* 2-col on desktop */
.grid .grid-cols-1 .lg:grid-cols-3 .gap-4  /* 3-col on desktop */

/* Flex layouts */
.flex .items-center .justify-between /* Header layout */
.flex .items-center .gap-2           /* Icon + text */
```

### Heights
```css
.h-[350px]  /* Primary chart */
.h-[250px]  /* Secondary chart */
.h-[180px]  /* Risk metrics card */
.h-[140px]  /* Large metric card */
.h-[120px]  /* Standard metric card */
.h-8        /* Sparkline container */
.h-20       /* Medium sparkline */
```

---

## Chart Configuration Helpers

### Standard Chart Grid

```typescript
export const standardChartGrid = {
  left: '3%',
  right: '4%',
  bottom: '3%',
  containLabel: true,
};
```

### Compact Chart Grid (for sparklines)

```typescript
export const compactChartGrid = {
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
};
```

### Standard Tooltip

```typescript
export const standardTooltip = {
  trigger: 'axis' as const,
  axisPointer: { type: 'cross' as const },
  backgroundColor: 'rgba(0, 0, 0, 0.8)',
  borderColor: '#333',
  textStyle: {
    color: '#fff',
    fontSize: 12,
  },
};
```

---

## Color Utilities

```typescript
export const pnlColor = (value: number) =>
  value >= 0 ? 'text-green-600' : 'text-red-600';

export const pnlBgColor = (value: number) =>
  value >= 0 ? 'bg-green-600' : 'bg-red-600';

export const trendColor = (trend: 'up' | 'down' | 'neutral') => {
  const colors = {
    up: 'text-green-600',
    down: 'text-red-600',
    neutral: 'text-muted-foreground',
  };
  return colors[trend];
};
```

---

## Animation Classes

```css
/* Smooth transitions */
.transition-colors
.transition-transform
.transition-all

/* Hover effects */
.hover:bg-muted/50
.hover:text-foreground

/* Expand/collapse */
.transform .rotate-180  /* Chevron rotation */
```

---

## Mobile-Specific Overrides

```tsx
// Example: Hide on mobile, show on desktop
<div className="hidden lg:block">
  <SecondaryChart />
</div>

// Stack on mobile, side-by-side on desktop
<div className="flex flex-col lg:flex-row gap-4">
  <div className="flex-1">{left}</div>
  <div className="flex-1">{right}</div>
</div>

// Adjust card size on mobile
<div className="w-full sm:w-[180px] h-[120px]">
  <MetricCard />
</div>
```

---

## Implementation Checklist

### Phase 1: Component Creation
- [ ] Create all metric card variants
- [ ] Build truncated table component
- [ ] Implement collapsible section wrapper
- [ ] Create mini sparkline component

### Phase 2: Layout Components
- [ ] Build responsive grid containers
- [ ] Create two-column split layout
- [ ] Implement asymmetric split (60/40)
- [ ] Build section headers

### Phase 3: Specialized Components
- [ ] Trading DNA badge display
- [ ] Best/worst trades card
- [ ] PnL leaderboard ranks
- [ ] Category accordion

### Phase 4: Integration
- [ ] Replace existing wallet detail sections
- [ ] Replace existing market detail sections
- [ ] Add loading skeletons
- [ ] Implement responsive breakpoints

### Phase 5: Polish
- [ ] Add smooth animations
- [ ] Test mobile layouts
- [ ] Optimize chart rendering
- [ ] Add accessibility attributes

---

**Document Status:** Implementation Ready
**Last Updated:** 2025-10-21
**Related Files:**
- `/Users/scotty/Projects/Cascadian-app/docs/ui-redesign-wallet-market-detail.md`
- `/Users/scotty/Projects/Cascadian-app/components/wallet-detail-interface/index.tsx`
- `/Users/scotty/Projects/Cascadian-app/components/market-detail-interface/index.tsx`
