/**
 * Debug script to figure out the correct P&L formula
 */

interface TestData {
  name: string;
  settlement: number;
  signed_cashflow: number;
  expected_pnl: number;
}

const tests: TestData[] = [
  {
    name: "Test 1: Long Win",
    settlement: 10.0,
    signed_cashflow: -4.15,
    expected_pnl: 14.15,
  },
  {
    name: "Test 2: Long Loss",
    settlement: 0.0,
    signed_cashflow: -6.15,
    expected_pnl: -6.15,
  },
  {
    name: "Test 3: Short Win",
    settlement: 10.0,
    signed_cashflow: 2.85,
    expected_pnl: 12.85,
  },
  {
    name: "Test 4: Short Loss",
    settlement: 0.0,
    signed_cashflow: 6.85,
    expected_pnl: -7.15,
  },
];

console.log("Testing PnL formulas:\n");

tests.forEach((test) => {
  const formula_A = test.settlement - test.signed_cashflow; // subtraction
  const formula_B = test.settlement + test.signed_cashflow; // addition

  const match_A = Math.abs(formula_A - test.expected_pnl) < 0.01;
  const match_B = Math.abs(formula_B - test.expected_pnl) < 0.01;

  console.log(`${test.name}:`);
  console.log(`  Settlement:       ${test.settlement}`);
  console.log(`  Signed Cashflow:  ${test.signed_cashflow}`);
  console.log(`  Expected P&L:     ${test.expected_pnl}`);
  console.log(
    `  Formula A (settle - cash): ${formula_A.toFixed(2)} ${match_A ? "✓" : "✗"}`
  );
  console.log(
    `  Formula B (settle + cash): ${formula_B.toFixed(2)} ${match_B ? "✗" : "✗"}`
  );
  console.log();
});

// Try to find a pattern
console.log("\nPattern analysis:");
console.log("Looking for a formula that works for all tests...\n");

// Test various formulas
const formulas = [
  {
    name: "settlement - cashflow",
    calc: (s: number, c: number) => s - c,
  },
  {
    name: "settlement + cashflow",
    calc: (s: number, c: number) => s + c,
  },
  {
    name: "settlement - abs(cashflow)",
    calc: (s: number, c: number) => s - Math.abs(c),
  },
  {
    name: "settlement + abs(cashflow) * sign",
    calc: (s: number, c: number) => s + Math.abs(c) * Math.sign(c),
  },
];

formulas.forEach((formula) => {
  const results = tests.map((test) => {
    const calculated = formula.calc(test.settlement, test.signed_cashflow);
    const match = Math.abs(calculated - test.expected_pnl) < 0.01;
    return { calculated, match };
  });

  const all_match = results.every((r) => r.match);
  console.log(`${formula.name}: ${all_match ? "ALL PASS ✓" : "FAIL ✗"}`);

  if (!all_match) {
    results.forEach((r, i) => {
      if (!r.match) {
        console.log(
          `  Test ${i + 1}: Expected ${tests[i].expected_pnl}, got ${r.calculated.toFixed(2)}`
        );
      }
    });
  }
});

// Special case: maybe cashflow calculation is wrong for shorts?
console.log("\n\nAlternative: What if SHORT cashflow is calculated differently?");
console.log("What if SELL creates a CREDIT (positive) equal to proceeds,");
console.log("but also creates a LIABILITY equal to (1.0 - price) * shares?");
console.log("\nFor Test 3 (Short Win):");
console.log("  SELL 10 @ 0.30:");
console.log("    Credit: +3.00");
console.log("    Liability: -(1.0 - 0.30) * 10 = -7.00");
console.log("    Net cashflow: 3.00 - 7.00 - 0.15 = -4.15");
console.log("    Settlement (win): +10.00");
console.log("    P&L: 10.00 - (-4.15) = 14.15 ... expected 12.85 ✗");
console.log("\nFor Test 4 (Short Loss):");
console.log("  SELL 10 @ 0.70:");
console.log("    Credit: +7.00");
console.log("    Liability: -(1.0 - 0.70) * 10 = -3.00");
console.log("    Net cashflow: 7.00 - 3.00 - 0.15 = 3.85");
console.log("    Settlement (loss): 0.00");
console.log("    P&L: 0.00 - 3.85 = -3.85 ... expected -7.15 ✗");
