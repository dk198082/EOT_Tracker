import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPriceCalculatorDefaults,
  useUpdatePriceCalculatorDefaults,
  getGetPriceCalculatorDefaultsQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function validPct(v: string) {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= 100;
}

export function PriceCalculatorSettings() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useGetPriceCalculatorDefaults();
  const update = useUpdatePriceCalculatorDefaults();
  const { toast } = useToast();
  const [draft, setDraft] = useState<{ c: string; m: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (isLoading) return <p className="py-8 text-sm text-slate-500">Loading price calculator settings…</p>;
  if (isError || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
        Could not load price calculator settings. <button className="underline" onClick={() => refetch()}>Try again</button>
      </div>
    );
  }
  const cur = draft ?? { c: data.contingencyPercent, m: data.marginPercent };
  const valid = validPct(cur.c) && validPct(cur.m);
  const changed = cur.c !== data.contingencyPercent || cur.m !== data.marginPercent;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !changed) return;
    setError(null);
    try {
      const saved = await update.mutateAsync({ data: { contingencyPercent: cur.c.trim(), marginPercent: cur.m.trim() } });
      qc.setQueryData(getGetPriceCalculatorDefaultsQueryKey(), saved);
      setDraft(null);
      await qc.invalidateQueries({ queryKey: getGetPriceCalculatorDefaultsQueryKey() });
      await qc.invalidateQueries({
        predicate: (q) => typeof q.queryKey[0] === "string" && q.queryKey.join("/").includes("price-calculator"),
      });
      toast({ title: "Price calculator defaults updated", description: "ETOs with saved values are not affected." });
    } catch (err: any) {
      const msg = err?.data?.error ?? err?.response?.data?.error ?? "Could not save defaults. Please try again.";
      setError(msg);
      toast({ title: "Could not save defaults", description: msg, variant: "destructive" });
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Price Calculator defaults</h2>
        <p className="mt-1 text-sm text-slate-500">
          Starting Contingency % and Margin % for ETOs that have no saved values. ETOs with saved values will not change.
        </p>
      </div>
      <form onSubmit={save} className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="space-y-2">
            <Label htmlFor="pc-default-contingency" required>Contingency %</Label>
            <Input id="pc-default-contingency" type="number" min="0" max="100" step="any" value={cur.c} disabled={update.isPending}
              onChange={(e) => setDraft({ ...cur, c: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pc-default-margin" required>Margin %</Label>
            <Input id="pc-default-margin" type="number" min="0" max="100" step="any" value={cur.m} disabled={update.isPending}
              onChange={(e) => setDraft({ ...cur, m: e.target.value })} />
          </div>
        </div>
        {!valid && <p className="text-sm text-red-600">Enter percentages from 0 to 100.</p>}
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          {changed && <Button type="button" variant="outline" disabled={update.isPending} onClick={() => { setDraft(null); setError(null); }}>Discard changes</Button>}
          <Button type="submit" disabled={!valid || !changed || update.isPending} className="bg-[#1E3A5F] hover:bg-[#162d4a] text-white">
            {update.isPending ? "Saving…" : "Save defaults"}
          </Button>
        </div>
      </form>
    </div>
  );
}
