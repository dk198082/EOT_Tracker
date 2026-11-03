export type ReviewLeadTime = {
  value?: string | null;
  loading?: boolean;
  error?: boolean;
};

export type ReviewLeadTimes = {
  design: ReviewLeadTime;
  procurement: ReviewLeadTime;
  assembly: ReviewLeadTime;
};

function decimalWeeks(input: string | null | undefined) {
  if (!input?.trim()) return null;
  const value = input.trim();
  if (!Number.isFinite(Number(value)) || Number(value) < 0) return null;
  const match = /^\+?(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i.exec(value);
  if (!match) return null;
  const fraction = match[2] ?? match[3] ?? "";
  const exponent = Number(match[4] ?? 0);
  if (Math.abs(exponent) > 308 || fraction.length > 308) return null;
  const scale = fraction.length - exponent;
  const digits = BigInt(`${match[1] ?? "0"}${fraction}`);
  return scale >= 0
    ? { digits, scale }
    : { digits: digits * 10n ** BigInt(-scale), scale: 0 };
}

/** Sum saved week-based snapshots, not raw design/assembly hours or current formulas. */
export function calculateLeadTime(times: ReviewLeadTimes) {
  const inputs = [times.design, times.procurement, times.assembly];
  if (inputs.some((time) => time.loading || time.error)) return null;
  const values = inputs.map((time) => decimalWeeks(time.value));
  if (values.some((value) => value === null)) return null;
  const recorded = values.filter((value) => value !== null);
  const scale = Math.max(...recorded.map((value) => value.scale));
  const denominator = 10n ** BigInt(scale);
  const sum = recorded.reduce(
    (total, value) => total + value.digits * 10n ** BigInt(scale - value.scale), 0n,
  );
  const whole = sum / denominator;
  const fraction = scale
    ? String(sum % denominator).padStart(scale, "0").replace(/0+$/, "")
    : "";
  return {
    totalWeeks: fraction ? `${whole}.${fraction}` : String(whole),
    // Exact decimal arithmetic avoids rounding 0.1 + 0.2 + 0.7 up to 2.
    roundedWeeks: String((sum + denominator - 1n) / denominator),
  };
}
