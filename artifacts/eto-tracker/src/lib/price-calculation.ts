export type ReviewCost = { value?: string | null; currency?: string | null };
export type SalesPriceSuggestion = { salesPrice: string; currency: string; multiCurrency: boolean };
type Decimal = { numerator: bigint; denominator: bigint };

function parseDecimal(value: string | null | undefined): Decimal | null {
  if (!value?.trim() || value.length > 512 || !Number.isFinite(Number(value))) return null;
  const match = value.trim().match(/^\+?(\d+(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?$/i);
  if (!match) return null;
  const [whole, fraction = ""] = match[1].split(".");
  const exponent = Number(match[2] ?? 0);
  if (Math.abs(exponent) > 308) return null;
  const scale = fraction.length - exponent;
  const digits = BigInt(`${whole}${fraction}`);
  return scale >= 0
    ? { numerator: digits, denominator: 10n ** BigInt(scale) }
    : { numerator: digits * 10n ** BigInt(-scale), denominator: 1n };
}

function add(a: Decimal, b: Decimal): Decimal {
  return {
    numerator: a.numerator * b.denominator + b.numerator * a.denominator,
    denominator: a.denominator * b.denominator,
  };
}

function percentageOf(amount: Decimal, percentage: Decimal): Decimal {
  return {
    numerator: amount.numerator * percentage.numerator,
    denominator: amount.denominator * percentage.denominator * 100n,
  };
}

// Half-up rounding in integer arithmetic avoids floating-point rounding errors.
function wholeAmount(amount: Decimal): bigint {
  return (amount.numerator * 2n + amount.denominator) / (amount.denominator * 2n);
}

export function roundMoneyAmount(value: string | null | undefined): string | null {
  const amount = parseDecimal(value);
  return amount ? String(wholeAmount(amount)) : null;
}

export function calculatePrice(
  costs: readonly [ReviewCost, ReviewCost, ReviewCost],
  contingencyPercent: string,
  marginPercent: string,
) {
  const amounts = costs.map((cost) => parseDecimal(cost.value));
  const contingency = parseDecimal(contingencyPercent);
  const margin = parseDecimal(marginPercent);
  if (amounts.some((amount) => !amount) || !contingency || !margin ||
    contingency.numerator > contingency.denominator * 100n ||
    margin.numerator > margin.denominator * 100n) return null;

  const base = amounts.reduce<Decimal>(
    (sum, amount) => add(sum, { numerator: wholeAmount(amount!), denominator: 1n }),
    { numerator: 0n, denominator: 1n },
  );
  const contingencyAmount = wholeAmount(percentageOf(base, contingency));
  const subtotal = add(base, { numerator: contingencyAmount, denominator: 1n });
  const marginAmount = wholeAmount(percentageOf(subtotal, margin));
  const salesAmount = wholeAmount(add(subtotal, { numerator: marginAmount, denominator: 1n }));
  const currencies = costs.map((cost) => cost.currency?.trim().toUpperCase() || "USD");
  const multiCurrency = new Set(currencies).size > 1;

  return {
    contingencyCost: String(contingencyAmount),
    marginCost: String(marginAmount),
    salesPrice: String(salesAmount),
    currency: multiCurrency ? "Multi-Currency" : currencies[0],
    multiCurrency,
  };
}