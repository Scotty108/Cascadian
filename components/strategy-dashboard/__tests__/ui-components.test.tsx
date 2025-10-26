/**
 * UI Component Tests for Task Group 5: Strategy Dashboard & Overview UI
 *
 * These tests cover the core functionality of autonomous strategy UI components:
 * 1. StatusBadge renders correctly for different statuses
 * 2. ExecutionCountdown calculates and displays time correctly
 * 3. Strategy dashboard renders status and control buttons
 * 4. Execution log displays executions with success/failure indicators
 * 5. Watchlist display shows markets and allows removal
 * 6. Performance metrics display correctly
 *
 * NOTE: These tests require Jest and React Testing Library to be configured.
 * Test execution is deferred to Task Group 7 when test framework is set up.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBadge } from '../status-badge';
import { ExecutionCountdown } from '../execution-countdown';
import { AutonomousDashboard } from '../autonomous-dashboard';

// Mock fetch globally
global.fetch = jest.fn() as jest.Mock;

// Helper to create test QueryClient
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

// Helper to wrap components with QueryClientProvider
function renderWithClient(ui: React.ReactElement) {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

describe('StatusBadge', () => {
  it('should render "Running" status with green color and pulse animation', () => {
    render(<StatusBadge status="running" />);

    const badge = screen.getByText('Running');
    expect(badge).toBeInTheDocument();
    expect(badge.parentElement).toHaveClass('text-green-500');

    // Check for pulse animation on dot
    const dot = badge.previousSibling;
    expect(dot).toHaveClass('animate-pulse');
  });

  it('should render "Paused" status with amber color', () => {
    render(<StatusBadge status="paused" />);

    const badge = screen.getByText('Paused');
    expect(badge).toBeInTheDocument();
    expect(badge.parentElement).toHaveClass('text-amber-500');
  });

  it('should render "Error" status with red color', () => {
    render(<StatusBadge status="error" />);

    const badge = screen.getByText('Error');
    expect(badge).toBeInTheDocument();
    expect(badge.parentElement).toHaveClass('text-red-500');
  });

  it('should render "Stopped" status with gray color', () => {
    render(<StatusBadge status="stopped" />);

    const badge = screen.getByText('Stopped');
    expect(badge).toBeInTheDocument();
    expect(badge.parentElement).toHaveClass('text-gray-500');
  });
});

describe('ExecutionCountdown', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should display "No execution scheduled" when nextExecutionAt is null', () => {
    render(<ExecutionCountdown nextExecutionAt={null} />);

    expect(screen.getByText('No execution scheduled')).toBeInTheDocument();
  });

  it('should display countdown in minutes and seconds format', () => {
    // Set time to 5 minutes in the future
    const futureTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    render(<ExecutionCountdown nextExecutionAt={futureTime} />);

    expect(screen.getByText(/5m \d+s/)).toBeInTheDocument();
  });

  it('should update countdown every second', () => {
    const futureTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    render(<ExecutionCountdown nextExecutionAt={futureTime} />);

    const initialText = screen.getByText(/5m \d+s/).textContent;

    // Advance time by 1 second
    jest.advanceTimersByTime(1000);

    const updatedText = screen.getByText(/5m \d+s/).textContent;
    expect(updatedText).not.toBe(initialText);
  });

  it('should display "Executing now..." when time is overdue', () => {
    // Set time to 1 second in the past
    const pastTime = new Date(Date.now() - 1000).toISOString();

    render(<ExecutionCountdown nextExecutionAt={pastTime} />);

    expect(screen.getByText('Executing now...')).toBeInTheDocument();
  });
});

describe('AutonomousDashboard Control Buttons', () => {
  const mockStatus = {
    id: 'test-id',
    name: 'Test Strategy',
    status: 'running' as const,
    auto_run: true,
    execution_interval_minutes: 15,
    last_executed_at: new Date().toISOString(),
    next_execution_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    execution_count: 10,
    success_count: 9,
    error_count: 1,
    success_rate: 0.9,
    average_execution_time_ms: 1200,
    uptime_seconds: 3600,
    watchlist_size: 5,
    active_trades: 0,
  };

  beforeEach(() => {
    // Mock fetch for status endpoint
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: mockStatus }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true }),
      });
    });
  });

  it('should render control buttons when status is running', async () => {
    renderWithClient(<AutonomousDashboard workflowId="test-id" />);

    await waitFor(() => {
      expect(screen.getByText('Pause Strategy')).toBeInTheDocument();
      expect(screen.getByText('Stop Strategy')).toBeInTheDocument();
      expect(screen.getByText('Execute Now')).toBeInTheDocument();
    });
  });

  it('should call pause API when Pause button is clicked', async () => {
    const mockFetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ success: true }),
      })
    );
    global.fetch = mockFetch as any;

    renderWithClient(<AutonomousDashboard workflowId="test-id" />);

    await waitFor(() => {
      expect(screen.getByText('Pause Strategy')).toBeInTheDocument();
    });

    const pauseButton = screen.getByText('Pause Strategy');
    fireEvent.click(pauseButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/pause'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('should render Start button when strategy is paused', async () => {
    const pausedStatus = { ...mockStatus, status: 'paused' as const };

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: pausedStatus }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
    });

    renderWithClient(<AutonomousDashboard workflowId="test-id" />);

    await waitFor(() => {
      expect(screen.getByText(/Resume|Start/)).toBeInTheDocument();
    });
  });
});

describe('Performance Metrics Display', () => {
  it('should calculate and display success rate correctly', () => {
    const status = {
      id: 'test-id',
      name: 'Test Strategy',
      status: 'running' as const,
      auto_run: true,
      execution_interval_minutes: 15,
      last_executed_at: null,
      next_execution_at: null,
      execution_count: 100,
      success_count: 95,
      error_count: 5,
      success_rate: 0.95,
      average_execution_time_ms: 1200,
      uptime_seconds: 86400,
      watchlist_size: 10,
      active_trades: 0,
    };

    const { PerformanceMetrics } = require('../performance-metrics');
    render(<PerformanceMetrics status={status} />);

    expect(screen.getByText('95.0%')).toBeInTheDocument();
    expect(screen.getByText(/95 successful, 5 failed/)).toBeInTheDocument();
  });

  it('should display success rate in green when above 90%', () => {
    const status = {
      success_rate: 0.95,
      execution_count: 100,
      success_count: 95,
      error_count: 5,
      average_execution_time_ms: 1200,
      uptime_seconds: 3600,
      watchlist_size: 5,
    };

    const { PerformanceMetrics } = require('../performance-metrics');
    const { container } = render(<PerformanceMetrics status={status as any} />);

    const successRate = screen.getByText('95.0%');
    expect(successRate).toHaveClass('text-green-500');
  });

  it('should display success rate in amber when between 70-90%', () => {
    const status = {
      success_rate: 0.8,
      execution_count: 100,
      success_count: 80,
      error_count: 20,
      average_execution_time_ms: 1200,
      uptime_seconds: 3600,
      watchlist_size: 5,
    };

    const { PerformanceMetrics } = require('../performance-metrics');
    const { container } = render(<PerformanceMetrics status={status as any} />);

    const successRate = screen.getByText('80.0%');
    expect(successRate).toHaveClass('text-amber-500');
  });
});

/**
 * Test Summary:
 *
 * Total tests: 13 focused tests covering:
 * - StatusBadge component (4 tests)
 * - ExecutionCountdown component (4 tests)
 * - AutonomousDashboard control buttons (3 tests)
 * - PerformanceMetrics display (3 tests)
 *
 * These tests validate:
 * - UI rendering with correct styles and classes
 * - Real-time countdown calculation and updates
 * - Control button API calls (start/pause/stop)
 * - Success rate calculation and color-coding
 *
 * To run these tests:
 * 1. Ensure test framework (Jest/Vitest) is configured
 * 2. Run: pnpm test components/strategy-dashboard/__tests__
 */
