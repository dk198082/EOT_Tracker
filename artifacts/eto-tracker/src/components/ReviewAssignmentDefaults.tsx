import { useEffect, useState } from "react";
import {
  useGetReviewAssignmentDefaults,
  useUpdateReviewAssignmentDefaults,
  type User,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type Selection = { engineeringUserId: number | null; productionUserId: number | null };

export function ReviewAssignmentDefaults({ users, entity }: { users: User[]; entity: "TOUS" | "TOUK" }) {
  const { data, isLoading, isError, refetch } = useGetReviewAssignmentDefaults({ entity });
  const update = useUpdateReviewAssignmentDefaults();
  const { toast } = useToast();
  const [selection, setSelection] = useState<Selection | null>(null);

  useEffect(() => {
    if (data) setSelection({
      engineeringUserId: data.engineeringUserId,
      productionUserId: data.productionUserId,
    });
  }, [data]);

  const engineers = users.filter((u) => u.role === "engineering");
  const productionUsers = users.filter((u) => u.role === "production");
  const valid = selection !== null &&
    engineers.some((u) => u.id === selection.engineeringUserId) &&
    productionUsers.some((u) => u.id === selection.productionUserId);
  const changed = selection !== null && data !== undefined &&
    (selection.engineeringUserId !== data.engineeringUserId ||
      selection.productionUserId !== data.productionUserId);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!selection?.engineeringUserId || !selection.productionUserId || !valid || !changed) return;
    try {
      await update.mutateAsync({ data: {
        entity,
        engineeringUserId: selection.engineeringUserId,
        productionUserId: selection.productionUserId,
      } });
      await refetch();
      toast({ title: `${entity} default reviewers saved`, description: `New ${entity} Engineering and Production Reviews will use these defaults.` });
    } catch (err: any) {
      toast({ title: "Could not save defaults", description: err?.response?.data?.error ?? "Please try again.", variant: "destructive" });
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-label={`${entity} default review assignments`}>
      <h3 className="text-base font-semibold text-slate-900">{entity} — Default review assignments</h3>
      <p className="mt-1 text-sm text-slate-500">
        New reviews for Entity {entity} go to these users. ART can choose different reviewers for an individual ETO;
        existing assignments are not changed.
      </p>
      {isLoading ? <p className="mt-4 text-sm text-slate-500">Loading defaults…</p>
        : isError || !data || !selection
          ? <p className="mt-4 text-sm text-red-700">Could not load defaults. <button className="underline" onClick={() => refetch()}>Try again</button></p>
          : (
            <form onSubmit={handleSave} className="mt-5 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={`default-engineer-${entity}`} required>Engineering default user</Label>
                  <select id={`default-engineer-${entity}`} value={selection.engineeringUserId ?? ""}
                    onChange={(e) => setSelection({ ...selection, engineeringUserId: e.target.value ? Number(e.target.value) : null })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]/30">
                    <option value="" disabled>Select an Engineering user</option>
                    {engineers.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`default-production-${entity}`} required>Production default user</Label>
                  <select id={`default-production-${entity}`} value={selection.productionUserId ?? ""}
                    onChange={(e) => setSelection({ ...selection, productionUserId: e.target.value ? Number(e.target.value) : null })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]/30">
                    <option value="" disabled>Select a Production user</option>
                    {productionUsers.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
                  </select>
                </div>
              </div>
              {(!engineers.length || !productionUsers.length) && (
                <p className="text-sm text-amber-700">Add a user with each review role before saving defaults.</p>
              )}
              <div className="flex justify-end gap-2">
                {changed && (
                  <Button type="button" variant="outline" onClick={() => setSelection({
                    engineeringUserId: data.engineeringUserId,
                    productionUserId: data.productionUserId,
                  })}>Discard changes</Button>
                )}
                <Button type="submit" disabled={!valid || !changed || update.isPending} className="bg-[#1E3A5F] hover:bg-[#162d4a] text-white">
                  {update.isPending ? "Saving…" : "Save defaults"}
                </Button>
              </div>
            </form>
          )}
    </section>
  );
}