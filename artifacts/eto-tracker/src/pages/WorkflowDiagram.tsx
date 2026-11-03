import { useRef, useCallback } from "react";
import { Download } from "lucide-react";

// ── Colour palette ──────────────────────────────────────────────────────────
const COLORS = {
  sales: { bg: "#FEF3C7", border: "#D97706", text: "#92400E", label: "#D97706" },
  art: { bg: "#DBEAFE", border: "#1E3A5F", text: "#1E3A5F", label: "#1E40AF" },
  engineering: { bg: "#D1FAE5", border: "#065F46", text: "#065F46", label: "#065F46" },
  production: { bg: "#EDE9FE", border: "#5B21B6", text: "#3B0764", label: "#5B21B6" },
  terminal: { bg: "#F1F5F9", border: "#475569", text: "#1E293B", label: "#475569" },
} as const;

type Role = keyof typeof COLORS;

// ── SVG helpers ─────────────────────────────────────────────────────────────
interface NodeProps {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  sublabel?: string;
  role: Role;
  rx?: number;
}

function StageNode({ x, y, width, height, label, sublabel, role, rx = 10 }: NodeProps) {
  const c = COLORS[role];
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={rx}
        fill={c.bg}
        stroke={c.border}
        strokeWidth={2}
      />
      <text
        x={x + width / 2}
        y={y + height / 2 - (sublabel ? 8 : 0)}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={c.text}
        fontSize={13}
        fontWeight="700"
        fontFamily="system-ui, sans-serif"
      >
        {label}
      </text>
      {sublabel && (
        <text
          x={x + width / 2}
          y={y + height / 2 + 10}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={c.text}
          fontSize={10.5}
          fontFamily="system-ui, sans-serif"
          opacity={0.75}
        >
          {sublabel}
        </text>
      )}
    </g>
  );
}

interface ArrowProps {
  d: string;
  label?: string;
  labelX?: number;
  labelY?: number;
  color?: string;
  dashed?: boolean;
}

function Arrow({ d, label, labelX, labelY, color = "#64748B", dashed }: ArrowProps) {
  const id = `arr-${Math.random().toString(36).slice(2, 7)}`;
  return (
    <g>
      <defs>
        <marker id={id} markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill={color} />
        </marker>
      </defs>
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeDasharray={dashed ? "5,4" : undefined}
        markerEnd={`url(#${id})`}
      />
      {label && labelX !== undefined && labelY !== undefined && (
        <>
          <text
            x={labelX}
            y={labelY}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#F8FAFC"
            stroke="#F8FAFC"
            strokeWidth={4}
            strokeLinejoin="round"
            fontSize={10.5}
            fontFamily="system-ui, sans-serif"
            fontStyle="italic"
            fontWeight="500"
          >
            {label}
          </text>
          <text
            x={labelX}
            y={labelY}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={color}
            fontSize={10.5}
            fontFamily="system-ui, sans-serif"
            fontStyle="italic"
            fontWeight="500"
          >
            {label}
          </text>
        </>
      )}
    </g>
  );
}

// ── Layout constants ─────────────────────────────────────────────────────────
const W = 1260;
const H = 760;

// node geometry
const NW = 148;
const NH = 56;
const TERM_W = 120;

// Grid layout (U-shape flow)
const COL1 = 180;
const COL2 = 480;
const COL3 = 780;
const COL4 = 1080;

const ROW1 = 180;
const ROW_MID = 360;
const ROW2 = 540;

const ROW_WON = ROW2 - 70;
const ROW_LOST = ROW2 + 70;

// helper: left/right/top/bot of a node at cx, cy
const left = (cx: number, w = NW) => cx - w / 2;
const right = (cx: number, w = NW) => cx + w / 2;
const top = (cy: number, h = NH) => cy - h / 2;
const bot = (cy: number, h = NH) => cy + h / 2;

export default function WorkflowDiagram() {
  const svgRef = useRef<SVGSVGElement>(null);

  const handleDownload = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;

    // Clone so we can embed fonts + set explicit dimensions
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(W));
    clone.setAttribute("height", String(H));

    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(clone);
    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "eto-workflow-diagram.svg";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  return (
    <div className="p-6 max-w-[1320px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">ETO Workflow</h1>
          <p className="text-sm text-slate-500 mt-1">
            How an Engineer-To-Order request moves from draft to close through one required sequence with adjacent backward actions.
          </p>
        </div>
        <button
          onClick={handleDownload}
          className="flex items-center gap-2 rounded-lg bg-[#1E3A5F] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#162d4a] transition-colors shrink-0"
        >
          <Download className="h-4 w-4" />
          Download diagram
        </button>
      </div>

      {/* Diagram card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          style={{ minWidth: 800, display: "block" }}
          fontFamily="system-ui, -apple-system, sans-serif"
        >
          {/* ── Background ── */}
          <rect width={W} height={H} fill="#F8FAFC" />

          {/* ── ARROWS ── */}

          {/* 1. Draft <-> ART Review */}
          <Arrow d="M 254,168 L 406,168" label="submit" labelX={330} labelY={158} color={COLORS.sales.border} />
          <Arrow d="M 406,192 L 254,192" label="return-draft" labelX={330} labelY={202} color={COLORS.art.border} />

          {/* 2. ART Review <-> Engineering */}
          <Arrow d="M 554,168 L 706,168" label="approve-engineering" labelX={630} labelY={158} color={COLORS.art.border} />
          <Arrow d="M 706,192 L 554,192" label="engineering-return-art" labelX={630} labelY={202} color={COLORS.engineering.border} />

          {/* 3. Engineering <-> Production */}
          <Arrow d="M 854,165 Q 1095,165 1095,332" label="engineering-quote-ready" labelX={980} labelY={160} color={COLORS.engineering.border} />
          <Arrow d="M 1065,332 Q 1065,195 854,195" label="production-return-engineering" labelX={980} labelY={225} color={COLORS.production.border} />

          {/* 4. Production <-> ART Final */}
          <Arrow d="M 1065,388 Q 1065,525 854,525" label="production-approve" labelX={980} labelY={515} color={COLORS.production.border} />
          <Arrow d="M 854,555 Q 1095,555 1095,388" label="art-final-return-production" labelX={980} labelY={570} color={COLORS.art.border} />
          <Arrow d="M 740,512 L 740,208" label="art-final-return-engineering" labelX={650} labelY={340} color={COLORS.art.border} />

          {/* 5. ART Final <-> Quoted */}
          <Arrow d="M 706,528 L 554,528" label="art-final-quote" labelX={630} labelY={518} color={COLORS.art.border} />
          <Arrow d="M 554,552 L 706,552" label="quoted-return-art-final" labelX={630} labelY={562} color={COLORS.sales.border} />

          {/* 6. Quoted -> Terminals */}
          <Arrow d="M 406,525 L 240,470" label="mark-won" labelX={323} labelY={485} color="#16A34A" />
          <Arrow d="M 406,555 L 240,610" label="mark-lost" labelX={323} labelY={570} color="#EA580C" dashed />

          {/* 7. Declined */}
          <Arrow d="M 480,208 L 480,332" label="decline" labelX={495} labelY={270} color="#DC2626" dashed />
          <Arrow d="M 780,512 Q 780,360 540,360" label="decline" labelX={660} labelY={360} color="#DC2626" dashed />

          {/* ── STAGE NODES ── */}

          {/* Row 1 */}
          <StageNode x={left(COL1)} y={top(ROW1)} width={NW} height={NH} label="Draft" sublabel="Sales submits" role="sales" />
          <StageNode x={left(COL2)} y={top(ROW1)} width={NW} height={NH} label="ART Review" sublabel="Review & assign" role="art" />
          <StageNode x={left(COL3)} y={top(ROW1)} width={NW} height={NH} label="Engineering" sublabel="Review & quote" role="engineering" />

          {/* Middle turnaround */}
          <StageNode x={left(COL4)} y={top(ROW_MID)} width={NW} height={NH} label="Production" sublabel="Approve or adjust" role="production" />

          {/* Row 2 */}
          <StageNode x={left(COL3)} y={top(ROW2)} width={NW} height={NH} label="ART Final" sublabel="Issue quote" role="art" />
          <StageNode x={left(COL2)} y={top(ROW2)} width={NW} height={NH} label="Quoted" sublabel="Sales/ART closes" role="sales" />

          {/* Terminals */}
          <StageNode x={left(COL1, TERM_W)} y={top(ROW_WON)} width={TERM_W} height={NH} label="Won" role="terminal" />
          <StageNode x={left(COL1, TERM_W)} y={top(ROW_LOST)} width={TERM_W} height={NH} label="Lost" role="terminal" />
          <StageNode x={left(COL2, TERM_W)} y={top(ROW_MID)} width={TERM_W} height={NH} label="Declined" role="terminal" />

          {/* ── LEGEND ── */}
          {(() => {
            const legendItems: { role: Role; label: string }[] = [
              { role: "sales", label: "Sales" },
              { role: "art", label: "ART" },
              { role: "engineering", label: "Engineering" },
              { role: "production", label: "Production" },
            ];
            const lx = 960;
            const ly = 580;
            return (
              <g>
                <rect x={lx - 16} y={ly - 20} width={160} height={112} rx={8} fill="white" stroke="#E2E8F0" strokeWidth={1.5} />
                <text x={lx} y={ly - 2} fill="#475569" fontSize={10.5} fontWeight="700" fontFamily="system-ui, sans-serif" letterSpacing="0.05em">ROLE LEGEND</text>
                {legendItems.map(({ role, label }, i) => {
                  const c = COLORS[role];
                  return (
                    <g key={role} transform={`translate(${lx}, ${ly + 16 + i * 20})`}>
                      <rect width={16} height={16} rx={4} fill={c.bg} stroke={c.border} strokeWidth={1.5} />
                      <text x={26} y={12} fill="#334155" fontSize={11} fontFamily="system-ui, sans-serif">{label}</text>
                    </g>
                  );
                })}
              </g>
            );
          })()}

          {/* ── LIFECYCLE EXCEPTIONS NOTE ── */}
          <g transform="translate(180, 680)">
            <rect width="900" height="40" rx="8" fill="#F1F5F9" stroke="#CBD5E1" strokeWidth="1" />
            <text x="450" y="24" textAnchor="middle" fill="#475569" fontSize={12} fontFamily="system-ui, sans-serif">
              <tspan fontWeight="700">Lifecycle Exceptions:</tspan> Any stage can transition to Abandoned. Abandoned requests can be Re-opened to their last active stage.
            </text>
          </g>
        </svg>
      </div>

      {/* Stage reference table */}
      <div className="mt-8 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">Stage Reference</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Stage</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Acting Role</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Available Decisions</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[
                {
                  stage: "Draft",
                  role: "sales",
                  roleLabel: "Sales",
                  decisions: ["submit → ART Review"],
                  notes: "Sales rep creates the ETO and submits for triage.",
                },
                {
                  stage: "ART Review",
                  role: "art",
                  roleLabel: "ART",
                  decisions: [
                    "approve-engineering → Engineering",
                    "return-draft → Draft",
                    "decline → Declined",
                  ],
                  notes: "ART routes the request forward to Engineering, backwards to Draft for corrections, or Declines.",
                },
                {
                  stage: "Engineering",
                  role: "engineering",
                  roleLabel: "Engineering",
                  decisions: [
                    "engineering-quote-ready → Production",
                    "engineering-return-art → ART Review",
                  ],
                  notes: "Engineering reviews and prepares quotes. Can return to ART if out of scope.",
                },
                {
                  stage: "Production",
                  role: "production",
                  roleLabel: "Production",
                  decisions: [
                    "production-approve → ART Final Review",
                    "production-return-engineering → Engineering",
                  ],
                  notes: "Production confirms feasibility. Can push back to Engineering if adjustments are needed.",
                },
                {
                  stage: "ART Final Review",
                  role: "art",
                  roleLabel: "ART",
                  decisions: [
                    "art-final-quote → Quoted",
                    "art-final-return-production → Production",
                    "art-final-return-engineering → Engineering",
                    "decline → Declined",
                  ],
                  notes: "Final gate before quote issuance. Can return to Production, or to Engineering when Engineering Review was completed.",
                },
                {
                  stage: "Quoted",
                  role: "sales",
                  roleLabel: "Sales / ART",
                  decisions: [
                    "mark-won → Won",
                    "mark-lost → Lost",
                    "quoted-return-art-final → ART Final Review",
                  ],
                  notes: "Close-out stage. Either won, lost, or returned for revisions.",
                },
              ].map(({ stage, role, roleLabel, decisions, notes }) => {
                const c = COLORS[role as Role];
                return (
                  <tr key={stage} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-900">{stage}</td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold"
                        style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
                      >
                        {roleLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <ul className="space-y-0.5">
                        {decisions.map((d) => (
                          <li key={d} className="text-slate-600 font-mono text-xs leading-relaxed">{d}</li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs max-w-xs">{notes}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
