import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetEtoPriceCalculator,
  useUpdateEtoPriceCalculator,
  getGetEtoPriceCalculatorQueryKey,
  getListDetailChangesQueryKey,
  getGetEtoRequestQueryKey,
} from "@workspace/api-client-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { calculatePrice, type SalesPriceSuggestion } from "@/lib/price-calculation";
import { formatMoney } from "@/lib/money";
import { CalculatedLeadTime } from "@/components/CalculatedLeadTime";
import type { ReviewLeadTimes } from "@/lib/lead-time-calculation";

type Cost = { value?: string | null; currency?: string | null; loading?: boolean; error?: boolean };
type ReviewRisk = { score?: string | null; notes?: string | null; loading?: boolean; error?: boolean };

interface Props {
  etoId: number;
  canEdit: boolean;
  archived?: boolean;
  design: Cost;
  procure: Cost;
  assembly: Cost;
  leadTimes: ReviewLeadTimes;
  engineeringRisk?: ReviewRisk;
  productionRisk?: ReviewRisk;
  onSalesPriceChange?: (price: SalesPriceSuggestion | null) => void;
}

function validPct(v: string) {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= 100;
}

function CostRow({ label, cost, testId }: { label: string; cost: Cost; testId: string }) {
  let body: React.ReactNode;
  if (cost.loading) body = <span className="text-slate-400">Loading…</span>;
  else if (cost.error) body = <span className="text-red-600">Could not load</span>;
  else if (cost.value === null || cost.value === undefined || cost.value === "")
    body = <span className="text-slate-400 italic">Not recorded</span>;
  else body = <span className="font-medium text-slate-900">{formatMoney(cost.value, cost.currency ?? "USD")}</span>;
  return (
    <div className="flex items-center justify-between text-sm" data-testid={testId}>
      <span className="text-slate-600">{label}</span>
      {body}
    </div>
  );
}

function CalculatedRow({ label, value, currency, loading, testId, total = false }: {
  label: string; value?: string; currency?: string; loading: boolean; testId: string; total?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 text-sm ${total ? "border-t border-slate-200 pt-3 font-semibold" : ""}`}
      data-testid={testId}>
      <span className={total ? "text-slate-900" : "text-slate-600"}>{label}</span>
      <span className={`text-right tabular-nums ${value !== undefined ? "font-medium text-slate-900" : "text-slate-400"}`}>
        {loading ? "Loading…" : value !== undefined ? formatMoney(value, currency ?? "USD") : "Not available"}
      </span>
    </div>
  );
}

function RiskRow({ label, risk, testId }: { label: string; risk: ReviewRisk; testId: string }) {
  const value = risk.loading
    ? "Loading…"
    : risk.error
      ? "Could not load"
      : risk.score || "Not recorded";
  return (
    <div className="flex items-start justify-between gap-3 text-sm" data-testid={testId}>
      <span className="shrink-0 text-slate-600">{label}</span>
      <span className={`text-right ${risk.error ? "text-red-600" : "text-slate-900"}`}>{value}</span>
    </div>
  );
}

function RiskNotesRow({ label, risk, testId }: { label: string; risk: ReviewRisk; testId: string }) {
  if (risk.score !== "High") return null;
  const value = risk.loading
    ? "Loading…"
    : risk.error
      ? "Could not load"
      : risk.notes?.trim() || "Not recorded";
  return (
    <div className="space-y-1 text-sm" data-testid={testId}>
      <span className="text-slate-600">{label}</span>
      <p className={`break-words ${risk.error ? "text-red-600" : "text-slate-900"}`}>{value}</p>
    </div>
  );
}

export function PriceCalculator({ etoId, canEdit, archived = false, design, procure, assembly, leadTimes, engineeringRisk = {}, productionRisk = {}, onSalesPriceChange }: Props) {
  const qc = useQueryClient();
  const calc = useGetEtoPriceCalculator(etoId);
  const update = useUpdateEtoPriceCalculator();
  const [draft, setDraft] = useState<{ c: string; m: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const base = calc.data && (!archived || calc.data.saved)
    ? { c: calc.data.contingencyPercent, m: calc.data.marginPercent }
    : null;
  const cur = draft ?? base;
  const changed = !!draft && !!base && (draft.c !== base.c || draft.m !== base.m);
  const valid = !!cur && validPct(cur.c) && validPct(cur.m);
  const unsaved = calc.data && !calc.data.saved;
  const loadErr = calc.isError;
  const loading = calc.isPending;
  const costsLoading = !!(design.loading || procure.loading || assembly.loading);
  const costsError = !!(design.error || procure.error || assembly.error);
  const price = cur && valid && !loading && !loadErr && !costsLoading && !costsError
    ? calculatePrice([design, procure, assembly], cur.c, cur.m)
    : null;
  const salesPrice = price?.salesPrice;
  const currency = price?.currency;
  const multiCurrency = price?.multiCurrency;
  useEffect(() => {
    onSalesPriceChange?.(salesPrice !== undefined && currency !== undefined && multiCurrency !== undefined
      ? { salesPrice, currency, multiCurrency } : null);
  }, [onSalesPriceChange, salesPrice, currency, multiCurrency]);

  function save() {
    if (!cur || !valid) return;
    setSaveError(null);
    update.mutate(
      { id: etoId, data: { contingencyPercent: cur.c.trim(), marginPercent: cur.m.trim() } },
      {
        onSuccess: (saved) => {
          qc.setQueryData(getGetEtoPriceCalculatorQueryKey(etoId), saved);
          setDraft(null);
          qc.invalidateQueries({ queryKey: getGetEtoPriceCalculatorQueryKey(etoId) });
          qc.invalidateQueries({ queryKey: getListDetailChangesQueryKey(etoId) });
          qc.invalidateQueries({ queryKey: getGetEtoRequestQueryKey(etoId) });
          toast.success("Price calculator saved");
        },
        onError: (err: any) => {
          const msg = err?.data?.error ?? err?.response?.data?.error ?? "Could not save price calculator. Please try again.";
          setSaveError(msg);
          toast.error(msg);
        },
      },
    );
  }

  const field = (id: string, label: string, key: "c" | "m") => (
    <div className="space-y-1">
      <Label htmlFor={id} required>{label}</Label>
      <Input
        id={id}
        data-testid={`input-${id}`}
        type="number" min="0" max="100" step="any"
        disabled={archived || !canEdit || !cur || update.isPending}
        value={cur ? cur[key] : ""}
        onChange={(e) => cur && setDraft({ ...cur, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <Card className="order-[2]" data-testid="card-price-calculator">
      <CardHeader>
        <CardTitle className="text-base font-semibold text-slate-800">Price Calculator</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3" data-testid="price-calculator-assumptions">
          <RiskRow label="Engineering Risk" risk={engineeringRisk} testId="text-engineering-risk" />
          {engineeringRisk.score === "High" && (
            <RiskNotesRow label="Engineering Risk Notes" risk={engineeringRisk} testId="text-engineering-risk-notes" />
          )}
          <RiskRow label="Production Risk" risk={productionRisk} testId="text-production-risk" />
          {productionRisk.score === "High" && (
            <RiskNotesRow label="Production Risk Notes" risk={productionRisk} testId="text-production-risk-notes" />
          )}
          {loading ? (
            <p className="text-sm text-slate-400">Loading percentages…</p>
          ) : loadErr ? (
            <p className="text-sm text-red-600">
              Could not load percentages.{" "}
              <button className="underline" onClick={() => calc.refetch()}>Try again</button>
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                {field("price-contingency", "Contingency %", "c")}
                {field("price-margin", "Margin %", "m")}
              </div>
              {unsaved && !changed && (
                <p className="text-xs text-slate-500">{archived
                  ? "No calculator percentages were saved for this archived ETO. Current admin defaults are not applied."
                  : "Showing admin defaults. Save to set values for this ETO."}</p>
              )}
              {changed && canEdit && (
                <p className="text-xs text-slate-500">Unsaved percentages. Save to keep these values for this ETO.</p>
              )}
              {cur && !valid && <p className="text-xs text-red-600">Enter percentages from 0 to 100.</p>}
              {saveError && <p className="text-sm text-red-600" role="alert">{saveError}</p>}
            </>
          )}
        </div>
        <div className="border-t-2 border-slate-200 pt-4 space-y-2" data-testid="price-calculator-financials">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Financial amounts</h3>
          <CostRow label="Design Cost" cost={design} testId="text-design-cost" />
          <CostRow label="Procure Cost" cost={procure} testId="text-procure-cost" />
          <CostRow label="Assembly Cost" cost={assembly} testId="text-assembly-cost" />
          <CalculatedRow label="Contingency Cost" value={price?.contingencyCost} currency={price?.currency}
            loading={loading || costsLoading} testId="text-contingency-cost" />
          <CalculatedRow label="Margin" value={price?.marginCost} currency={price?.currency}
            loading={loading || costsLoading} testId="text-margin-cost" />
          <CalculatedRow label="Sales Price" value={price?.salesPrice} currency={price?.currency}
            loading={loading || costsLoading} testId="text-sales-price" total />
          {canEdit && !archived && !loading && !loadErr && (
            <div className="flex justify-end gap-2 pt-3">
              {changed && (
                <Button type="button" size="sm" variant="outline" disabled={update.isPending} onClick={() => { setDraft(null); setSaveError(null); }}>
                  Discard
                </Button>
              )}
              <Button
                type="button" size="sm" data-testid="button-save-price-calculator"
                disabled={!valid || update.isPending || !(changed || unsaved)}
                onClick={save}
                className="bg-[#1E3A5F] hover:bg-[#162d4a] text-white"
              >
                {update.isPending ? "Saving…" : unsaved && !changed ? "Save to ETO" : "Save"}
              </Button>
            </div>
          )}
        </div>
        {price?.multiCurrency && (
          <p className="text-xs text-amber-700" data-testid="text-multi-currency-note">
            Multi-Currency: amounts are added without conversion. ART must review.
          </p>
        )}
        {!loading && !costsLoading && !loadErr && !price && (
          <p className="text-xs text-slate-500">
            {costsError ? "Could not load review costs." : !valid
              ? "Enter valid percentages to calculate Sales Price."
              : "All three review costs must be recorded as numeric amounts to calculate Sales Price."}
          </p>
        )}
        <CalculatedLeadTime times={leadTimes} />
      </CardContent>
    </Card>
  );
}
