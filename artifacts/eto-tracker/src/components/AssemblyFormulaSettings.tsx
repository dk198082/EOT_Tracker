import { useEffect, useState } from "react";
import { useGetAssemblyFormula, useGetAssemblyFormulaHistory, useUpdateAssemblyFormula, type AssemblyFormulaInput } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/MoneyInput";
import { formatMoney, moneyInputValue } from "@/lib/money";
import { Label } from "@/components/ui/label";

export function AssemblyFormulaSettings() {
  const { data, isLoading, isError, refetch } = useGetAssemblyFormula();
  const { data: history, isLoading: historyLoading, isError: historyError, refetch: refetchHistory } = useGetAssemblyFormulaHistory();
  const update = useUpdateAssemblyFormula();
  const { toast } = useToast();
  const [form, setForm] = useState<AssemblyFormulaInput | null>(null);

  useEffect(() => {
    if (data) setForm({
      hourlyRate: moneyInputValue(data.hourlyRate),
      hoursPerWeek: data.hoursPerWeek,
      capacityFactor: data.capacityFactor,
    });
  }, [data]);

  if (isLoading) return <p className="py-8 text-sm text-slate-500">Loading assembly formula settings…</p>;
  if (isError || !data || !form) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
        Could not load assembly formula settings. <button className="underline" onClick={() => refetch()}>Try again</button>
      </div>
    );
  }

  const rate = Number(form.hourlyRate);
  const week = Number(form.hoursPerWeek);
  const factor = Number(form.capacityFactor);
  const valid = form.hourlyRate.trim() !== "" && form.hoursPerWeek.trim() !== "" &&
    form.capacityFactor.trim() !== "" && Number.isInteger(rate) && rate > 0 && rate <= 1_000_000_000 &&
    Number.isFinite(week) && week >= 1 && week <= 168 &&
    Number.isFinite(factor) && factor >= 0.01 && factor <= 1;
  const changed = form.hourlyRate !== data.hourlyRate ||
    form.hoursPerWeek !== data.hoursPerWeek || form.capacityFactor !== data.capacityFactor;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !changed) return;
    try {
      await update.mutateAsync({ data: form! });
      await Promise.all([refetch(), refetchHistory()]);
      toast({ title: "Assembly formula updated", description: "New Production Review completions will use these values." });
    } catch (err: any) {
      toast({ title: "Could not save formula", description: err?.response?.data?.error ?? "Please try again.", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Production assembly formula</h2>
        <p className="mt-1 text-sm text-slate-500">
          X is each request&apos;s Assembly Time (hours). Change the values used for future calculations.
          Previously saved ETO results will not change.
        </p>
      </div>
      <form onSubmit={handleSave} className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <div className="space-y-2">
            <Label htmlFor="assembly-hourly-rate" required>Assembly rate (USD per hour)</Label>
            <MoneyInput id="assembly-hourly-rate" max="1000000000" value={form.hourlyRate}
              onChange={(e) => setForm({ ...form, hourlyRate: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="assembly-hours-per-week" required>Working hours per week</Label>
            <Input id="assembly-hours-per-week" type="number" min="1" max="168" step="any" value={form.hoursPerWeek}
              onChange={(e) => setForm({ ...form, hoursPerWeek: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="assembly-capacity-factor" required>Assembly capacity factor</Label>
            <Input id="assembly-capacity-factor" type="number" min="0.01" max="1" step="any" value={form.capacityFactor}
              onChange={(e) => setForm({ ...form, capacityFactor: e.target.value })} />
            <p className="text-xs text-slate-500">0.65 means 65% of weekly hours are available for assembly.</p>
          </div>
        </div>
        <div className="rounded-lg bg-slate-50 border border-slate-100 p-4 text-sm text-slate-700 space-y-1">
          <p><span className="font-medium">Assembly Cost (USD)</span> = X × hourly rate</p>
          <p><span className="font-medium">Assembly Lead Time (weeks)</span> = (X ÷ working hours per week) ÷ assembly capacity factor</p>
          {valid && (
            <p className="pt-2 text-slate-500">
              Example for X = 40 hours:{" "}
              <strong className="text-slate-800">{formatMoney(String(40 * rate))}</strong>
              {" "}and <strong className="text-slate-800">{(40 / week / factor).toFixed(2)} weeks</strong>.
            </p>
          )}
        </div>
        {!valid && <p className="text-sm text-red-600">Enter a rate greater than 0 (up to 1 billion), 1–168 hours per week, and a capacity factor from 0.01 to 1.</p>}
        <div className="flex justify-end gap-2">
          {changed && <Button type="button" variant="outline" onClick={() => setForm({ hourlyRate: moneyInputValue(data.hourlyRate), hoursPerWeek: data.hoursPerWeek, capacityFactor: data.capacityFactor })}>Discard changes</Button>}
          <Button type="submit" disabled={!valid || !changed || update.isPending} className="bg-[#1E3A5F] hover:bg-[#162d4a] text-white">
            {update.isPending ? "Saving…" : "Save formula"}
          </Button>
        </div>
      </form>
      <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm" aria-label="Assembly formula change history">
        <h3 className="font-semibold text-slate-900">Change history</h3>
        {historyLoading ? <p className="mt-4 text-sm text-slate-500">Loading history…</p>
          : historyError ? <p className="mt-4 text-sm text-red-700">Could not load history. <button type="button" className="underline" onClick={() => refetchHistory()}>Try again</button></p>
          : history?.length === 0 ? <p className="mt-4 text-sm text-slate-500">No formula changes recorded yet.</p>
          : <ol className="mt-4 divide-y divide-slate-200">
              {history?.map((change) => (
                <li key={change.id} className="py-4 first:pt-0 last:pb-0">
                  <p className="text-sm font-medium text-slate-900">{change.actorName} <span className="font-normal text-slate-500">({change.actorEmail})</span></p>
                  <time className="text-xs text-slate-500" dateTime={change.changedAt}>{new Date(change.changedAt).toLocaleString()}</time>
                  <div className="mt-2 grid gap-1 text-sm text-slate-700 sm:grid-cols-3">
                    <p>Rate (USD/hr): <span className="font-medium">{formatMoney(change.previousValues.hourlyRate)} → {formatMoney(change.newValues.hourlyRate)}</span></p>
                    <p>Hours/week: <span className="font-medium">{change.previousValues.hoursPerWeek} → {change.newValues.hoursPerWeek}</span></p>
                    <p>Capacity factor: <span className="font-medium">{change.previousValues.capacityFactor} → {change.newValues.capacityFactor}</span></p>
                  </div>
                </li>
              ))}
            </ol>}
      </section>
    </div>
  );
}