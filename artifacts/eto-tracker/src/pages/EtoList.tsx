import { useState } from "react";
import { etoLabel } from "@/lib/eto-label";
import { useLocation } from "wouter";
import { useGetMe, useListEtoRequests, useListUsers } from "@workspace/api-client-react";
import { StagePill } from "@/components/StagePill";
import { SplitFamilyBadge } from "@/components/SplitFamilyBadge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, Plus, Search, AlertCircle, GitBranch, X } from "lucide-react";
import { format } from "date-fns";

const PAGE_SIZE = 50;

const STAGES = [
  { value: "", label: "All Stages" },
  { value: "draft", label: "Draft" },
  { value: "art-review", label: "ART Review" },
  { value: "engineering-review", label: "Engineering Review" },
  { value: "production-review", label: "Production Review" },
  { value: "art-final-review", label: "ART Final Review" },
  { value: "quoted", label: "Quoted" },
  { value: "won", label: "Won" },
  { value: "declined", label: "Declined" },
  { value: "lost", label: "Lost" },
  { value: "abandoned", label: "Abandoned" },
];

// User roles: sales | art | engineering | production | admin | superuser
const ROLE_LABELS: Record<string, string> = {
  sales: "Sales",
  art: "ART",
  engineering: "Engineering",
  production: "Production",
  admin: "Admin",
  superuser: "SuperUser",
};

function formatRole(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

export default function EtoList() {
  const [, navigate] = useLocation();
  const { data: me } = useGetMe();
  const { data: users = [], isLoading: usersLoading, isError: usersError, refetch: refetchUsers } = useListUsers();
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [archiveFilter, setArchiveFilter] = useState<"active" | "archived" | "all">("active");
  // Pre-apply the overdue filter when linked with ?overdue=true (e.g. from the dashboard)
  const [overdueOnly, setOverdueOnly] = useState(
    () => new URLSearchParams(window.location.search).get("overdue") === "true",
  );
  const [splitOnly, setSplitOnly] = useState(
    () => new URLSearchParams(window.location.search).get("splitOnly") === "true",
  );
  const [splitFamilyId, setSplitFamilyId] = useState<number | null>(() => {
    const value = Number(new URLSearchParams(window.location.search).get("splitFamilyId"));
    return Number.isInteger(value) && value > 0 ? value : null;
  });
  // Debounce search to avoid an API call per keystroke
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);

  // Update debounced value 400ms after last keystroke
  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
    clearTimeout((handleSearchChange as { _t?: ReturnType<typeof setTimeout> })._t);
    (handleSearchChange as { _t?: ReturnType<typeof setTimeout> })._t = setTimeout(
      () => setDebouncedSearch(value),
      400,
    );
  };

  const params: Parameters<typeof useListEtoRequests>[0] = {};
  params.page = page;
  params.limit = PAGE_SIZE;
  params.archive = archiveFilter;
  if (stageFilter) params.stage = stageFilter;
  if (assigneeFilter) params.assigneeId = Number(assigneeFilter);
  if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
  if (overdueOnly) params.overdue = true;
  if (splitOnly) params.splitOnly = true;
  if (splitFamilyId) params.splitFamilyId = splitFamilyId;

  const { data, isLoading } = useListEtoRequests(
    Object.keys(params).length ? params : undefined
  );

  const filtered = data?.items ?? [];
  const splitFamilyNumber = filtered.find((eto) => eto.splitFamilyNumber)?.splitFamilyNumber;

  const updateSplitFamilyFilter = (familyId: number | null) => {
    setSplitFamilyId(familyId);
    setSplitOnly(false);
    setSearch("");
    setDebouncedSearch("");
    setStageFilter("");
    setAssigneeFilter("");
    setOverdueOnly(false);
    setPage(1);

    const url = new URL(window.location.href);
    if (familyId) {
      url.searchParams.set("splitFamilyId", String(familyId));
      url.searchParams.delete("splitOnly");
      url.searchParams.delete("overdue");
    } else {
      url.searchParams.delete("splitFamilyId");
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">ETO Requests</h1>
          <p className="text-slate-500 text-sm mt-1">
            {data
              ? splitFamilyId
                ? `${data.total} requests in this split family`
                : `${data.total} total requests`
              : ""}
          </p>
        </div>
        {(me?.role === "sales" || me?.role === "superuser") && (
          <Button
            onClick={() => navigate("/eto-requests/new")}
            className="bg-[#1E3A5F] hover:bg-[#162d4a] text-white"
          >
            <Plus className="h-4 w-4 mr-2" />
            New Request
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search all ETO content..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={stageFilter}
          onValueChange={(value) => {
            setStageFilter(value);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Stages" />
          </SelectTrigger>
          <SelectContent>
            {STAGES.map((s) => (
              <SelectItem key={s.value || "__all__"} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <select
          aria-label="Filter by assignee"
          value={assigneeFilter}
          disabled={usersLoading || usersError}
          onChange={(event) => {
            setAssigneeFilter(event.target.value);
            setPage(1);
          }}
          className="h-9 w-[240px] max-w-full rounded-md border border-slate-300 bg-white px-3 py-1 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-700 disabled:opacity-50"
        >
          <option value="">{usersLoading ? "Loading assignees…" : usersError ? "Assignees unavailable" : "All Assignees"}</option>
          {[...users].sort((a, b) => a.name.localeCompare(b.name)).map((user) => (
            <option key={user.id} value={String(user.id)}>
              {user.name} ({formatRole(user.role)})
            </option>
          ))}
        </select>
        {usersError && (
          <Button type="button" variant="outline" onClick={() => refetchUsers()}>
            Retry assignees
          </Button>
        )}
        {/* Overdue filter: visible to all authenticated users since the ETO list
            itself is accessible to every role. ART admins are the primary
            audience, but the badge and filter are non-sensitive and useful
            to engineers and production reviewers tracking their own items. */}
        <Select value={archiveFilter} onValueChange={(value) => {
          setArchiveFilter(value as "active" | "archived" | "all"); setPage(1);
        }}>
          <SelectTrigger className="w-[210px]" aria-label="Archive visibility">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active ETOs</SelectItem>
            <SelectItem value="archived">Archived workspace ETOs</SelectItem>
            <SelectItem value="all">Active and archived ETOs</SelectItem>
          </SelectContent>
        </Select>
        {archiveFilter !== "active" && <p className="text-sm text-slate-500">Workspace archives retain their original numbers and are read-only.</p>}
        <Button
          variant={overdueOnly ? "default" : "outline"}
          size="sm"
          onClick={() => {
            setOverdueOnly((value) => !value);
            setPage(1);
          }}
          className={overdueOnly ? "bg-red-600 hover:bg-red-700 text-white border-red-600" : "border-slate-300 text-slate-600"}
        >
          <AlertCircle className="h-4 w-4 mr-1.5" />
          Overdue only
        </Button>
        <Button
          variant={splitOnly ? "default" : "outline"}
          size="sm"
          onClick={() => {
            const nextValue = !splitOnly;
            setSplitOnly(nextValue);
            setSplitFamilyId(null);
            setPage(1);

            const url = new URL(window.location.href);
            url.searchParams.delete("splitFamilyId");
            if (nextValue) {
              url.searchParams.set("splitOnly", "true");
            } else {
              url.searchParams.delete("splitOnly");
            }
            window.history.replaceState(null, "", `${url.pathname}${url.search}`);
          }}
          className={splitOnly ? "bg-blue-700 hover:bg-blue-800 text-white border-blue-700" : "border-slate-300 text-slate-600"}
        >
          <GitBranch className="h-4 w-4 mr-1.5" />
          Split families only
        </Button>
      </div>

      {splitFamilyId && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-blue-800">
            <GitBranch className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Showing the complete split family
              {splitFamilyNumber ? ` for ${splitFamilyNumber}` : ""}.
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => updateSplitFamilyFilter(null)}
            className="text-blue-800 hover:bg-blue-100 hover:text-blue-900"
          >
            <X className="h-4 w-4 mr-1.5" />
            Clear family
          </Button>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-slate-400">
              <ClipboardList className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium">No ETO requests found</p>
              {search || stageFilter || overdueOnly || splitOnly || splitFamilyId ? (
                <p className="text-sm mt-1">Try adjusting your filters.</p>
              ) : (
                <p className="text-sm mt-1">Create your first request to get started.</p>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th className="text-left px-4 py-3 font-medium text-slate-600">ETO #</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Split family</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Customer</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Quote #</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Test Type</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Stage</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Assignee</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((eto) => (
                    <tr
                      key={eto.id}
                      className={`border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors cursor-pointer ${
                        eto.splitFamilyPosition === 0 ? "bg-blue-50/40" : ""
                      }`}
                      onClick={() => navigate(`/eto-requests/${eto.id}${eto.recordKey ? `?recordKey=${encodeURIComponent(eto.recordKey)}` : ""}`)}
                    >
                      <td className="px-4 py-3 font-medium text-[#1E3A5F]">
                        <div className="flex items-center gap-2">
                          {etoLabel(eto)}
                          {eto.source && <Badge variant="outline">{eto.archived ? "Archived" : "Active"} · {eto.source}</Badge>}
                          {eto.overdue && (
                            <Badge className="bg-red-100 text-red-700 border-red-200 text-xs px-1.5 py-0 font-medium">
                              Overdue
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {eto.splitFamilyId ? (
                          <div className="flex items-center gap-2">
                            <SplitFamilyBadge
                              familyNumber={eto.splitFamilyNumber}
                              position={eto.splitFamilyPosition}
                            />
                            {splitFamilyId !== eto.splitFamilyId && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-blue-700 hover:bg-blue-50"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  updateSplitFamilyFilter(eto.splitFamilyId);
                                }}
                              >
                                View family
                              </Button>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{eto.customerName}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {eto.quoteNumber}
                        {eto.quoteRevision ? ` Rev ${eto.quoteRevision}` : ""}
                      </td>
                      <td className="px-4 py-3 text-slate-600 capitalize">{eto.testType}</td>
                      <td className="px-4 py-3">
                        <StagePill stage={eto.stage} />
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {eto.assigneeName ? (
                          <span>
                            {eto.assigneeName}
                            {eto.overdue && eto.assigneeRole && (
                              <span className="text-slate-400">
                                {" · "}
                                <span className="capitalize">{formatRole(eto.assigneeRole)}</span>
                              </span>
                            )}
                          </span>
                        ) : eto.overdue ? (
                          <Badge
                            variant="outline"
                            className="border-amber-300 bg-amber-50 text-amber-700 text-xs px-1.5 py-0 font-medium"
                          >
                            Unassigned
                          </Badge>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {format(new Date(eto.createdAt), "MMM d, yyyy")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {data && data.totalGroups > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>
            Page {page} of {Math.ceil(data.totalGroups / PAGE_SIZE)}
            {" · "}
            {data.totalGroups} request groups, {data.total} total requests
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page * PAGE_SIZE >= data.totalGroups}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
