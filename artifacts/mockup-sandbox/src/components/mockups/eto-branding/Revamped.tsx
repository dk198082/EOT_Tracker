import "./eto-branding.css";
import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  ClipboardList,
  Clock3,
  Eye,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Plus,
  RefreshCw,
  Shield,
  TrendingDown,
  XCircle,
} from "lucide-react";

type IconType = typeof ClipboardList;
type QueueItem = {
  number: string;
  customer: string;
  type: string;
  stage: string;
  updated: string;
  family?: string;
  position?: string;
};

const stages = [
  ["Draft", 8], ["ART Review", 5], ["Engineering Review", 4],
  ["Production Review", 3], ["ART Final Review", 2], ["Quoted", 6],
] as const;
const declines = [["Engineering Review", 5, "is-active"], ["ART Review", 3, "is-review"], ["Production Review", 2, "is-review"], ["Draft", 1, "is-muted"]] as const;
const timings = [["Draft", "9.4h", 34, "is-muted"], ["ART Review", "1.8d", 74, "is-review"], ["Engineering Review", "2.3d", 94, "is-active"], ["Production Review", "1.2d", 52, "is-review"], ["ART Final Review", "16.5h", 28, "is-muted"]] as const;
const initialQueue: QueueItem[] = [
  { number: "ETO-2418", customer: "Northstar Medical", type: "Mechanical", stage: "Engineering Review", updated: "Jun 18, 2025", family: "A-17", position: "1 of 2" },
  { number: "ETO-2412", customer: "Canyon Outdoor", type: "Electrical", stage: "ART Review", updated: "Jun 17, 2025" },
  { number: "ETO-2406", customer: "Beacon Mobility", type: "Software", stage: "Production Review", updated: "Jun 16, 2025" },
  { number: "ETO-2398", customer: "Redwood Industrial", type: "Mechanical", stage: "ART Final Review", updated: "Jun 13, 2025", family: "A-09", position: "2 of 2" },
];

function Status({ label }: { label: string }) {
  const review = label.includes("Review");
  return <span className={`eto-status ${review ? "is-review" : "is-active"}`}>{label}</span>;
}

function Kpi({ title, value, Icon, alert }: { title: string; value: number; Icon: IconType; alert?: boolean }) {
  return <article className={`eto-card eto-kpi ${alert ? "is-alert" : ""}`}><div className="eto-kpi-top"><span className="eto-kpi-title">{title}</span><Icon className="eto-kpi-icon" size={17} strokeWidth={1.8} /></div><strong className="eto-kpi-value">{value}</strong></article>;
}

function Sidebar({ active, onNavigate }: { active: string; onNavigate: (item: string) => void }) {
  const links = [["Dashboard", LayoutDashboard], ["ETO Requests", ClipboardList], ["Workflow", GitBranch], ["New Request", Plus], ["Admin", Shield]] as const;
  return <aside className="eto-side">
    <div className="eto-brand"><div className="eto-mark">E</div><div><span className="eto-brand-name">ETO Tracker</span><span className="eto-brand-sub">Digital Transformation</span></div></div>
    <nav className="eto-nav" aria-label="Application navigation"><div className="eto-nav-label">Workspace</div>{links.map(([label, Icon]) => <a key={label} href={`#${label.toLowerCase().replace(" ", "-")}`} onClick={() => onNavigate(label)} className={`eto-nav-link ${active === label ? "is-active" : ""}`}><Icon size={17} strokeWidth={1.8} />{label}</a>)}</nav>
    <div className="eto-side-foot"><div className="eto-role-box"><div className="eto-role-label"><Eye size={14} />View as role</div><select className="eto-role-select" aria-label="View as role" defaultValue="SuperUser"><option>SuperUser</option><option>Engineering</option><option>Production</option></select><p className="eto-role-note">Uses the selected role&apos;s real permissions.</p></div><div className="eto-user"><div className="eto-user-name">Jordan Mitchell</div><div className="eto-user-role">SuperUser</div></div><button className="eto-signout" onClick={() => onNavigate("Signed out")}><LogOut size={15} />Sign out</button></div>
  </aside>;
}

export function Revamped() {
  const [active, setActive] = useState("Dashboard");
  const [simulation, setSimulation] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [queue, setQueue] = useState(initialQueue);
  const [toast, setToast] = useState("");
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2400); };
  const refresh = () => { setQueue([...initialQueue]); notify("Queue refreshed just now"); };
  return <div className="eto-revamped">
    <Sidebar active={active} onNavigate={(item) => { setActive(item); if (item !== "Dashboard") notify(`${item} is available from the workspace`); }} />
    <main className="eto-main">
      {simulation && <div className="eto-sim-banner"><span><Eye size={15} />Role simulation active: viewing and acting as <strong>SuperUser</strong>. Actions are still recorded under your SuperUser identity.</span><button className="eto-plain-button" onClick={() => setSimulation(false)}>Exit simulation</button></div>}
      <div className="eto-content" id="dashboard">
        <header className="eto-page-head"><div><p className="eto-eyebrow">Operations / overview</p><h1>Dashboard</h1><p className="eto-welcome">Welcome back, Jordan. Here is the current ETO workload.</p></div><div className="eto-head-actions"><span className="eto-role-context">Role: <strong>SuperUser</strong></span><button className="eto-primary-button" onClick={() => notify("New ETO request started")}><Plus size={16} />New request</button></div></header>
        <section className="eto-kpis" aria-label="ETO summary"><Kpi title="Open ETOs" value={28} Icon={ClipboardList} /><Kpi title="Won" value={146} Icon={CheckCircle} /><Kpi title="Declined" value={19} Icon={XCircle} /><Kpi title="Lost" value={12} Icon={TrendingDown} /><Kpi title="Historic Info Requests" value={37} Icon={RefreshCw} /><Kpi title="Overdue" value={4} Icon={AlertTriangle} alert /></section>
        <section className="eto-card eto-section"><div className="eto-section-head"><h2 className="eto-section-title"><GitBranch size={17} />Stage Pipeline</h2><span className="eto-section-meta">28 open requests</span></div><div className="eto-pipeline">{stages.map(([label, count]) => <div className="eto-stage" key={label}><span className="eto-stage-label">{label}</span><strong className="eto-stage-count">{count}</strong></div>)}</div></section>
        <div className="eto-analysis eto-section"><section className="eto-card"><div className="eto-section-head"><h2 className="eto-section-title"><AlertTriangle size={17} />Declines by Stage</h2><span className="eto-section-meta">Last 30 days</span></div><div className="eto-bars">{declines.map(([label, count, tone]) => <div className="eto-bar-row" key={label}><span className="eto-bar-name">{label}</span><div className="eto-bar-track"><div className={`eto-bar-fill ${tone}`} style={{ width: `${count * 16}%` }} /></div><strong className="eto-bar-value">{count}</strong></div>)}</div></section><section className="eto-card"><div className="eto-section-head"><h2 className="eto-section-title"><Clock3 size={17} />Avg Time per Stage</h2><span className="eto-section-meta">Current quarter</span></div><div className="eto-bars">{timings.map(([label, time, pct, tone]) => <div className="eto-bar-row" key={label}><span className="eto-bar-name">{label}</span><div className="eto-bar-track"><div className={`eto-bar-fill ${tone}`} style={{ width: `${pct}%` }} /></div><strong className="eto-bar-value">{time}</strong></div>)}</div></section></div>
        <section className="eto-card eto-section" id="queue"><div className="eto-section-head eto-queue-head"><h2 className="eto-section-title"><ClipboardList size={17} />My Queue</h2><button className="eto-plain-button" onClick={refresh}><RefreshCw size={13} /> Refresh</button></div><div style={{ overflowX: "auto" }}><table className="eto-queue-table"><thead><tr><th>ETO #</th><th>Customer</th><th>Test type</th><th>Stage</th><th>Updated</th></tr></thead><tbody>{queue.map((item) => <tr key={item.number} className={selected === item.number ? "is-selected" : ""} onClick={() => setSelected(item.number)}><td><a className="eto-queue-link" href={`#${item.number}`}>{item.number}</a>{item.family && <div className="eto-subline"><span className="eto-split">Split {item.family}</span><a href="#family" className="eto-family">View family</a><span>{item.position}</span></div>}</td><td>{item.customer}</td><td style={{ color: "var(--eto-muted)" }}>{item.type}</td><td><Status label={item.stage} /></td><td className="eto-updated">{item.updated}</td></tr>)}</tbody></table></div></section>
      </div>
    </main>
    {toast && <div className="eto-toast" role="status">{toast}</div>}
  </div>;
}