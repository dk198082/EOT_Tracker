import "./_group.css";
import {
  AlertTriangle,
  CheckCircle,
  ClipboardList,
  Clock,
  Eye,
  GitBranch,
  LayoutDashboard,
  LogOut,
  PlusCircle,
  RefreshCw,
  Shield,
  TrendingDown,
  XCircle,
} from "lucide-react";

const stages = [
  { key: "draft", label: "Draft", count: 8, tone: "bg-slate-100 text-slate-700" },
  { key: "art-review", label: "ART Review", count: 5, tone: "bg-violet-100 text-violet-700" },
  { key: "engineering-review", label: "Engineering Review", count: 4, tone: "bg-blue-100 text-blue-700" },
  { key: "production-review", label: "Production Review", count: 3, tone: "bg-amber-100 text-amber-700" },
  { key: "art-final-review", label: "ART Final Review", count: 2, tone: "bg-cyan-100 text-cyan-700" },
  { key: "quoted", label: "Quoted", count: 6, tone: "bg-emerald-100 text-emerald-700" },
];

const declines: [string, number, string][] = [
  ["Engineering Review", 5, "bg-blue-400"],
  ["ART Review", 3, "bg-violet-400"],
  ["Production Review", 2, "bg-amber-400"],
  ["Draft", 1, "bg-slate-400"],
];

const timings: [string, string, number, string][] = [
  ["Draft", "9.4h", 34, "bg-slate-400"],
  ["ART Review", "1.8d", 74, "bg-violet-400"],
  ["Engineering Review", "2.3d", 94, "bg-blue-400"],
  ["Production Review", "1.2d", 52, "bg-amber-400"],
  ["ART Final Review", "16.5h", 28, "bg-cyan-400"],
];

const queue = [
  ["ETO-2418", "Northstar Medical", "Mechanical", "Engineering Review", "Jun 18, 2025", "A-17", "1 of 2"],
  ["ETO-2412", "Canyon Outdoor", "Electrical", "ART Review", "Jun 17, 2025", "", ""],
  ["ETO-2406", "Beacon Mobility", "Software", "Production Review", "Jun 16, 2025", "", ""],
  ["ETO-2398", "Redwood Industrial", "Mechanical", "ART Final Review", "Jun 13, 2025", "A-09", "2 of 2"],
];

function StagePill({ label, tone }: { label: string; tone?: string }) {
  const stage = stages.find((item) => item.label === label);
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${tone ?? stage?.tone ?? "bg-slate-100 text-slate-700"}`}>
      {label}
    </span>
  );
}

function KpiCard({ title, value, icon, color, highlight }: { title: string; value: number; icon: React.ReactNode; color: string; highlight?: boolean }) {
  return (
    <div className={`eto-card p-4 ${highlight ? "border-red-300" : ""}`}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-600">{title}</span>
        <div className={`rounded-lg p-2 ${color}`}>{icon}</div>
      </div>
      <span className="text-3xl font-bold text-slate-900">{value}</span>
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="flex min-h-[100dvh] w-64 shrink-0 flex-col bg-[#1E3A5F]">
      <div className="border-b border-white/10 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-[#E8A020] text-sm font-bold text-white">E</div>
          <span className="text-lg font-bold text-white">ETO Tracker</span>
        </div>
      </div>
      <nav className="flex-1 space-y-1 p-4">
        <a className="eto-nav-link flex items-center gap-3 rounded-lg bg-[#E8A020]/20 px-3 py-2.5 text-sm font-medium text-amber-200" href="#dashboard"><LayoutDashboard className="h-5 w-5" />Dashboard</a>
        <a className="eto-nav-link flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300" href="#queue"><ClipboardList className="h-5 w-5" />ETO Requests</a>
        <a className="eto-nav-link flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300" href="#workflow"><GitBranch className="h-5 w-5" />Workflow</a>
        <a className="eto-nav-link flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300" href="#new"><PlusCircle className="h-5 w-5" />New Request</a>
        <a className="eto-nav-link flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300" href="#admin"><Shield className="h-5 w-5" />Admin</a>
      </nav>
      <div className="border-t border-white/10 p-4">
        <div className="mb-4 rounded-lg border border-white/15 bg-white/5 p-3">
          <label className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-200"><Eye className="h-3.5 w-3.5" />View as role</label>
          <div className="rounded border border-white/20 bg-white/10 px-3 py-2 text-sm text-white">SuperUser (normal)</div>
          <p className="mt-2 text-[11px] leading-4 text-slate-400">Uses the selected role&apos;s real permissions.</p>
        </div>
        <div className="mb-3 text-sm text-slate-300">
          <div className="truncate font-medium text-white">Jordan Mitchell</div>
          <div className="mt-0.5 text-xs capitalize text-slate-400">SuperUser</div>
        </div>
        <button className="flex w-full items-center gap-2 text-sm text-slate-400 transition-colors hover:text-white"><LogOut className="h-4 w-4" /> Sign out</button>
      </div>
    </aside>
  );
}

export function Current() {
  return (
    <div className="eto-current flex min-h-screen min-w-[1100px]">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-slate-50">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-amber-300 bg-amber-100 px-6 py-2.5 text-sm text-amber-950 shadow-sm">
          <div className="flex items-center gap-2"><Eye className="h-4 w-4" /><span>Role simulation active: viewing and acting as <strong>SuperUser</strong>. Actions are still recorded under your SuperUser identity.</span></div>
          <button className="rounded-md border border-amber-400 bg-white/70 px-3 py-1.5 text-xs font-medium hover:bg-white">↶ Exit simulation</button>
        </div>
        <div className="space-y-6 p-6" id="dashboard">
          <header className="flex items-center justify-between">
            <div><h1 className="text-2xl font-bold text-slate-900">Dashboard</h1><p className="mt-1 text-sm text-slate-500">Welcome back, Jordan</p></div>
            <span className="cursor-help border-b border-dashed border-slate-300 text-sm font-medium text-slate-500">Role: SuperUser</span>
          </header>
          <div className="grid grid-cols-6 gap-4">
            <KpiCard title="Open ETOs" value={28} icon={<ClipboardList className="h-5 w-5 text-blue-600" />} color="bg-blue-50" />
            <KpiCard title="Won" value={146} icon={<CheckCircle className="h-5 w-5 text-emerald-600" />} color="bg-emerald-50" />
            <KpiCard title="Declined" value={19} icon={<XCircle className="h-5 w-5 text-red-600" />} color="bg-red-50" />
            <KpiCard title="Lost" value={12} icon={<TrendingDown className="h-5 w-5 text-orange-600" />} color="bg-orange-50" />
            <KpiCard title="Historic Info Requests" value={37} icon={<RefreshCw className="h-5 w-5 text-amber-600" />} color="bg-amber-50" />
            <KpiCard title="Overdue" value={4} icon={<AlertTriangle className="h-5 w-5 text-red-600" />} color="bg-red-50" highlight />
          </div>
          <section className="eto-card">
            <div className="border-b border-slate-100 px-6 py-4"><h2 className="text-base font-semibold text-slate-800">Stage Pipeline</h2></div>
            <div className="flex flex-wrap gap-3 p-6">{stages.map((stage) => <div className="flex min-w-[90px] flex-col items-center gap-1.5" key={stage.key}><StagePill label={stage.label} tone={stage.tone} /><span className="text-2xl font-bold text-slate-800">{stage.count}</span></div>)}</div>
          </section>
          <div className="grid grid-cols-2 gap-4">
            <section className="eto-card"><div className="flex items-center gap-2 border-b border-slate-100 px-6 py-4"><AlertTriangle className="h-4 w-4 text-red-500" /><h2 className="text-base font-semibold text-slate-800">Declines by Stage</h2></div><div className="space-y-2 p-6">{declines.map(([label, count, color]) => <div className="flex items-center gap-3" key={label}><div className="w-36 shrink-0"><StagePill label={label} /></div><div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><div className={`h-2 rounded-full ${color}`} style={{ width: `${Number(count) * 16}%` }} /></div><span className="w-6 text-right text-sm font-semibold text-slate-700">{count}</span></div>)}</div></section>
            <section className="eto-card"><div className="flex items-center gap-2 border-b border-slate-100 px-6 py-4"><Clock className="h-4 w-4 text-blue-500" /><h2 className="text-base font-semibold text-slate-800">Avg Time per Stage</h2></div><div className="space-y-2 p-6">{timings.map(([label, time, pct, color]) => <div className="flex items-center gap-3" key={label}><div className="w-36 shrink-0"><StagePill label={label} /></div><div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} /></div><span className="w-10 text-right text-sm font-semibold text-slate-700">{time}</span></div>)}</div></section>
          </div>
          <section className="eto-card" id="queue"><div className="border-b border-slate-100 px-6 py-4"><h2 className="text-base font-semibold text-slate-800">My Queue</h2></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-slate-100 bg-slate-50"><th className="px-4 py-3 text-left font-medium text-slate-600">ETO #</th><th className="px-4 py-3 text-left font-medium text-slate-600">Customer</th><th className="px-4 py-3 text-left font-medium text-slate-600">Test Type</th><th className="px-4 py-3 text-left font-medium text-slate-600">Stage</th><th className="px-4 py-3 text-left font-medium text-slate-600">Updated</th></tr></thead><tbody>{queue.map(([number, customer, type, stage, date, family, position]) => <tr className="eto-table-row border-b border-slate-100 last:border-0" key={number}><td className="px-4 py-3"><div className="flex flex-col items-start gap-1.5"><a href={`#${number}`} className="font-medium text-[#1E3A5F] hover:underline">{number}</a>{family && <div className="flex items-center gap-2"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">Split {family}</span><a href="#family" className="text-xs font-medium text-blue-700 hover:underline">View family</a><span className="text-[11px] text-slate-400">{position}</span></div>}</div></td><td className="px-4 py-3 text-slate-700">{customer}</td><td className="px-4 py-3 capitalize text-slate-600">{type}</td><td className="px-4 py-3"><StagePill label={stage} /></td><td className="px-4 py-3 text-slate-500">{date}</td></tr>)}</tbody></table></div></section>
        </div>
      </main>
    </div>
  );
}