export function isWholeMoney(value: unknown, optional = false): boolean {
  if (value === undefined || value === null || value === "") return optional;
  if (typeof value === "string" && !value.trim()) return optional;
  return typeof value === "string" && /^\d+$/.test(value.trim());
}

export function isWholeBudget(value: unknown): boolean {
  return value === undefined || value === null || value === "" ||
    (typeof value === "string" && !value.trim()) ||
    (typeof value === "string" && /^\d+(?:,\d{3})*(?:\s*[-–]\s*\d+(?:,\d{3})*)?$/.test(value.trim()));
}

export function calculateWholeCost(hours: string, rate: string): string {
  function decimal(value: string) {
    let text = value.trim();
    if (!/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) text = String(Number(text));
    const match = /^\+?(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
    if (!match || !Number.isFinite(Number(text))) throw new RangeError("Invalid monetary calculation input");
    const scale = (match[2]?.length ?? 0) - Number(match[3] ?? 0);
    const digits = BigInt(`${match[1] || "0"}${match[2] ?? ""}`);
    return scale >= 0
      ? { numerator: digits, denominator: 10n ** BigInt(scale) }
      : { numerator: digits * 10n ** BigInt(-scale), denominator: 1n };
  }
  const time = decimal(hours);
  const hourly = decimal(rate);
  const numerator = time.numerator * hourly.numerator;
  const denominator = time.denominator * hourly.denominator;
  return String((numerator * 2n + denominator) / (denominator * 2n));
}