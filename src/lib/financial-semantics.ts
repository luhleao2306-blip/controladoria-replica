export type FinancialDirection = "higher" | "lower";

// Color follows the displayed sign, including ordinary amounts and drilldowns.
export function financialAmountClass(value: number | null | undefined, _kind: "amount" | "result" = "amount") {
  if (value == null || !Number.isFinite(value) || value === 0) return "text-muted-foreground";
  return value < 0 ? "text-destructive" : "text-success";
}

export function financialOutcome(value: number | null | undefined, direction: FinancialDirection = "higher") {
  if (value == null || !Number.isFinite(value) || value === 0) return "neutral";
  return (direction === "lower" ? -value : value) > 0 ? "positive" : "critical";
}

export function financialClass(value: number | null | undefined, direction: FinancialDirection = "higher") {
  const outcome = financialOutcome(value, direction);
  return outcome === "positive" ? "text-success" : outcome === "critical" ? "text-destructive" : "text-muted-foreground";
}

export function financialColor(value: number, direction: FinancialDirection = "higher") {
  const outcome = financialOutcome(value, direction);
  return outcome === "positive" ? "var(--success)" : outcome === "critical" ? "var(--destructive)" : "var(--muted-foreground)";
}
