# Strategy Builder UI - Complete Implementation

## Overview

The Strategy Builder UI has been fully rebuilt to connect to the real backend system. This implementation replaces the mock workflow builder with custom components specifically designed for the 6 node types in our wallet screening system.

## What Was Built

### 1. Custom Node Components (6 types)

All node components are located in `/components/strategy-nodes/`:

#### `data-source-node.tsx`
- Visual representation of DATA_SOURCE nodes
- Displays: source type (WALLETS/MARKETS/TRADES/SIGNALS/CATEGORIES)
- Shows: table name, mode (BATCH/REALTIME), filters, limits
- Color scheme: Blue gradient with database icon
- Status indicators: idle, running, completed, error

#### `filter-node.tsx`
- Visual representation of FILTER nodes
- Displays: field name, operator (>=, <=, IN, etc.), value
- Shows condition in readable format with syntax highlighting
- Color scheme: Purple gradient with filter icon
- Supports category-specific filtering

#### `logic-node.tsx`
- Visual representation of LOGIC nodes
- Displays: operator type (AND/OR/NOT/XOR)
- Shows: number of inputs, operation description
- Color scheme: Green gradient with merge icon
- Multiple input handles for combining conditions

#### `aggregation-node.tsx`
- Visual representation of AGGREGATION nodes
- Displays: aggregation function (COUNT/SUM/AVG/MIN/MAX/PERCENTILE)
- Shows: field name, groupBy columns if specified
- Color scheme: Orange gradient with chart icon
- Formula display (e.g., "AVG(omega_ratio)")

#### `signal-node.tsx`
- Visual representation of SIGNAL nodes
- Displays: signal type (ENTRY/EXIT/HOLD), direction (YES/NO)
- Shows: strength bars (WEAK to VERY_STRONG), position sizing method
- Color scheme: Teal gradient with radio icon
- Dynamic color based on signal type

#### `action-node.tsx`
- Visual representation of ACTION nodes
- Displays: action type (ADD_TO_WATCHLIST/SEND_ALERT/WEBHOOK/LOG_RESULT)
- Shows: action parameters
- Color scheme: Pink gradient with lightning icon
- Supports multiple action types

### 2. Results Preview Component

**`components/strategy-builder/results-preview.tsx`**:
- Displays real-time execution results
- Shows:
  - Execution status (SUCCESS/FAILED)
  - Execution time in milliseconds
  - Number of nodes evaluated
  - Data points processed
  - Matched wallets with metrics (omega_ratio, net_pnl, win_rate)
  - Aggregation results
  - Signals generated
  - Actions executed
- Scrollable wallet list (shows up to 50)
- Error messages if execution fails
- Loading state during execution

### 3. Updated Main Page

**`app/(dashboard)/strategy-builder/page.tsx`**:

**Key Changes:**
- Replaced generic node types with 6 custom strategy nodes
- Removed all mock data
- Connected to `/api/strategies/execute` for real execution
- Added proper error handling with toast notifications
- Implemented save/load functionality with database
- Added loading states for strategy loading and execution
- Real-time results preview panel

**Features:**
- Create new strategies
- Load existing strategies from database
- Save strategies (auto-saves on execution if unsaved)
- Execute strategies and view real results
- Import/export strategies as JSON
- Clear canvas
- Responsive design with mobile support

### 4. Updated Strategy Library

**`components/strategy-library/index.tsx`**:

**Key Changes:**
- Loads strategies from `/api/strategies` endpoint
- Displays real strategy data from database
- Shows node type breakdown with icons
- Real-time timestamp updates
- Delete functionality for custom strategies
- No more localStorage fallback (pure database)

**Features:**
- Search strategies by name/description
- Filter by type (All/Default Templates/My Strategies)
- View node counts and composition
- Edit strategies (opens builder)
- Delete custom strategies
- Create new strategies

### 5. New API Endpoints

Created complete CRUD API for strategies:

#### `app/api/strategies/route.ts`
- **GET** `/api/strategies` - List all strategies
- **POST** `/api/strategies` - Create new strategy

#### `app/api/strategies/[id]/route.ts`
- **GET** `/api/strategies/[id]` - Get strategy by ID
- **PUT** `/api/strategies/[id]` - Update strategy
- **DELETE** `/api/strategies/[id]` - Delete strategy

All endpoints properly handle:
- Type conversion between database and TypeScript types
- Error handling with proper HTTP status codes
- JSON serialization of complex node graphs

## Database Schema

The backend expects this `strategy_definitions` table structure:

```sql
CREATE TABLE strategy_definitions (
  strategy_id UUID PRIMARY KEY,
  strategy_name TEXT NOT NULL,
  strategy_description TEXT,
  strategy_type TEXT NOT NULL,
  is_predefined BOOLEAN DEFAULT FALSE,
  node_graph JSONB NOT NULL,
  execution_mode TEXT DEFAULT 'MANUAL',
  schedule_cron TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_by TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

## Backend Integration Points

### Execution Flow

1. **User clicks "Run Strategy"** in UI
2. If strategy not saved, auto-save via `POST /api/strategies`
3. Call `POST /api/strategies/execute` with strategy_id
4. Backend execution engine processes nodes
5. Results returned to UI and displayed in ResultsPreview component

### Data Sources

The execution engine connects to:
- **ClickHouse** for advanced wallet metrics (102 metrics)
- **Supabase** for basic metrics

## File Structure

```
app/
├── (dashboard)/
│   └── strategy-builder/
│       └── page.tsx                    # Main builder page (UPDATED)
└── api/
    └── strategies/
        ├── route.ts                    # List/Create strategies (NEW)
        ├── [id]/
        │   └── route.ts                # Get/Update/Delete strategy (NEW)
        └── execute/
            └── route.ts                # Execute strategy (EXISTING)

components/
├── strategy-nodes/                     # Custom node components (NEW)
│   ├── index.ts
│   ├── data-source-node.tsx
│   ├── filter-node.tsx
│   ├── logic-node.tsx
│   ├── aggregation-node.tsx
│   ├── signal-node.tsx
│   └── action-node.tsx
├── strategy-builder/                   # Builder components (NEW)
│   └── results-preview.tsx
└── strategy-library/
    └── index.tsx                       # Strategy library (UPDATED)

lib/
└── strategy-builder/                   # Backend (EXISTING - NO CHANGES)
    ├── types.ts
    ├── execution-engine.ts
    ├── clickhouse-connector.ts
    └── supabase-connector.ts
```

## Key Improvements

### Before (Old Version)
- Generic workflow builder
- Mock data everywhere
- No database integration
- Universal node types (JavaScript, HTTP, etc.)
- No real metrics or wallet data

### After (This Implementation)
- Purpose-built for wallet screening
- Real backend integration
- Live data from ClickHouse and Supabase
- 6 custom node types matching backend exactly
- Displays actual wallet metrics
- Real execution results with timing data
- Database persistence for strategies

## Testing the Implementation

1. **Create a Strategy:**
   - Navigate to `/strategy-builder`
   - Click "Create New Strategy"
   - Add a DATA_SOURCE node
   - Add a FILTER node (omega_ratio > 1.5)
   - Connect them
   - Click "Save"

2. **Execute a Strategy:**
   - Click "Run Strategy"
   - Wait for execution
   - View results in right panel
   - See matched wallets with real metrics

3. **Load a Strategy:**
   - Go back to library
   - Click "Edit Strategy" on any saved strategy
   - Nodes and connections load from database
   - Modify and save changes
