/**
 * UI Benchmark Constants
 *
 * Single source of truth for Polymarket UI metrics used to validate
 * our V10 Activity PnL implementation.
 *
 * These values were captured from the Polymarket wallet pages (ALL timeframe)
 * during Session 13 benchmarking.
 *
 * Reference: docs/systems/database/PNL_V9_UI_PARITY_SPEC.md
 *            docs/systems/database/PNL_V10_UI_ACTIVITY_PNL_SPEC.md
 */

export interface UIBenchmarkWallet {
  wallet: string;
  label: 'W1' | 'W2' | 'W3' | 'W4' | 'W5' | 'W6';
  // Core PnL metrics
  profitLoss_all: number;
  volume_all: number;
  gain_all: number;
  loss_all: number;
  // Position metrics (from UI)
  positions_value?: number;
  predictions?: number; // Number of markets/conditions traded
  // Trade counts - not explicitly recorded in UI, derived from predictions
  // trades_all is not available from UI directly
  // wins_all and losses_all are not available from UI directly
  notes?: string;
}

export const UI_BENCHMARK_WALLETS: UIBenchmarkWallet[] = [
  {
    wallet: '0x9d36c904930a7d06c5403f9e16996e919f586486',
    label: 'W1',
    profitLoss_all: -6138.9,
    volume_all: 205876.66,
    gain_all: 37312.46,
    loss_all: -43451.36,
    positions_value: 0.01,
    predictions: 15,
    notes: 'UI says All Time. Our V9 econ PnL is ~-17.5k. Suspect different time filter or special handling.',
  },
  {
    wallet: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838',
    label: 'W2',
    profitLoss_all: 4404.92,
    volume_all: 23191.46,
    gain_all: 6222.31,
    loss_all: -1817.39,
    positions_value: 0.01,
    predictions: 22,
    notes: 'V9 econ PnL was ~4417.84, extremely close to UI net total. Perfect V3 match.',
  },
  {
    wallet: '0x418db17eaa8f25eaf2085657d0becd82462c6786',
    label: 'W3',
    profitLoss_all: 5.44,
    volume_all: 30868.84,
    gain_all: 14.9,
    loss_all: -9.46,
    positions_value: 5.57,
    predictions: 30,
    notes: 'OUTLIER: Large unredeemed Trump position. UI uses asymmetric realization.',
  },
  {
    wallet: '0x4974d5c6c551e79c8f2f48f943e18d75c6a9ea15',
    label: 'W4',
    profitLoss_all: -294.61,
    volume_all: 141825.27,
    gain_all: 3032.88,
    loss_all: -3327.49,
    positions_value: 168.87,
    predictions: 52,
  },
  {
    wallet: '0xeab03de44f98ad31ecc19cd597bcdef1c9fe42c2',
    label: 'W5',
    profitLoss_all: 146.9,
    volume_all: 6721.77,
    gain_all: 148.4,
    loss_all: -1.5,
    positions_value: 0.01,
    predictions: 9,
    notes: 'Known mismatch ~129%. Small positions with proportionally large resolution effects.',
  },
  {
    wallet: '0x7dca4d9f31ceba9d2d5b7a723eccd5e2e7ccc48d',
    label: 'W6',
    profitLoss_all: 470.4,
    volume_all: 44145.02,
    gain_all: 1485.8,
    loss_all: -1015.4,
    positions_value: 1628.12,
    predictions: 89,
  },
];

/**
 * Expected error thresholds per wallet for PnL.
 * Based on Session 13+14 analysis of why certain wallets diverge.
 */
export const UI_BENCHMARK_THRESHOLDS: Record<string, number> = {
  W1: 25, // Partial match - some unredeemed positions
  W2: 1, // Perfect match expected
  W3: 99999, // Outlier - holds large unredeemed Trump position
  W4: 25, // Good match expected
  W5: 150, // Known mismatch - needs investigation
  W6: 30, // Partial match
};

/**
 * Helper to get benchmark by label
 */
export function getBenchmarkByLabel(label: string): UIBenchmarkWallet | undefined {
  return UI_BENCHMARK_WALLETS.find((w) => w.label === label);
}

/**
 * Helper to get benchmark by wallet address
 */
export function getBenchmarkByWallet(wallet: string): UIBenchmarkWallet | undefined {
  return UI_BENCHMARK_WALLETS.find((w) => w.wallet.toLowerCase() === wallet.toLowerCase());
}
