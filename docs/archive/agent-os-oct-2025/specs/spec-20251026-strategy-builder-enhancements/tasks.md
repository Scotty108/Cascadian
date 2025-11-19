# Task Breakdown: Strategy Builder Enhancements

## Overview
**Feature**: Advanced Filtering, Data Flow Visualization, AI Portfolio Management, and Intelligent Layouts
**Total Estimated Time**: 6 weeks
**Total Task Groups**: 4 phases with 15 task groups

---

## Task List

## PHASE 1: Enhanced Filter Node (Weeks 1-2)

### Task Group 1: Multi-Condition Filter Foundation
**Priority**: P0 (Critical Path)
**Dependencies**: None
**Estimated Time**: 3-4 days
**Assignee**: frontend-engineer

- [x] 1.0 Complete multi-condition filter foundation
  - [x] 1.1 Write 2-8 focused tests for multi-condition builder
    - Test adding/removing conditions (2 tests)
    - Test AND/OR logic switching (2 tests)
    - Test condition reordering (1 test)
    - Test validation of empty conditions (1 test)
    - Skip: Exhaustive UI interaction tests, edge case testing
  - [x] 1.2 Create condition data model and TypeScript types
    - Define `FilterCondition` interface with field, operator, value, type
    - Define `FilterLogic` type ('AND' | 'OR')
    - Define `EnhancedFilterConfig` type extending existing node config
    - Reference pattern from: `lib/workflow/node-executors.ts`
  - [x] 1.3 Build `multi-condition-builder.tsx` component
    - Container component managing array of conditions
    - Add/remove condition buttons
    - AND/OR toggle between conditions
    - Visual hierarchy with proper spacing
    - Use Tailwind CSS for styling (existing pattern)
  - [x] 1.4 Build `condition-row.tsx` component
    - Single row with field selector, operator selector, value input
    - Remove button (X icon)
    - Drag handle for reordering (optional: defer to Phase 2)
    - Responsive layout (mobile/tablet/desktop)
  - [x] 1.5 Ensure multi-condition builder tests pass
    - Run ONLY the 2-8 tests written in 1.1
    - Verify conditions can be added/removed
    - Verify AND/OR logic persists in state
    - Do NOT run entire test suite

**Acceptance Criteria**:
- The 2-8 tests written in 1.1 pass
- User can add up to 10 conditions in a single filter node
- AND/OR toggle works between conditions
- Conditions can be removed individually
- Component renders correctly on mobile/tablet/desktop

---

### Task Group 2: Field Discovery System
**Priority**: P0 (Critical Path)
**Dependencies**: ✅ Task Group 1 (Multi-Condition Filter Foundation) - COMPLETE
**Estimated Time**: 2-3 days
**Assignee**: frontend-engineer
**Status**: ✅ COMPLETE

- [x] 2.0 Complete field discovery system
  - [x] 2.1 Write 2-8 focused tests for field discovery
    - Test field extraction from sample data (2 tests)
    - Test nested field path detection (2 tests)
    - Test field type detection (number, string, array, date) (2 tests)
    - Skip: Performance tests, complex nested scenarios
  - [x] 2.2 Create `field-discovery.ts` utility
    - Function to extract all field paths from upstream node output
    - Support for nested fields (e.g., `analytics.roi`)
    - Field type inference from sample values
    - Return structured field metadata: `{ path: string, type: FieldType, sample: any }`
  - [x] 2.3 Build `field-selector.tsx` component
    - Searchable dropdown with autocomplete
    - Group fields by category (Market Data, Analytics, Metadata)
    - Display field type icon (# for numbers, "T" for text, [] for arrays)
    - Show sample value tooltip
    - Use existing dropdown pattern from codebase
  - [x] 2.4 Integrate field discovery into executor
    - Extend `executeNode` function in `lib/workflow/executor.ts`
    - Pass upstream output to field discovery
    - Cache discovered fields per execution
    - Handle cases where upstream data is empty
  - [x] 2.5 Ensure field discovery tests pass
    - Run ONLY the 2-8 tests written in 2.1
    - Verify fields extracted correctly from sample data
    - Verify nested field paths work
    - Verify type detection accurate
    - Do NOT run entire test suite

**Acceptance Criteria**: ✅ ALL MET
- ✅ The 2-8 tests written in 2.1 pass (13 tests total - all passing)
- ✅ Field dropdown shows all fields from upstream node output
- ✅ Nested field paths (e.g., `analytics.roi`) detected correctly
- ✅ Field types inferred accurately (number, string, array, date, boolean, object, unknown)
- ✅ Sample values displayed in dropdown

---

### Task Group 3: Smart Operators and Value Inputs
**Priority**: P0 (Critical Path)
**Dependencies**: ✅ Task Group 2 (Field Discovery System) - COMPLETE
**Estimated Time**: 2-3 days
**Assignee**: frontend-engineer
**Status**: ✅ COMPLETE

- [x] 3.0 Complete smart operators and value inputs
  - [x] 3.1 Write 2-8 focused tests for operator/value components
    - Test operator filtering based on field type (4 tests) ✅
    - Test value input type switching (number vs text) (2 tests) ✅
    - Test BETWEEN operator (1 test) ✅
    - Test value change callback (1 test) ✅
    - Total: 8 tests written and passing
    - Skip: All edge cases, validation tests (defer to executor tests)
  - [x] 3.2 Build `operator-selector.tsx` component
    - Filter operators based on field type:
      - Numbers: `=`, `!=`, `>`, `>=`, `<`, `<=`, `BETWEEN` ✅
      - Strings: `=`, `!=`, `CONTAINS`, `STARTS WITH`, `ENDS WITH`, `IN` ✅
      - Arrays: `CONTAINS`, `HAS ANY`, `HAS ALL`, `IS EMPTY` ✅
      - Dates: `=`, `!=`, `>`, `>=`, `<`, `<=`, `BETWEEN` ✅
    - Dropdown with clear operator labels ✅
    - Auto-select appropriate operator when field type changes ✅
  - [x] 3.3 Build `value-input.tsx` component
    - Smart input that changes based on field type:
      - Number: Number input with +/- buttons ✅
      - String: Text input with autocomplete ✅
      - Date: Date picker (use existing date picker component) ✅
      - Boolean: Toggle switch ✅
    - Handle BETWEEN operator (two inputs: from/to) ✅
    - Validation feedback (red border for invalid) - Deferred to Task 3.4
  - [x] 3.4 Integrate into condition-row.tsx
    - Added `useSmartInputs` prop to enable smart components ✅
    - Integrated OperatorSelector with field type awareness ✅
    - Integrated ValueInput with operator and field type awareness ✅
    - Auto-update field type when field selection changes ✅
    - Backward compatible with legacy mode ✅
  - [x] 3.5 Ensure operator/value tests pass
    - Run ONLY the 2-8 tests written in 3.1 ✅
    - Verify operators filtered by field type ✅
    - Verify value inputs switch based on field type ✅
    - All 8 tests passing ✅
    - Do NOT run entire test suite ✅

**Acceptance Criteria**: ✅ ALL MET
- ✅ The 8 tests written in 3.1 pass
- ✅ Operator dropdown shows only relevant operators for field type
- ✅ Value input switches format based on field type (number, text, date, boolean)
- ✅ BETWEEN operator shows two inputs (from/to)
- ⚠️ Autocomplete for categories and tags - Deferred to Task Group 4 (Category and Tag Filters)

---

### Task Group 4: Category and Tag Filters
**Priority**: P1 (High Priority)
**Dependencies**: ✅ Task Group 3 (Smart Operators and Value Inputs) - COMPLETE
**Estimated Time**: 2 days
**Assignee**: frontend-engineer
**Status**: ✅ COMPLETE

- [x] 4.0 Complete category and tag filters
  - [x] 4.1 Write 2-6 focused tests for category/tag filters
    - Test category filter UI (3 tests) ✅
    - Test tag multi-select UI (3 tests) ✅
    - Test integration with condition builder (1 test) ✅
    - Total: 7 tests written and passing ✅
    - Skip: Backend category/tag fetch tests (covered by API tests)
  - [x] 4.2 Build `category-picker.tsx` component
    - Dropdown with Polymarket categories: ✅
      - Politics, Crypto, Sports, Pop Culture, Science, Business, Technology, News, Weather, Other ✅
    - Search functionality ✅
    - Icons for each category ✅
    - Single-select or multi-select based on operator ✅
  - [x] 4.3 Build `tag-picker.tsx` component
    - Multi-select dropdown with autocomplete ✅
    - Predefined list of 20+ common Polymarket tags ✅
    - Show tag popularity (count of markets with tag) ✅
    - Allow creating new tags inline ✅
    - Chip-style selected tags display ✅
  - [x] 4.4 Add category/tag filter types to condition builder
    - Extended ValueInput to detect category fields (by name or type) ✅
    - Show category picker when field name includes "category" ✅
    - Show tag picker when field type is array or name includes "tag" ✅
    - Multi-select support for IN/NOT_IN operators ✅
    - Persist category/tag values in filter config ✅
  - [x] 4.5 Ensure category/tag filter tests pass
    - Run ONLY the 7 tests written in 4.1 ✅
    - Verify category picker renders and displays values ✅
    - Verify tag picker supports multi-select and chip removal ✅
    - All tests passing (23 total in strategy-builder suite) ✅
    - Do NOT run entire test suite ✅

**Acceptance Criteria**: ✅ ALL MET
- ✅ The 7 tests written in 4.1 pass
- ✅ Category filter shows all Polymarket categories (10 categories)
- ✅ Tag filter supports multi-select with autocomplete (20+ tags)
- ✅ Selected categories/tags persist in filter configuration
- ✅ UI matches existing design system
- ✅ Search/filter functionality works for both pickers
- ✅ Mobile-responsive design with proper chip display

---

### Task Group 5: Text Search Filters
**Priority**: P1 (High Priority)
**Dependencies**: ✅ Task Group 3 (Smart Operators and Value Inputs) - COMPLETE
**Estimated Time**: 1-2 days
**Assignee**: frontend-engineer
**Status**: ✅ COMPLETE

- [x] 5.0 Complete text search filters
  - [x] 5.1 Write 2-4 focused tests for text search
    - Test text search input (1 test) ✅
    - Test case-sensitive toggle (1 test) ✅
    - Test value changes (1 test) ✅
    - Test operator support (1 test) ✅
    - Test case-sensitive state persistence (1 test) ✅
    - Test onChange callbacks (1 test) ✅
    - Total: 6 tests written and passing ✅
    - Skip: Advanced regex, performance tests
  - [x] 5.2 Build `text-search-input.tsx` component
    - Text input field with search icon ✅
    - Operators: CONTAINS, DOES_NOT_CONTAIN, STARTS_WITH, ENDS_WITH ✅
    - Case-sensitive toggle checkbox ✅
    - Helper function `isTextSearchOperator` to detect text search operators ✅
    - Highlight matching text in preview (optional) - Deferred to Phase 2
  - [x] 5.3 Add text search to condition builder
    - Added new operators to FilterOperator type: DOES_NOT_CONTAIN, STARTS_WITH, ENDS_WITH ✅
    - Updated FilterCondition interface with caseSensitive field ✅
    - Integrated TextSearchInput into ValueInput component ✅
    - Auto-detect text search operators and show TextSearchInput ✅
    - Updated OperatorSelector to include text search operators for string fields ✅
    - Updated ConditionRow to pass caseSensitive prop ✅
    - Persist text search config in filter node data (via FilterCondition) ✅
  - [x] 5.4 Ensure text search tests pass
    - Run ONLY the 6 tests written in 5.1 ✅
    - Verify text search input works ✅
    - Verify case-sensitive toggle persists ✅
    - All 6 tests passing ✅
    - All strategy-builder tests passing (29 total) ✅
    - Do NOT run entire test suite ✅

**Acceptance Criteria**: ✅ ALL MET
- ✅ The 6 tests written in 5.1 pass
- ✅ Text search input with case-sensitive toggle
- ✅ Supports CONTAINS, DOES_NOT_CONTAIN, STARTS_WITH, ENDS_WITH operators
- ✅ Works with string field types
- ✅ Case-sensitive option works correctly
- ✅ Integrates seamlessly with ValueInput and ConditionRow
- ✅ Mobile-responsive design

---

### Task Group 6: Filter Executor Logic
**Priority**: P0 (Critical Path)
**Dependencies**: ✅ Task Groups 1-5 - ALL COMPLETE
**Estimated Time**: 3-4 days
**Assignee**: backend-engineer
**Status**: ✅ COMPLETE

- [x] 6.0 Complete filter executor logic
  - [x] 6.1 Write 2-8 focused tests for filter executor
    - Test multi-condition AND logic (2 tests) ✅
    - Test multi-condition OR logic (2 tests) ✅
    - Test category filtering (2 tests) ✅
    - Test tag filtering (2 tests) ✅
    - Test text search filtering (3 tests) ✅
    - Test BETWEEN operator (1 test) ✅
    - Test all operators support (3 tests) ✅
    - Test filter failure tracking (2 tests) ✅
    - Test performance and edge cases (3 tests) ✅
    - Total: 20 tests written and passing ✅
    - Skip: Complex nested logic (deferred to Phase 2), edge cases
  - [x] 6.2 Create `filter-executor-v2.ts` in `lib/workflow/`
    - Created enhanced filter executor ✅
    - Implements multi-condition evaluation with AND/OR logic ✅
    - Support all operators: EQUALS, NOT_EQUALS, GREATER_THAN, LESS_THAN, BETWEEN, IN, NOT_IN, CONTAINS, STARTS_WITH, ENDS_WITH ✅
    - Handle nested field paths (e.g., `analytics.roi`) ✅
  - [x] 6.3 Implement category filter logic
    - Match against market `category` field ✅
    - Support operators: EQUALS, NOT_EQUALS, IN, NOT_IN ✅
    - Case-insensitive matching ✅
  - [x] 6.4 Implement tag filter logic
    - Match against market `tags` array field ✅
    - Support operators: CONTAINS, IN (for arrays) ✅
    - Case-insensitive matching ✅
  - [x] 6.5 Implement text search logic
    - Search in specified fields (title, question, description) ✅
    - Support operators: CONTAINS, DOES_NOT_CONTAIN, STARTS_WITH, ENDS_WITH ✅
    - Respect case-sensitive toggle ✅
    - Use efficient string matching (no regex for MVP) ✅
  - [x] 6.6 Add filter failure tracking
    - For each filtered-out item, record which condition failed ✅
    - Store in format: `{ "market-123": "volume (45000) < 100000" }` ✅
    - Human-readable failure reasons for debugging ✅
    - Will be used by debug panel in Phase 2 ✅
  - [x] 6.7 Integrate into main executor
    - Update `executeFilterNode` in `lib/workflow/node-executors.ts` ✅
    - Check for enhanced filter config vs legacy config (version: 2) ✅
    - Route to appropriate executor (legacy or v2) ✅
    - Maintain backward compatibility ✅
  - [x] 6.8 Ensure filter executor tests pass
    - Run ONLY the 20 tests written in 6.1 ✅
    - Verify AND/OR logic works correctly ✅
    - Verify all filter types (category, tag, text) work ✅
    - All 20 tests passing ✅
    - Do NOT run entire test suite ✅

**Acceptance Criteria**: ✅ ALL MET
- ✅ The 20 tests written in 6.1 pass
- ✅ Multi-condition filters with AND/OR logic work correctly
- ✅ All operators implemented and tested (15 operators)
- ✅ Category, tag, and text search filters work
- ✅ Filter failure reasons tracked for debug panel
- ✅ Backward compatible with existing filter nodes
- ✅ Performance acceptable (< 100ms for 1000 items) - 2ms in tests

---

### Task Group 7: Enhanced Filter Node UI Integration
**Priority**: P0 (Critical Path)
**Dependencies**: ✅ Task Groups 1-6 - ALL COMPLETE
**Estimated Time**: 2-3 days
**Assignee**: frontend-engineer
**Status**: ✅ COMPLETE

- [x] 7.0 Complete enhanced filter node UI integration
  - [x] 7.1 Write 2-6 focused tests for filter node integration
    - Test filter node configuration panel opens (1 test) ✅
    - Test saving filter configuration (2 tests) ✅
    - Test filter node display summary (2 tests) ✅
    - Total: 5 tests written and passing ✅
    - Skip: Full end-to-end workflow tests (defer to Phase 4 integration)
  - [x] 7.2 Create or update `enhanced-filter-node.tsx` component
    - Created new EnhancedFilterNode component ✅
    - Added "Enhanced Filter" node type to palette ✅
    - Display condition count badge on node (e.g., "3 conditions") ✅
    - Show AND/OR logic indicator ✅
    - Compatible with ReactFlow patterns ✅
  - [x] 7.3 Build filter configuration panel
    - Side panel that opens when filter node clicked ✅
    - Embed multi-condition builder component ✅
    - Save/Cancel buttons ✅
    - Real-time validation feedback ✅
    - Preview of filter logic in plain English ✅
  - [x] 7.4 Add real-time validation
    - Validate that all conditions have required fields ✅
    - Validate operator/value type compatibility ✅
    - Show error messages inline (red text) ✅
    - Disable save button until valid ✅
    - Warning for potentially restrictive conditions ✅
  - [x] 7.5 Create filter summary display
    - Show on node canvas: "3 conditions (AND)" or "5 conditions (OR)" ✅
    - First condition preview ✅
    - Color coding: purple for valid, red for invalid ✅
    - Additional conditions indicator ✅
  - [x] 7.6 Ensure filter node integration tests pass
    - Run ONLY the 5 tests written in 7.1 ✅
    - Verify configuration panel opens/closes ✅
    - Verify filter config saves correctly ✅
    - All 5 tests passing ✅
    - Do NOT run entire test suite ✅

**Acceptance Criteria**: ✅ ALL MET
- ✅ The 5 tests written in 7.1 pass
- ✅ Enhanced filter node appears in node palette
- ✅ Configuration panel opens with multi-condition builder
- ✅ Real-time validation prevents invalid configurations
- ✅ Filter summary displays on canvas
- ✅ Filter configuration persists when saved
- ✅ Backward compatible with existing filter nodes
- ✅ Smart inputs enabled (field selector, operator selector, value inputs with categories/tags/text search)

---

## PHASE 2: Data Flow Visualization Panel (Week 3)

### Task Group 8: Data Trace Capture System
**Priority**: P0 (Critical Path)
**Dependencies**: Phase 1 complete
**Estimated Time**: 3-4 days
**Assignee**: backend-engineer

- [ ] 8.0 Complete data trace capture system
  - [ ] 8.1 Write 2-8 focused tests for trace capture
    - Test input/output snapshot creation (2 tests)
    - Test items_added/items_removed tracking (2 tests)
    - Test filter_failures recording (2 tests)
    - Test 1000-item limit enforcement (1 test)
    - Skip: Performance tests, concurrent execution tests
  - [ ] 8.2 Create database migration for data flow traces
    - File: `supabase/migrations/20251027000000_add_data_flow_traces.sql`
    - Add columns to `strategy_execution_logs`:
      - `input_snapshot` (JSONB)
      - `output_snapshot` (JSONB)
      - `items_added` (TEXT[])
      - `items_removed` (TEXT[])
      - `filter_failures` (JSONB)
    - Add size constraint (max 1000 items per snapshot)
    - Add indexes for snapshot queries
    - Follow migration pattern from existing migrations
  - [ ] 8.3 Create `trace-collector.ts` in `lib/workflow/node-executors/`
    - Function: `captureNodeTrace(nodeId, input, output, failures)`
    - Limit snapshots to first 1000 items (performance)
    - Calculate items_added: items in output but not in input
    - Calculate items_removed: items in input but not in output
    - Format filter failures: `{ "item-id": "reason string" }`
  - [ ] 8.4 Integrate trace capture into executor
    - Update `executeNode` in `lib/workflow/executor.ts`
    - Call `captureNodeTrace` after each node execution
    - Store trace data in `strategy_execution_logs` table
    - Only capture if debug mode enabled (performance optimization)
  - [ ] 8.5 Create API endpoint for trace retrieval
    - Endpoint: `GET /api/executions/[id]/trace`
    - Return: Array of node traces with input/output snapshots
    - Endpoint: `GET /api/executions/[id]/trace/[node_id]`
    - Return: Single node trace details
    - Add pagination for large datasets
  - [ ] 8.6 Ensure trace capture tests pass
    - Run ONLY the 2-8 tests written in 8.1
    - Verify snapshots created correctly
    - Verify item tracking works
    - Verify 1000-item limit enforced
    - Do NOT run entire test suite

**Acceptance Criteria**:
- The 2-8 tests written in 8.1 pass
- Migration creates new columns successfully
- Trace data captured for each node execution
- Input/output snapshots limited to 1000 items
- Filter failures recorded with reasons
- API endpoints return trace data

---

### Task Group 9: Debug Panel UI Layout
**Priority**: P0 (Critical Path)
**Dependencies**: Task Group 8
**Estimated Time**: 2-3 days
**Assignee**: frontend-engineer

- [ ] 9.0 Complete debug panel UI layout
  - [ ] 9.1 Write 2-6 focused tests for debug panel
    - Test panel open/close (1 test)
    - Test side panel vs full-screen toggle (1 test)
    - Test node list rendering (1 test)
    - Skip: Complex interaction tests, responsive tests
  - [ ] 9.2 Create `data-flow-panel/index.tsx` component
    - Main debug panel container
    - Side panel layout (default): 500px width, slide from right
    - Full-screen modal layout (toggle): covers entire screen
    - Close button (X icon)
    - Toggle button: Side panel ↔ Full-screen
  - [ ] 9.3 Build `debug-panel-layout.tsx` component
    - Handles layout switching (side panel / full-screen)
    - Smooth animations (slide-in, fade)
    - Responsive: Full-screen on mobile, side panel on desktop
    - Use existing modal/panel patterns from codebase
  - [ ] 9.4 Add "Debug" button to execution history
    - Button in execution history row: "Debug" or debug icon
    - Opens debug panel for that execution
    - Fetch execution trace data on open
    - Loading state while fetching
  - [ ] 9.5 Implement panel state management
    - Track: panel open/closed, layout mode, selected node
    - Use React state or Zustand (check existing state management)
    - Persist layout preference in localStorage
  - [ ] 9.6 Ensure debug panel tests pass
    - Run ONLY the 2-6 tests written in 9.1
    - Verify panel opens/closes
    - Verify layout toggle works
    - Do NOT run entire test suite

**Acceptance Criteria**:
- The 2-6 tests written in 9.1 pass
- Debug panel opens from execution history
- Side panel and full-screen modes work
- Layout preference persists
- Smooth animations and responsive design

---

### Task Group 10: Node List and Detail Views
**Priority**: P0 (Critical Path)
**Dependencies**: Task Group 9
**Estimated Time**: 3-4 days
**Assignee**: frontend-engineer

- [ ] 10.0 Complete node list and detail views
  - [ ] 10.1 Write 2-8 focused tests for node list/detail views
    - Test node list rendering with data (2 tests)
    - Test node selection (1 test)
    - Test detail view data table (2 tests)
    - Test table sorting (1 test)
    - Skip: Complex filtering, pagination tests
  - [ ] 10.2 Build `node-list-view.tsx` component
    - Vertical timeline of nodes in execution order
    - For each node display:
      - Node name and type
      - Input count: "500 markets in"
      - Output count: "47 markets out"
      - Items removed: "-453 filtered" (red badge)
      - Execution time: "1.2s"
    - Click node to show details
    - Highlight selected node
  - [ ] 10.3 Build `node-detail-view.tsx` component
    - Split pane layout: Input table | Output table
    - Tabs: "Input", "Output", "Diff View"
    - Show selected node name and metrics at top
    - Back button to return to node list
  - [ ] 10.4 Build `data-table.tsx` component
    - Use `@tanstack/react-table` or existing table component
    - Display market/item data in table format
    - Sortable columns (click header to sort)
    - Searchable (search box above table)
    - Pagination: 50 items per page
    - Highlight filtered items (red background)
    - Highlight added items (green background)
  - [ ] 10.5 Add diff view tab
    - Shows items added (green) and removed (red) side-by-side
    - Clear visual distinction (green/red backgrounds)
    - Only show changed items (not all items)
  - [ ] 10.6 Ensure node list/detail tests pass
    - Run ONLY the 2-8 tests written in 10.1
    - Verify node list renders with correct counts
    - Verify detail view shows data tables
    - Verify sorting works
    - Do NOT run entire test suite

**Acceptance Criteria**:
- The 2-8 tests written in 10.1 pass
- Node list shows all nodes with input/output counts
- Detail view displays input/output data in tables
- Tables are sortable and searchable
- Diff view highlights added/removed items
- Pagination handles 1000+ items

---

### Task Group 11: Item Tracing and Export
**Priority**: P1 (High Priority)
**Dependencies**: Task Group 10
**Estimated Time**: 2-3 days
**Assignee**: frontend-engineer

- [ ] 11.0 Complete item tracing and export
  - [ ] 11.1 Write 2-6 focused tests for item tracing
    - Test item selection (1 test)
    - Test trace path highlighting (2 tests)
    - Test filter failure reason display (1 test)
    - Skip: Complex multi-item tracing, visual regression tests
  - [ ] 11.2 Build `item-trace-view.tsx` component
    - Click item in table to trace its path
    - Show breadcrumb trail: "Market ABC → Filter Node → Transform → Watchlist"
    - Highlight path on flow diagram (if shown)
    - Display filter failure reason tooltip
  - [ ] 11.3 Implement item path tracing logic
    - Track item ID through all node snapshots
    - Determine at which node item was filtered out
    - Extract filter failure reason from `filter_failures` JSONB
    - Display in user-friendly format: "Filtered out by: volume (45000) < 100000"
  - [ ] 11.4 Add visual path highlighting
    - Optional: Mini flow diagram showing workflow
    - Highlight nodes that item passed through (green)
    - Highlight node that filtered it out (red)
    - Use simplified ReactFlow or custom SVG
  - [ ] 11.5 Build `export-button.tsx` component
    - Export button in data table toolbar
    - Export current view to CSV
    - Columns: All visible table columns
    - Filename: `execution-[id]-[node-name]-[timestamp].csv`
    - Use existing CSV export utility or create new
  - [ ] 11.6 Create `export-csv.ts` utility in `lib/utils/`
    - Function: `exportTableToCSV(data, columns, filename)`
    - Convert JSON data to CSV format
    - Handle nested objects (flatten to dot notation)
    - Trigger browser download
  - [ ] 11.7 Ensure item tracing tests pass
    - Run ONLY the 2-6 tests written in 11.1
    - Verify item can be selected and traced
    - Verify filter failure reasons display
    - Do NOT run entire test suite

**Acceptance Criteria**:
- The 2-6 tests written in 11.1 pass
- User can click item to trace its path through workflow
- Breadcrumb trail shows which nodes item passed through
- Filter failure reasons display clearly
- Export to CSV works for all data tables
- Performance handles 1000+ items

---

## PHASE 3: Portfolio Orchestrator Node (Weeks 4-5)

### Task Group 12: Orchestrator Database and API Foundation
**Priority**: P0 (Critical Path)
**Dependencies**: Phase 2 complete
**Estimated Time**: 3-4 days
**Assignee**: backend-engineer

- [ ] 12.0 Complete orchestrator database and API foundation
  - [ ] 12.1 Write 2-8 focused tests for orchestrator APIs
    - Test decision creation (2 tests)
    - Test decision approval (2 tests)
    - Test decision rejection (1 test)
    - Test decision history retrieval (1 test)
    - Skip: Complex edge cases, concurrent approval tests
  - [ ] 12.2 Create orchestrator_decisions table migration
    - File: `supabase/migrations/20251027000001_create_orchestrator_decisions.sql`
    - Columns: id, execution_id, workflow_id, node_id, market_id, decision, direction, recommended_size, actual_size, risk_score, ai_reasoning, ai_confidence, portfolio_snapshot, user_override, created_at, decided_at, etc.
    - Indexes: pending decisions, workflow history, execution history
    - RLS policies: users can only view/edit their own decisions
    - Follow migration pattern from requirements.md
  - [ ] 12.3 Create API endpoint: POST /api/orchestrator/analyze
    - Input: Market data, portfolio state, position sizing rules
    - Calls AI analysis function (next task)
    - Output: Decision (GO/NO-GO), recommended size, risk score, reasoning
    - Error handling for AI API failures
  - [ ] 12.4 Create API endpoint: POST /api/orchestrator/decisions/[id]/approve
    - Input: Decision ID, optional size adjustment
    - Update decision record: status='approve', decided_at=now
    - If size adjusted: set actual_size, user_override=true
    - Trigger trade execution (integrate with existing trade system)
    - Output: Confirmation with trade ID
  - [ ] 12.5 Create API endpoint: POST /api/orchestrator/decisions/[id]/reject
    - Input: Decision ID, optional rejection reason
    - Update decision record: status='reject', decided_at=now, override_reason
    - Do NOT execute trade
    - Output: Confirmation
  - [ ] 12.6 Create API endpoint: GET /api/orchestrator/decisions
    - Query params: workflow_id, status, limit, offset
    - Return: Array of decisions with pagination
    - Include market data, portfolio snapshot, AI reasoning
    - Sort by created_at DESC
  - [ ] 12.7 Ensure orchestrator API tests pass
    - Run ONLY the 2-8 tests written in 12.1
    - Verify decision creation works
    - Verify approval/rejection flows work
    - Do NOT run entire test suite

**Acceptance Criteria**:
- The 2-8 tests written in 12.1 pass
- Migration creates orchestrator_decisions table
- All API endpoints functional and tested
- RLS policies enforce user data isolation
- Error handling for edge cases

---

### Task Group 13: AI Risk Analysis Engine
**Priority**: P0 (Critical Path)
**Dependencies**: Task Group 12
**Estimated Time**: 3-4 days
**Assignee**: backend-engineer

- [ ] 13.0 Complete AI risk analysis engine
  - [ ] 13.1 Write 2-6 focused tests for AI analysis
    - Test AI analysis with mock response (2 tests)
    - Test position sizing calculation (2 tests)
    - Test rule validation (max %, portfolio heat) (1 test)
    - Skip: AI prompt optimization tests, performance tests
  - [ ] 13.2 Create `orchestrator-analysis.ts` in `lib/ai/`
    - Function: `analyzeOpportunity(market, portfolio, rules, signal)`
    - Build AI prompt with market data, portfolio state, strategy signal
    - Call Claude Sonnet 4.5 API (use existing AI SDK pattern)
    - Parse AI response into structured format:
      ```ts
      {
        decision: 'GO' | 'NO_GO',
        recommended_size: number,
        risk_score: number, // 1-10
        reasoning: string,
        confidence: number // 0-1
      }
      ```
  - [ ] 13.3 Implement position sizing rules validation
    - Function: `validatePositionSizing(size, portfolio, rules)`
    - Check max % per position: `size <= portfolio.total * rules.max_per_position`
    - Check absolute limits: `size >= rules.min_bet && size <= rules.max_bet`
    - Check portfolio heat: `portfolio.deployed + size <= portfolio.total * rules.portfolio_heat_limit`
    - Check risk-reward ratio: `calculateRiskReward(market) >= rules.risk_reward_threshold`
    - Return validation errors array if any rules violated
  - [ ] 13.4 Implement volatility adjustment
    - Function: `calculateVolatilityScore(market)`
    - Use market liquidity, volume, and odds stability as proxies
    - Formula: `volatility_score = (1 / liquidity) * volume_factor`
    - Adjust position size: `adjusted_size = base_size * (1 / volatility_score)`
    - Cap adjustment factor to prevent extreme sizes
  - [ ] 13.5 Implement drawdown protection
    - Function: `applyDrawdownProtection(size, portfolio, rules)`
    - Calculate current drawdown: `(portfolio.recent_pnl / portfolio.total) * 100`
    - If drawdown exceeds threshold: reduce size by configured %
    - Example: If down 10%, reduce bet sizes by 50%
  - [ ] 13.6 Build AI prompt template
    - Clear, structured prompt for Claude Sonnet 4.5
    - Include: market details, portfolio state, strategy signal, user rules
    - Request: GO/NO-GO decision, recommended size, risk score, reasoning
    - Follow prompt pattern from requirements.md
    - Test prompt with sample data
  - [ ] 13.7 Ensure AI analysis tests pass
    - Run ONLY the 2-6 tests written in 13.1
    - Verify AI analysis returns expected format
    - Verify position sizing rules enforced
    - Do NOT run entire test suite

**Acceptance Criteria**:
- The 2-6 tests written in 13.1 pass
- AI analysis function calls Claude API successfully
- Position sizing rules validated correctly
- Volatility adjustment and drawdown protection work
- AI responses parsed into structured format
- Error handling for AI API failures

---

### Task Group 14: Orchestrator Node UI and Configuration
**Priority**: P0 (Critical Path)
**Dependencies**: Task Groups 12-13
**Estimated Time**: 3-4 days
**Assignee**: frontend-engineer

- [ ] 14.0 Complete orchestrator node UI and configuration
  - [ ] 14.1 Write 2-8 focused tests for orchestrator UI
    - Test orchestrator node rendering (1 test)
    - Test config panel opening (1 test)
    - Test rule configuration saving (2 tests)
    - Test mode toggle (autonomous vs approval) (1 test)
    - Skip: Complex form validation tests, visual tests
  - [ ] 14.2 Create `orchestrator-node.tsx` component
    - New node type in strategy builder palette
    - Node icon: Portfolio or shield icon
    - Display mode badge: "Autonomous" or "Approval Required"
    - Display pending decisions count: "3 pending" (red badge)
    - Compatible with ReactFlow
  - [ ] 14.3 Build `config-panel.tsx` for orchestrator
    - Side panel that opens when orchestrator node clicked
    - Sections: Basic Settings, Position Sizing Rules, Advanced
    - Portfolio size input (number, required)
    - Risk tolerance slider (1-10)
    - Operating mode toggle: Autonomous / Approval Required
  - [ ] 14.4 Build `position-sizing-rules.tsx` component
    - Max % per position: Percentage slider (1-20%)
    - Min bet size: Number input (default: $5)
    - Max bet size: Number input (default: $500)
    - Portfolio heat limit: Percentage slider (10-100%)
    - Risk-reward ratio threshold: Number input (1.0-10.0)
    - Drawdown protection:
      - Drawdown % threshold: Number input
      - Bet size reduction %: Number input
    - All inputs with labels, tooltips, validation
  - [ ] 14.5 Build `risk-tolerance-slider.tsx` component
    - Slider from 1 (conservative) to 10 (aggressive)
    - Visual markers at 1, 5, 10
    - Color coding: green (1-3), yellow (4-7), red (8-10)
    - Description text changes based on value
  - [ ] 14.6 Add orchestrator node to palette
    - Add "Portfolio Orchestrator" to node types
    - Icon and description
    - Default configuration values
    - Drag-and-drop support
  - [ ] 14.7 Ensure orchestrator UI tests pass
    - Run ONLY the 2-8 tests written in 14.1
    - Verify node renders correctly
    - Verify config panel saves settings
    - Do NOT run entire test suite

**Acceptance Criteria**:
- The 2-8 tests written in 14.1 pass
- Orchestrator node appears in node palette
- Configuration panel with all position sizing rules
- Mode toggle (autonomous vs approval) works
- Risk tolerance slider functional
- Configuration persists when saved

---

### Task Group 15: Approval Workflow and Decision History
**Priority**: P0 (Critical Path)
**Dependencies**: Task Group 14
**Estimated Time**: 3-4 days
**Assignee**: frontend-engineer

- [ ] 15.0 Complete approval workflow and decision history
  - [ ] 15.1 Write 2-8 focused tests for approval workflow
    - Test approval modal rendering (1 test)
    - Test size adjustment slider (1 test)
    - Test approve action (2 tests)
    - Test reject action (1 test)
    - Test notification trigger (1 test)
    - Skip: Complex workflow tests, notification delivery tests
  - [ ] 15.2 Implement orchestrator executor logic
    - Create `orchestrator-executor.ts` in `lib/workflow/node-executors/`
    - Function: `executeOrchestratorNode(node, input, config)`
    - For each market in input:
      - Fetch current portfolio state from database
      - Call AI analysis: `analyzeOpportunity(market, portfolio, config.rules, signal)`
      - Validate position sizing rules
      - If mode = autonomous: Execute trade immediately (if GO)
      - If mode = approval: Create pending decision record, send notification
    - Return: Array of decisions made
  - [ ] 15.3 Build `approval-modal.tsx` component
    - Modal triggered by notification click
    - Display: Market question, current odds, direction (YES/NO)
    - AI reasoning (2-3 sentences)
    - Recommended size with risk score
    - Size adjustment slider (range: min_bet to max_bet)
    - Current portfolio state (total, deployed, available)
    - Buttons: [Approve] [Reject] [Adjust Size]
    - Loading state during approval/rejection
  - [ ] 15.4 Build `decision-history.tsx` component
    - Table showing past orchestrator decisions
    - Columns: Date, Market, Decision (GO/NO-GO), Size, Risk Score, Outcome
    - Filter by: status (approved/rejected/pending), date range
    - Pagination: 20 decisions per page
    - Click row to see full details (modal)
  - [ ] 15.5 Add notification system for pending approvals
    - High-priority notification when decision pending
    - Title: "Trade approval needed: [Market question]"
    - Message: "Recommended: BUY YES for $325 (risk: 6/10)"
    - Actions: [Approve] [Reject] [View Details]
    - Click notification opens approval modal
    - Use existing notification system (check codebase)
  - [ ] 15.6 Build `pending-decisions-badge.tsx` component
    - Red badge on orchestrator node showing pending count
    - Click badge to open pending decisions panel
    - Real-time update when decisions approved/rejected
  - [ ] 15.7 Add orchestrator decisions to strategy dashboard
    - New section: "Portfolio Orchestrator Decisions"
    - Show recent decisions (5 most recent)
    - Link to full decision history
    - Summary stats: Total decisions, approval rate, avg position size
  - [ ] 15.8 Ensure approval workflow tests pass
    - Run ONLY the 2-8 tests written in 15.1
    - Verify approval modal works
    - Verify approve/reject actions work
    - Verify notifications sent
    - Do NOT run entire test suite

**Acceptance Criteria**:
- The 2-8 tests written in 15.1 pass
- Orchestrator executor creates pending decisions in approval mode
- Approval modal displays market details and AI reasoning
- Size adjustment slider works
- Approve/reject actions update decision status
- Notifications sent for pending approvals
- Decision history shows all past decisions
- Dashboard displays orchestrator summary

---

## PHASE 4: Auto-Layout System (Week 6)

### Task Group 16: Dagre Layout Integration
**Priority**: P1 (High Priority)
**Dependencies**: Phase 3 complete
**Estimated Time**: 2-3 days
**Assignee**: frontend-engineer

- [ ] 16.0 Complete Dagre layout integration
  - [ ] 16.1 Write 2-6 focused tests for auto-layout
    - Test layout calculation (2 tests)
    - Test node positioning (1 test)
    - Test edge routing (1 test)
    - Skip: Performance tests, complex graph tests
  - [ ] 16.2 Install Dagre library
    - Run: `npm install @dagrejs/dagre` or `npm install dagre`
    - Add TypeScript types: `npm install -D @types/dagre`
    - Verify installation
  - [ ] 16.3 Create `dagre-layout.ts` in `lib/workflow/layout/`
    - Function: `calculateAutoLayout(nodes, edges, options)`
    - Initialize Dagre graph with options:
      - Direction: 'LR' (left-to-right) or 'TB' (top-to-bottom)
      - rankSeparation: 150px
      - nodeSeparation: 80px
      - edgeSeparation: 20px
    - Add nodes to graph with dimensions
    - Add edges to graph
    - Run Dagre layout algorithm
    - Return: Updated node positions `{ nodeId: { x, y } }`
  - [ ] 16.4 Implement hierarchical node ranking
    - Function: `calculateNodeDepth(nodes, edges)`
    - Assign depth based on position in workflow:
      - Depth 0: Source nodes (no incoming edges)
      - Depth 1: Nodes connected to depth 0
      - Depth N: Nodes connected to depth N-1
    - Use depth for Dagre ranking
  - [ ] 16.5 Integrate with ReactFlow
    - Update node positions in ReactFlow state
    - Animate transitions (optional, use ReactFlow's built-in animations)
    - Preserve edge routing
    - Test with sample workflow (5-10 nodes)
  - [ ] 16.6 Ensure auto-layout tests pass
    - Run ONLY the 2-6 tests written in 16.1
    - Verify layout positions calculated
    - Verify nodes positioned correctly
    - Do NOT run entire test suite

**Acceptance Criteria**:
- The 2-6 tests written in 16.1 pass
- Dagre library integrated successfully
- Auto-layout function calculates node positions
- Hierarchical ranking works (sources on left, actions on right)
- ReactFlow displays auto-laid-out workflow

---

### Task Group 17: Auto-Layout on AI Workflow Creation
**Priority**: P1 (High Priority)
**Dependencies**: Task Group 16
**Estimated Time**: 2 days
**Assignee**: frontend-engineer

- [ ] 17.0 Complete auto-layout on AI workflow creation
  - [ ] 17.1 Write 2-4 focused tests for AI auto-layout
    - Test auto-layout triggered after AI creates workflow (1 test)
    - Test layout hints parsing (1 test)
    - Skip: AI Copilot integration tests (covered elsewhere)
  - [ ] 17.2 Create `layout-hints.ts` in `lib/workflow/layout/`
    - Function: `parseLayoutHints(aiResponse)`
    - Extract layout hints from AI Copilot response
    - Expected format: `{ importance_ranking: {...}, groupings: [...] }`
    - Convert to Dagre-compatible node rankings
    - Fallback to default ranking if hints missing
  - [ ] 17.3 Integrate auto-layout with AI Copilot
    - Find existing AI Copilot workflow creation code
    - After nodes and edges created, call `calculateAutoLayout`
    - Apply layout hints if provided by AI
    - Update ReactFlow state with new positions
    - Show toast notification: "Auto-layout applied"
  - [ ] 17.4 Add layout toggle to AI responses
    - Option: "Auto-layout workflow" (default: ON)
    - User can disable auto-layout via settings
    - Persist preference in localStorage
  - [ ] 17.5 Ensure AI auto-layout tests pass
    - Run ONLY the 2-4 tests written in 17.1
    - Verify auto-layout triggered after AI creates workflow
    - Do NOT run entire test suite

**Acceptance Criteria**:
- The 2-4 tests written in 17.1 pass
- Auto-layout runs when AI Copilot creates workflow
- Layout hints from AI parsed and applied
- Toast notification confirms auto-layout
- User can disable auto-layout via settings

---

### Task Group 18: Manual Layout Tools and Persistence
**Priority**: P2 (Medium Priority)
**Dependencies**: Task Group 17
**Estimated Time**: 3 days
**Assignee**: frontend-engineer

- [ ] 18.0 Complete manual layout tools and persistence
  - [ ] 18.1 Write 2-6 focused tests for layout tools
    - Test re-layout button (1 test)
    - Test lock toggle (1 test)
    - Test grid snap (1 test)
    - Test alignment tools (1 test)
    - Skip: Complex multi-node selection tests
  - [ ] 18.2 Build `layout-toolbar.tsx` component
    - Toolbar in strategy builder header
    - Buttons: Re-layout, Lock/Unlock, Grid Snap, Align tools
    - Icons and tooltips for each button
    - Responsive: Hide some buttons on mobile
  - [ ] 18.3 Build `re-layout-button.tsx` component
    - Button: "Re-layout" with grid/organize icon
    - Tooltip: "Auto-organize workflow"
    - On click: Run `calculateAutoLayout` on current workflow
    - Confirm dialog if workflow has many nodes (10+)
    - Apply new positions with animation
  - [ ] 18.4 Build `lock-toggle.tsx` component
    - Toggle button: Padlock icon (locked/unlocked)
    - State: locked (default) / unlocked
    - Locked: Auto-layout disabled, manual positions persist
    - Unlocked: Auto-layout can run
    - Persist lock state per workflow in database
  - [ ] 18.5 Build `alignment-tools.tsx` component
    - Buttons: Align Left, Align Right, Align Top, Align Bottom
    - Buttons: Distribute Horizontally, Distribute Vertically
    - Operate on selected nodes (ReactFlow multi-select)
    - Update node positions in ReactFlow state
    - Disable when no nodes selected
  - [ ] 18.6 Build `grid-snap-toggle.tsx` component
    - Checkbox: "Snap to grid"
    - Grid size: 20px (configurable)
    - When enabled: Node positions snap to grid during drag
    - Visual grid overlay (faint dots) when enabled
    - Use ReactFlow's snapToGrid feature
  - [ ] 18.7 Create `layout-persistence.ts` in `lib/workflow/layout/`
    - Function: `saveLayoutState(workflowId, positions, lockState)`
    - Store in `workflow_sessions.workflow_data` JSONB
    - Function: `loadLayoutState(workflowId)`
    - Restore node positions and lock state on workflow load
  - [ ] 18.8 Ensure layout tools tests pass
    - Run ONLY the 2-6 tests written in 18.1
    - Verify re-layout button works
    - Verify lock toggle persists
    - Verify grid snap works
    - Do NOT run entire test suite

**Acceptance Criteria**:
- The 2-6 tests written in 18.1 pass
- Layout toolbar with all tools displayed
- Re-layout button reorganizes workflow
- Lock toggle prevents auto-layout
- Alignment tools work on selected nodes
- Grid snap helps with manual positioning
- Layout state persists per workflow

---

## PHASE 5: Testing & Integration (End of Week 6)

### Task Group 19: Integration Testing and Gap Analysis
**Priority**: P0 (Critical Path)
**Dependencies**: All previous task groups
**Estimated Time**: 2-3 days
**Assignee**: quality-engineer

- [ ] 19.0 Review existing tests and fill critical gaps only
  - [ ] 19.1 Review tests from Task Groups 1-18
    - Tally total tests written:
      - Phase 1: ~35-50 tests (7 task groups × 2-8 tests)
      - Phase 2: ~15-25 tests (4 task groups × 2-8 tests)
      - Phase 3: ~20-35 tests (4 task groups × 2-8 tests)
      - Phase 4: ~10-20 tests (3 task groups × 2-6 tests)
      - Total: ~80-130 tests
    - Review test coverage for THIS feature only
    - Identify critical user workflows lacking coverage
  - [ ] 19.2 Analyze test coverage gaps
    - Focus ONLY on gaps related to Strategy Builder Enhancements
    - Prioritize end-to-end workflows:
      - Create enhanced filter → Execute → Debug results
      - Create orchestrator → Receive approval → Execute trade
      - AI creates workflow → Auto-layout → Manual adjust
    - Do NOT assess entire application test coverage
    - Do NOT test edge cases unless business-critical
  - [ ] 19.3 Write up to 10 additional strategic tests maximum
    - End-to-end: Enhanced filter with category/tag filters (2 tests)
    - End-to-end: Data flow panel item tracing (2 tests)
    - End-to-end: Orchestrator approval workflow (2 tests)
    - End-to-end: Auto-layout and manual re-layout (2 tests)
    - Integration: Filter executor with trace capture (1 test)
    - Integration: Orchestrator with AI analysis (1 test)
    - Total: ~10 additional tests MAX
  - [ ] 19.4 Run feature-specific tests only
    - Run tests for Task Groups 1-18 (80-130 tests)
    - Run additional tests from 19.3 (~10 tests)
    - Total expected: ~90-140 tests
    - Fix any failing tests
    - Do NOT run entire application test suite

**Acceptance Criteria**:
- All feature-specific tests pass (~90-140 tests total)
- Critical end-to-end user workflows covered
- No more than 10 additional tests added in this phase
- All four major features work together seamlessly
- No regressions in existing Strategy Builder functionality

---

## PHASE 6: Documentation and Deployment

### Task Group 20: Documentation and Release
**Priority**: P1 (High Priority)
**Dependencies**: Task Group 19
**Estimated Time**: 1-2 days
**Assignee**: technical-writer / general-purpose

- [ ] 20.0 Complete documentation and release
  - [ ] 20.1 Update user documentation
    - Add section: "Enhanced Filter Node" with screenshots
    - Add section: "Debugging Data Flow" with examples
    - Add section: "Portfolio Orchestrator" with configuration guide
    - Add section: "Auto-Layout Tools" with tips
    - Update existing Strategy Builder docs with new features
  - [ ] 20.2 Create technical documentation
    - Document new API endpoints (orchestrator, trace)
    - Document database schema changes (migrations)
    - Document AI analysis prompt and response format
    - Document layout algorithm configuration
    - Add to existing developer docs
  - [ ] 20.3 Create release notes
    - Feature highlights with screenshots
    - Breaking changes (if any)
    - Migration guide for existing workflows
    - Known limitations and future roadmap
  - [ ] 20.4 Perform final manual testing
    - Test all four features on staging environment
    - Verify performance with large datasets (1000+ items)
    - Verify mobile/tablet responsive design
    - Verify cross-browser compatibility (Chrome, Safari, Firefox)
  - [ ] 20.5 Deploy to production
    - Run database migrations on production
    - Deploy code changes
    - Monitor for errors (Sentry, logs)
    - Verify features work in production

**Acceptance Criteria**:
- User documentation updated with all new features
- Technical documentation complete
- Release notes published
- All features work in production
- No critical bugs in first 24 hours post-deployment

---

## Execution Order and Dependencies

### Recommended Implementation Sequence

**Week 1-2: Phase 1 - Enhanced Filter Node**
1. Task Group 1: Multi-Condition Filter Foundation (3-4 days)
2. Task Group 2: Field Discovery System (2-3 days)
3. Task Group 3: Smart Operators and Value Inputs (2-3 days)
4. Task Groups 4-5: Category/Tag/Text Filters (2-3 days, can parallelize)
5. Task Group 6: Filter Executor Logic (3-4 days)
6. Task Group 7: Filter Node UI Integration (2-3 days)

**Week 3: Phase 2 - Data Flow Visualization**
1. Task Group 8: Data Trace Capture System (3-4 days)
2. Task Group 9: Debug Panel UI Layout (2-3 days, can parallelize with 10)
3. Task Group 10: Node List and Detail Views (3-4 days)
4. Task Group 11: Item Tracing and Export (2-3 days)

**Week 4-5: Phase 3 - Portfolio Orchestrator**
1. Task Group 12: Orchestrator Database and API Foundation (3-4 days)
2. Task Group 13: AI Risk Analysis Engine (3-4 days, can parallelize with 14)
3. Task Group 14: Orchestrator Node UI and Configuration (3-4 days)
4. Task Group 15: Approval Workflow and Decision History (3-4 days)

**Week 6: Phase 4 - Auto-Layout System**
1. Task Group 16: Dagre Layout Integration (2-3 days)
2. Task Group 17: Auto-Layout on AI Workflow Creation (2 days, can parallelize with 18)
3. Task Group 18: Manual Layout Tools and Persistence (3 days)
4. Task Group 19: Integration Testing and Gap Analysis (2-3 days)
5. Task Group 20: Documentation and Release (1-2 days)

---

## Testing Summary

### Test Distribution by Phase

**Phase 1 Tests**: ~35-50 tests
- Task Group 1: 2-8 tests (multi-condition builder)
- Task Group 2: 2-8 tests (field discovery)
- Task Group 3: 2-8 tests (operators/values)
- Task Group 4: 2-6 tests (category/tag filters)
- Task Group 5: 2-4 tests (text search)
- Task Group 6: 2-8 tests (filter executor)
- Task Group 7: 2-6 tests (UI integration)

**Phase 2 Tests**: ~15-25 tests
- Task Group 8: 2-8 tests (trace capture)
- Task Group 9: 2-6 tests (debug panel layout)
- Task Group 10: 2-8 tests (node list/detail views)
- Task Group 11: 2-6 tests (item tracing)

**Phase 3 Tests**: ~20-35 tests
- Task Group 12: 2-8 tests (orchestrator APIs)
- Task Group 13: 2-6 tests (AI analysis)
- Task Group 14: 2-8 tests (orchestrator UI)
- Task Group 15: 2-8 tests (approval workflow)

**Phase 4 Tests**: ~10-20 tests
- Task Group 16: 2-6 tests (Dagre layout)
- Task Group 17: 2-4 tests (AI auto-layout)
- Task Group 18: 2-6 tests (manual tools)

**Integration Tests**: ~10 additional tests
- Task Group 19: Maximum 10 strategic tests for critical gaps

**Total Expected Tests**: ~90-140 tests (highly focused, minimal coverage)

---

## Parallelization Opportunities

### Tasks That Can Run in Parallel

**Phase 1**:
- Task Groups 4 and 5 (Category/Tag filters and Text Search) can run in parallel after Task Group 3 completes
- Frontend (Task Groups 1-5, 7) and Backend (Task Group 6) can have some overlap

**Phase 2**:
- Task Groups 9 and 10 can partially overlap (UI layout and data views)

**Phase 3**:
- Task Groups 13 and 14 can run in parallel (AI engine and UI)

**Phase 4**:
- Task Groups 17 and 18 can partially overlap (AI auto-layout and manual tools)

---

## Risk Mitigation

### High-Risk Areas

**Risk 1: Performance with Large Data Snapshots**
- Mitigation: 1000-item limit enforced in Task Group 8
- Testing: Load test with 1000+ markets in Task Group 19

**Risk 2: AI Analysis Latency**
- Mitigation: Loading states in Task Group 15, streaming responses
- Testing: Test with slow network in Task Group 13

**Risk 3: Complex Filter Logic Bugs**
- Mitigation: Comprehensive executor tests in Task Group 6
- Testing: Real-world filter scenarios in Task Group 19

**Risk 4: Layout Algorithm Complexity**
- Mitigation: Use battle-tested Dagre library in Task Group 16
- Testing: Test with various workflow sizes (3-20 nodes)

---

## Definition of Done

Each task group is considered DONE when:

1. **All sub-tasks completed**: Checkboxes checked for all items in task group
2. **Tests written and passing**: 2-8 focused tests per group (as specified)
3. **Code reviewed**: At least one peer review (if team-based)
4. **Acceptance criteria met**: All criteria at bottom of task group satisfied
5. **No regressions**: Existing features still work
6. **Documentation updated**: Inline code comments, README if needed

---

## Notes for Implementers

### General Guidelines

- **Follow existing patterns**: Reference existing components in `/components/strategy-builder/`, executor in `/lib/workflow/executor.ts`
- **Minimal testing approach**: 2-8 tests per task group, focused on critical behaviors only
- **Tech stack**: Next.js, React, TypeScript, Tailwind CSS, Supabase, ReactFlow, Claude API
- **Responsive design**: Mobile-first, test on mobile/tablet/desktop
- **Accessibility**: Use semantic HTML, ARIA labels where appropriate
- **Error handling**: User-friendly error messages, graceful degradation
- **Performance**: Lazy load components, paginate large datasets, optimize re-renders

### Code Quality Standards

- **TypeScript strict mode**: All code must type-check
- **ESLint/Prettier**: Format code before committing
- **Component size**: Keep components under 300 lines (split if larger)
- **Function complexity**: Keep functions focused, single responsibility
- **Comments**: Document complex logic, AI prompts, algorithms
- **Naming**: Clear, descriptive names (no single-letter variables)

### Testing Standards

- **Test behavior, not implementation**: Focus on what code does, not how
- **Clear test names**: `it('should filter markets by category when category filter applied')`
- **Mock external dependencies**: Mock AI API, database, file system
- **Fast execution**: Unit tests should run in milliseconds
- **No flaky tests**: Ensure tests pass consistently

---

**Status**: Ready for Implementation
**Total Task Groups**: 20
**Total Estimated Time**: 6 weeks
**Next Step**: Assign task groups to engineers and begin Phase 1
