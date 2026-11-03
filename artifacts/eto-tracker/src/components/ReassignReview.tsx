import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListUsers, useReassignEtoReview, getGetEtoRequestQueryKey, getListUsersQueryKey,
  type EtoRequest,
} from "@workspace/api-client-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function ReassignReview({ eto, department, disabled }: {
  eto: EtoRequest;
  department: "engineering" | "production";
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [expectedAssigneeId, setExpectedAssigneeId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const qc = useQueryClient();
  const { data: users, isLoading, isError } = useListUsers({ role: department }, {
    query: { enabled: open, queryKey: getListUsersQueryKey({ role: department }) },
  });
  const { mutate, isPending } = useReassignEtoReview();
  const candidates = (users ?? []).filter((user) => user.role === department && user.id !== expectedAssigneeId);
  const title = department === "engineering" ? "Engineering" : "Production";
  const expectedStage = department === "engineering" ? "engineering-review" : "production-review";

  function save() {
    if (!selectedId || isPending) return;
    setError("");
    mutate({ id: eto.id, data: {
      assigneeId: Number(selectedId), expectedStage, expectedAssigneeId,
    } }, {
      onSuccess: (assignment) => {
        qc.setQueryData<EtoRequest>(getGetEtoRequestQueryKey(eto.id), (current) => current && current.stage === assignment.stage ? {
          ...current, assigneeId: assignment.assigneeId, assigneeName: assignment.assigneeName,
          assigneeRole: assignment.department, updatedAt: assignment.updatedAt,
          ...(department === "engineering"
            ? { stickyEngineerUserId: assignment.assigneeId, stickyEngineerName: assignment.assigneeName }
            : { productionAssigneeId: assignment.assigneeId }),
        } : current);
        void qc.invalidateQueries();
        setOpen(false);
        toast.success(`${title} review reassigned to ${assignment.assigneeName}`);
      },
      onError: () => {
        setError("Reassignment failed. The request or user's role may have changed. Close and reopen Re-Assign to try again.");
        void qc.invalidateQueries({ queryKey: getGetEtoRequestQueryKey(eto.id) });
      },
    });
  }

  return (
    <>
      <Button variant="outline" className="w-full" disabled={disabled || isPending} onClick={() => {
        setExpectedAssigneeId(eto.assigneeId ?? null);
        setSelectedId("");
        setError("");
        setOpen(true);
      }}>Re-Assign</Button>
      <Dialog open={open} onOpenChange={(next) => { if (!isPending) setOpen(next); }}>
        <DialogContent className="z-[60] border-slate-200 bg-white text-slate-900 shadow-xl">
          <DialogHeader>
            <DialogTitle>Re-Assign {title} Review</DialogTitle>
            <DialogDescription className="text-slate-600">Choose another user in {title}. The request stays in its current stage and saved review work is retained.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`reassign-${department}`} required>Assigned</Label>
            <Select value={selectedId} onValueChange={setSelectedId} disabled={isPending || isLoading || isError}>
              <SelectTrigger id={`reassign-${department}`} className="border-slate-300 bg-white text-slate-900 data-[placeholder]:text-slate-500"><SelectValue placeholder={`Select a ${title} user`} /></SelectTrigger>
              <SelectContent className="border-slate-200 bg-white text-slate-900">{candidates.map((user) => <SelectItem key={user.id} value={String(user.id)} className="focus:bg-slate-100 focus:text-slate-900">{user.name}</SelectItem>)}</SelectContent>
            </Select>
            {isLoading && <p className="text-sm text-slate-500">Loading users…</p>}
            {isError && <p role="alert" className="text-sm text-red-600">Users could not be loaded. Close and reopen to retry.</p>}
            {!isLoading && !isError && !candidates.length && <p className="text-sm text-slate-500">No other {title} users are available. An administrator must assign the department role first.</p>}
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-slate-300 bg-white text-slate-900 hover:bg-slate-100" onClick={() => setOpen(false)} disabled={isPending}>Cancel</Button>
            <Button className="bg-[#1E3A5F] text-white hover:bg-[#162d4a]" onClick={save} disabled={!selectedId || isLoading || isError || isPending}>{isPending ? "Saving…" : "Save Assignment"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
