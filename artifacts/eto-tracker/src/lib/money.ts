import { roundMoneyAmount } from "./price-calculation";

export const CURRENCY_SYMBOLS: Record<string, string> = { USD: "$", GBP: "£", EUR: "€", CNY: "¥" };
const integerFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function moneyInputValue(value: string | null | undefined): string {
  if (!value?.trim()) return "";
  return roundMoneyAmount(value.replaceAll(",", "")) ??
    value.replace(/\d[\d,]*(?:\.\d+)?/g, (amount) =>
      roundMoneyAmount(amount.replaceAll(",", "")) ?? amount);
}

export function formatMoney(value: string | null | undefined, currency = "USD"): string {
  if (!value?.trim()) return "Not recorded";
  const whole = roundMoneyAmount(value.replaceAll(",", ""));
  const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  if (whole !== null) return `${symbol}${integerFormatter.format(BigInt(whole))}`;
  // Preserve legacy ranges/text rather than inventing a numeric amount.
  const text = value.replace(/\d[\d,]*(?:\.\d+)?/g, (amount) => {
    const rounded = roundMoneyAmount(amount.replaceAll(",", ""));
    return rounded === null ? amount : integerFormatter.format(BigInt(rounded));
  });
  return `${symbol}${text.replace(/^[£€¥$]\s*/, "")}`;
}

export function isWholeMoney(value: string | null | undefined, optional = false): boolean {
  return !value?.trim() ? optional : /^\d+$/.test(value.trim());
}

export function isWholeBudget(value: string | null | undefined): boolean {
  return !value?.trim() || /^\d+(?:,\d{3})*(?:\s*[-–]\s*\d+(?:,\d{3})*)?$/.test(value.trim());
}

type HistoryRow = {
  id: number; section: string; changedAt: string;
  changes: { field: string; oldValue?: string | null; newValue?: string | null }[];
};

export function formatHistoryMoney(
  value: string | null | undefined, field: string, row: HistoryRow,
  history: HistoryRow[], currentCurrencies: Record<string, string>, previous: boolean,
): string {
  if (value === undefined || value === null || value === "") return "—";
  const fields: Record<string, string> = {
    "Budget Range": "Budget Currency", "Cost Estimate": "Cost Estimate Currency",
    "Procurement Cost": "Procurement Cost Currency", "Assembly Cost": "Assembly Cost Currency",
    "Market Price": "Market Price Currency",
  };
  if (field === "Design Cost" || field.includes("Hourly Rate")) return formatMoney(value);
  const currencyField = fields[field];
  if (!currencyField) return value;
  let currency = currentCurrencies[`${row.section}:${currencyField}`] ?? "USD";
  // Undo later currency changes so historical amounts retain their actual denomination.
  const later = history.filter((event) => event.section === row.section &&
    (event.changedAt > row.changedAt || (event.changedAt === row.changedAt && event.id > row.id)))
    .sort((a, b) => b.changedAt.localeCompare(a.changedAt) || b.id - a.id);
  for (const event of later) {
    const change = event.changes.find((item) => item.field === currencyField);
    if (change?.oldValue) currency = change.oldValue;
  }
  const own = row.changes.find((item) => item.field === currencyField);
  if (own) currency = (previous ? own.oldValue : own.newValue) ?? currency;
  return formatMoney(value, currency);
}