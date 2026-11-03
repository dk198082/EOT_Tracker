import { Link } from "wouter";
import { etoLabel } from "@/lib/eto-label";
import { useGetDashboardMetrics, useGetMyQueue, useGetMe } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StagePill, stageLabels } from "@/components/StagePill";
import { SplitFamilyBadge } from "@/components/SplitFamilyBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardList, CheckCircle, XCircle, RefreshCw, Clock, AlertTriangle, TrendingDown } from "lucide-react";
import { format } from "date-fns";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const ACTIVE_STAGES = [
  "draft",
  "art-review",
  "engineering-review",
  "production-review",
  "art-final-review",
  "quoted",
];

const STAGE_ORDER = [
  "draft",
  "art-review",
  "engineering-review",
  "production-review",
  "art-final-review",
  "quoted",
];

export default function Dashboard() {
  const { data: metrics, isLoading: metricsLoading } = useGetDashboardMetrics();
  const { data: queue, isLoading: queueLoading } = useGetMyQueue();
  const { data: me } = useGetMe();

  const roleLabel: Record<string, string> = {
    admin: "Admin",
    superuser: "SuperUser",
    sales: "Sales",
    art: "ART",
    engineering: "Engineering",
    production: "Production",
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">ART Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1">Welcome back{me?.name ? `, ${me.name}` : ""}</p>
        </div>
        {me?.role && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="text-sm font-medium text-slate-500 capitalize cursor-help border-b border-dashed border-slate-300"
                aria-label={`Your role is ${me.role}`}
              >
              Role: {roleLabel[me.role] ?? me.role}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Your role controls which ETO actions and screens are available to you.
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <KpiCard
          title="Open ETOs"
          value={metrics?.totalOpen}
          loading={metricsLoading}
          icon={<ClipboardList className="h-5 w-5 text-blue-600" />}
          color="bg-blue-50"
        />
        <KpiCard
          title="Won"
          value={metrics?.totalWon}
          loading={metricsLoading}
          icon={<CheckCircle className="h-5 w-5 text-emerald-600" />}
          color="bg-emerald-50"
        />
        <KpiCard
          title="Declined"
          value={metrics?.totalDeclined}
          loading={metricsLoading}
          icon={<XCircle className="h-5 w-5 text-red-600" />}
          color="bg-red-50"
        />
        <KpiCard
          title="Lost"
          value={metrics?.totalLost}
          loading={metricsLoading}
          icon={<TrendingDown className="h-5 w-5 text-orange-600" />}
          color="bg-orange-50"
        />
        <KpiCard
          title="Historic Info Requests"
          value={metrics?.moreInfoLoopCount}
          loading={metricsLoading}
          icon={<RefreshCw className="h-5 w-5 text-amber-600" />}
          color="bg-amber-50"
        />
        <Link href="/eto-requests?overdue=true" className="block">
          <KpiCard
            title="Overdue"
            value={metrics?.overdueCount}
            loading={metricsLoading}
            icon={<AlertTriangle className="h-5 w-5 text-red-600" />}
            color="bg-red-50"
            highlight={(metrics?.overdueCount ?? 0) > 0}
          />
        </Link>
      </div>

      {/* Stage Pipeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold text-slate-800">Stage Pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          {metricsLoading ? (
            <div className="flex gap-3">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-12 flex-1 rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-3">
              {STAGE_ORDER.map((stage) => {
                const count = metrics?.stageCounts?.[stage] ?? 0;
                return (
                  <div key={stage} className="flex flex-col items-center gap-1.5 min-w-[90px]">
                    <StagePill stage={stage} />
                    <span className="text-2xl font-bold text-slate-800">{count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Two-column analytics row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Declines by Stage */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              Declines by Stage
            </CardTitle>
          </CardHeader>
          <CardContent>
            {metricsLoading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => (
                  <Skeleton key={i} className="h-7 w-full rounded" />
                ))}
              </div>
            ) : !metrics?.declinesByStage || Object.keys(metrics.declinesByStage).length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">No declines recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {Object.entries(metrics.declinesByStage)
                  .sort((a, b) => b[1] - a[1])
                  .map(([stage, count]) => {
                    const total = Object.values(metrics.declinesByStage).reduce((s, n) => s + n, 0);
                    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                    return (
                      <div key={stage} className="flex items-center gap-3">
                        <div className="w-36 shrink-0">
                          <StagePill stage={stage} />
                        </div>
                        <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                          <div
                            className="bg-red-400 h-2 rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-sm font-semibold text-slate-700 w-6 text-right">{count}</span>
                      </div>
                    );
                  })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Average Time per Stage */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
              <Clock className="h-4 w-4 text-blue-500" />
              Avg Time per Stage
            </CardTitle>
          </CardHeader>
          <CardContent>
            {metricsLoading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => (
                  <Skeleton key={i} className="h-7 w-full rounded" />
                ))}
              </div>
            ) : !metrics?.avgTimePerStageHours || Object.keys(metrics.avgTimePerStageHours).length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">No completed requests yet.</p>
            ) : (
              <div className="space-y-2">
                {ACTIVE_STAGES
                  .filter((s) => (metrics.avgTimePerStageHours[s] ?? 0) > 0)
                  .map((stage) => {
                    const hours = metrics.avgTimePerStageHours[stage] ?? 0;
                    const maxHours = Math.max(...ACTIVE_STAGES.map((s) => metrics.avgTimePerStageHours[s] ?? 0));
                    const pct = maxHours > 0 ? Math.round((hours / maxHours) * 100) : 0;
                    const display = hours >= 48
                      ? `${(hours / 24).toFixed(1)}d`
                      : `${hours.toFixed(1)}h`;
                    return (
                      <div key={stage} className="flex items-center gap-3">
                        <div className="w-36 shrink-0">
                          <StagePill stage={stage} />
                        </div>
                        <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                          <div
                            className="bg-blue-400 h-2 rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-sm font-semibold text-slate-700 w-10 text-right">{display}</span>
                      </div>
                    );
                  })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* My Queue */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold text-slate-800">My Queue</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {queueLoading ? (
            <div className="p-4 space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded" />
              ))}
            </div>
          ) : !queue || queue.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
              <ClipboardList className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium">Your queue is empty</p>
              <p className="text-sm mt-1">No ETO requests are currently assigned to you.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th className="text-left px-4 py-3 font-medium text-slate-600">ETO #</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Customer</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Test Type</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Stage</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map((eto) => (
                    <tr
                      key={eto.id}
                      className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start gap-1.5">
                          <Link href={`/eto-requests/${eto.id}`} className="font-medium text-[#1E3A5F] hover:underline">
                            {etoLabel(eto)}
                          </Link>
                          {eto.splitFamilyId && (
                            <div className="flex items-center gap-2">
                              <SplitFamilyBadge
                                familyNumber={eto.splitFamilyNumber}
                                position={eto.splitFamilyPosition}
                              />
                              <Link
                                href={`/eto-requests?splitFamilyId=${eto.splitFamilyId}`}
                                className="text-xs font-medium text-blue-700 hover:underline"
                              >
                                View family
                              </Link>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{eto.customerName}</td>
                      <td className="px-4 py-3 text-slate-600 capitalize">{eto.testType}</td>
                      <td className="px-4 py-3">
                        <StagePill stage={eto.stage} />
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {format(new Date(eto.updatedAt), "MMM d, yyyy")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  title,
  value,
  loading,
  icon,
  color,
  highlight,
}: {
  title: string;
  value?: number;
  loading: boolean;
  icon: React.ReactNode;
  color: string;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? "border-red-300 hover:border-red-400 transition-colors" : undefined}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-slate-600">{title}</span>
          <div className={`p-2 rounded-lg ${color}`}>{icon}</div>
        </div>
        {loading ? (
          <Skeleton className="h-8 w-16 rounded" />
        ) : (
          <span className="text-3xl font-bold text-slate-900">{value ?? 0}</span>
        )}
      </CardContent>
    </Card>
  );
}
