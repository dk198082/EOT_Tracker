import { Fragment } from "react";
import { formatDistanceToNow } from "date-fns";
import { Check, X, Minus, Undo2 } from "lucide-react";
import { formatStepDueDate, type ReviewStepSchedule } from "../lib/review-step-dates";

interface StageTransition {
  id: number;
  fromStage: string;
  toStage: string;
  actorName: string;
  actorRole: string;
  decision: string;
  reason?: string | null;
  createdAt: string;
}

interface StageProgressBarProps {
  currentStage: string;
  transitions: StageTransition[];
  includeEngineeringReview: boolean;
  includeProductionReview: boolean;
  reviewSchedule?: ReviewStepSchedule;
}

// The canonical stage sequence (main path)
const STAGE_DEFS = [
  { key: "draft",              label: "Draft",            color: "slate",   optional: false },
  { key: "art-review",         label: "ART Review",       color: "blue",    optional: false },
  { key: "engineering-review", label: "Engineering",      color: "purple",  optional: true },
  { key: "production-review",  label: "Production",       color: "amber",   optional: true },
  { key: "art-final-review",   label: "ART Final Review", color: "cyan",    optional: false },
  { key: "quoted",             label: "Quoted",           color: "green",   optional: false },
] as const;

// Terminal stages appended dynamically
const TERMINAL_STAGES: Record<string, { label: string; color: string }> = {
  won:      { label: "Won",      color: "emerald" },
  declined: { label: "Declined", color: "red"     },
  lost:     { label: "Lost",     color: "orange"  },
  closed:   { label: "Lost",     color: "orange"  },
  abandoned:{ label: "Abandoned", color: "gray"   },
};

// Colour token sets (background, border, text, ring) for each colour
const COLOR_TOKENS: Record<string, {
  done:    string;
  current: string;
  skip:    string;
  dot:     string;
  bar:     string;
  text:    string;
  meta:    string;
}> = {
  slate:   {
    done:    "bg-slate-500  border-slate-500  text-white",
    current: "bg-white      border-slate-500  text-slate-600 ring-4 ring-slate-100",
    skip:    "bg-slate-100  border-slate-200  text-slate-300",
    dot:     "bg-slate-500",
    bar:     "bg-slate-400",
    text:    "text-slate-700",
    meta:    "text-slate-500",
  },
  blue:    {
    done:    "bg-blue-600   border-blue-600   text-white",
    current: "bg-white      border-blue-600   text-blue-600  ring-4 ring-blue-100",
    skip:    "bg-blue-50    border-blue-100   text-blue-200",
    dot:     "bg-blue-600",
    bar:     "bg-blue-400",
    text:    "text-slate-700",
    meta:    "text-slate-500",
  },
  purple:  {
    done:    "bg-purple-600 border-purple-600 text-white",
    current: "bg-white      border-purple-600 text-purple-600 ring-4 ring-purple-100",
    skip:    "bg-purple-50  border-purple-100 text-purple-200",
    dot:     "bg-purple-600",
    bar:     "bg-purple-400",
    text:    "text-slate-700",
    meta:    "text-slate-500",
  },
  amber:   {
    done:    "bg-amber-500  border-amber-500  text-white",
    current: "bg-white      border-amber-500  text-amber-600 ring-4 ring-amber-100",
    skip:    "bg-amber-50   border-amber-100  text-amber-200",
    dot:     "bg-amber-500",
    bar:     "bg-amber-300",
    text:    "text-slate-700",
    meta:    "text-slate-500",
  },
  cyan:    {
    done:    "bg-cyan-600   border-cyan-600   text-white",
    current: "bg-white      border-cyan-600   text-cyan-600  ring-4 ring-cyan-100",
    skip:    "bg-cyan-50    border-cyan-100   text-cyan-200",
    dot:     "bg-cyan-600",
    bar:     "bg-cyan-400",
    text:    "text-slate-700",
    meta:    "text-slate-500",
  },
  green:   {
    done:    "bg-green-600  border-green-600  text-white",
    current: "bg-white      border-green-600  text-green-600 ring-4 ring-green-100",
    skip:    "bg-green-50   border-green-100  text-green-200",
    dot:     "bg-green-600",
    bar:     "bg-green-400",
    text:    "text-slate-700",
    meta:    "text-slate-500",
  },
  emerald: {
    done:    "bg-emerald-600 border-emerald-600 text-white",
    current: "bg-white       border-emerald-600 text-emerald-600 ring-4 ring-emerald-100",
    skip:    "bg-emerald-50  border-emerald-100 text-emerald-200",
    dot:     "bg-emerald-600",
    bar:     "bg-emerald-400",
    text:    "text-slate-700",
    meta:    "text-slate-500",
  },
  red:     {
    done:    "bg-red-600    border-red-600    text-white",
    current: "bg-white      border-red-600    text-red-600   ring-4 ring-red-100",
    skip:    "bg-red-50     border-red-100    text-red-200",
    dot:     "bg-red-600",
    bar:     "bg-red-400",
    text:    "text-slate-700",
    meta:    "text-slate-500",
  },
  orange:  {
    done:    "bg-orange-600 border-orange-600 text-white",
    current: "bg-white       border-orange-600 text-orange-600 ring-4 ring-orange-100",
    skip:    "bg-orange-50    border-orange-100 text-orange-200",
    dot:     "bg-orange-600",
    bar:     "bg-orange-400",
    text:    "text-slate-700",
    meta:    "text-slate-500",
  },
  gray:    {
    done:    "bg-gray-500   border-gray-500   text-white",
    current: "bg-white      border-gray-500   text-gray-600  ring-4 ring-gray-100",
    skip:    "bg-gray-100   border-gray-200   text-gray-300",
    dot:     "bg-gray-500",
    bar:     "bg-gray-300",
    text:    "text-slate-700",
    meta:    "text-slate-500",
  },
};

// Derive the most recent stage departure for a given stage.
// Same-stage legacy loops are excluded because they do not complete or return
// the stage; a later forward departure must replace an earlier Returned state.
function completionFor(stageKey: string, transitions: StageTransition[]) {
  return [...transitions].reverse().find(
    (t) => t.fromStage === stageKey && t.toStage !== stageKey
  ) ?? null;
}

function isBackwardDeparture(stageKey: string, departure: StageTransition | null) {
  const stageOrder: readonly string[] = STAGE_DEFS.map((stage) => stage.key);
  const fromIndex = stageOrder.indexOf(stageKey);
  const toIndex = departure ? stageOrder.indexOf(departure.toStage) : -1;
  return fromIndex >= 0 && toIndex >= 0 && toIndex < fromIndex;
}

// Was this stage ever visited (ETO entered it at some point)?
function wasVisited(stageKey: string, transitions: StageTransition[], currentStage: string) {
  if (stageKey === "draft") return true; // always starts here
  if (currentStage === stageKey) return true;
  return transitions.some(
    (t) => t.toStage === stageKey || t.fromStage === stageKey
  );
}

// Role badge colour
function roleClass(role: string) {
  const map: Record<string, string> = {
    art:         "bg-blue-100 text-blue-700",
    engineering: "bg-purple-100 text-purple-700",
    production:  "bg-amber-100 text-amber-700",
    sales:       "bg-slate-100 text-slate-600",
    admin:       "bg-indigo-100 text-indigo-700",
    superuser:   "bg-indigo-100 text-indigo-700",
  };
  return map[role] ?? "bg-slate-100 text-slate-600";
}

// Friendly decision label
export function transitionDecisionLabel(decision: string, toStage?: string) {
  if (decision === "approve-engineering") {
    if (toStage === "production-review") return "Sent to Production";
    if (toStage === "art-final-review") return "Sent to ART Final Review";
    return "Sent to Engineering";
  }
  if (decision === "engineering-quote-ready" && toStage === "art-final-review") {
    return "Sent to ART Final Review";
  }
  if (decision === "production-return-engineering" && toStage === "art-review") {
    return "Returned to ART Review";
  }
  if (decision === "art-final-return-production") {
    if (toStage === "engineering-review") return "Returned to Engineering";
    if (toStage === "art-review") return "Returned to ART Review";
  }
  if (decision === "art-final-return-engineering") {
    return "Returned to Engineering";
  }

  const map: Record<string, string> = {
    "submit":                 "Submitted",
    "return-draft":           "Returned to Draft",
    "engineering-return-art": "Returned to ART Review",
    "production-return-engineering": "Returned to Engineering",
    "art-final-return-production": "Returned to Production",
    "art-final-return-engineering": "Returned to Engineering",
    "quoted-return-art-final": "Returned to ART Final Review",
    // Historical decisions retained so existing audit history stays readable.
    "approve-production":     "Sent to Production",
    "final-approve":          "Sent to Final Review",
    "decline":                "Declined",
    "more-info-sales":        "Requested More Info",
    "engineering-quote-ready":"Sent to Production",
    "engineering-more-info":  "Requested More Info",
    "production-approve":     "Sent to ART Final Review",
    "production-more-info":   "Requested More Info",
    "art-final-quote":        "Quoted",
    "art-final-send-engineering": "Returned to Engineering",
    "art-final-send-production":  "Returned to Production",
    "mark-won":               "Marked Won",
    "mark-lost":              "Marked Lost",
    "mark-abandoned":         "Marked Abandoned",
    "reopen":                 "Re-opened",
    "split-request":          "Split Request",
  };
  return map[decision] ?? decision;
}

export function StageProgressBar({
  currentStage,
  transitions,
  includeEngineeringReview,
  includeProductionReview,
  reviewSchedule,
}: StageProgressBarProps) {
  // Build the list of stages to display, appending terminal if applicable
  const terminalKey = Object.keys(TERMINAL_STAGES).includes(currentStage)
    ? currentStage
    : null;

  const displayStages: { key: string; label: string; color: string; optional: boolean }[] = [
    ...STAGE_DEFS.map((s) => ({ ...s })),
    ...(terminalKey
      ? [{ key: terminalKey, label: TERMINAL_STAGES[terminalKey].label, color: TERMINAL_STAGES[terminalKey].color, optional: false }]
      : []),
  ];

  // For each stage, calculate its state
  type NodeState = "done" | "current" | "returned" | "upcoming" | "skipped";

  const nodes = displayStages.map((stage) => {
    const included =
      stage.key === "engineering-review"
        ? includeEngineeringReview
        : stage.key === "production-review"
          ? includeProductionReview
          : true;
    const visited = wasVisited(stage.key, transitions, currentStage);
    const completion = completionFor(stage.key, transitions);
    const latestDeparture = completion;
    const returned = isBackwardDeparture(stage.key, latestDeparture);
    const isCurrent = currentStage === stage.key;
    const skipped = stage.optional && !included && !isCurrent;

    // Terminal stages: if current = this stage, it's "done" visually (no further transitions)
    const isTerminal = stage.key in TERMINAL_STAGES;

    let state: NodeState;
    if (isCurrent && isTerminal) {
      state = "done";
    } else if (isCurrent) {
      state = "current";
    } else if (skipped) {
      // The latest ART choice controls the optional-stage visual, even when
      // that stage was visited or returned from earlier in the request.
      state = "skipped";
    } else if (returned) {
      state = "returned";
    } else if (completion) {
      state = "done";
    } else if (visited) {
      state = "current"; // In this stage but no completion yet (shouldn't happen for non-current, but safe)
    } else {
      // Not yet visited
      state = "upcoming";
    }

    return {
      ...stage,
      state,
      completion,
      returnedTransition: state === "returned" ? latestDeparture : null,
    };
  });

  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-5 sm:px-8 lg:px-12 overflow-x-auto">
      <div
        className="grid w-full min-w-[760px] items-start"
        style={{ gridTemplateColumns: `repeat(${nodes.length * 2 - 1}, minmax(0, 1fr))` }}
      >
        {nodes.map((node, i) => {
          const tokens = COLOR_TOKENS[node.color] ?? COLOR_TOKENS.slate;
          const isLast = i === nodes.length - 1;
          const nextNode = nodes[i + 1];

          // Connector line is "filled" when THIS stage is done
          const connectorFilled = node.state === "done";

          return (
            <Fragment key={node.key}>
              {/* Stage node */}
              <div className="flex min-w-0 flex-col items-center">
                {/* Circle */}
                <div className="relative flex items-center justify-center">
                  {node.state === "current" && (
                    <span
                      className={`absolute inset-0 rounded-full animate-ping opacity-30 ${tokens.dot}`}
                      style={{ animationDuration: "2s" }}
                    />
                  )}
                  <div
                    className={`relative w-9 h-9 rounded-full border-2 flex items-center justify-center transition-all ${
                      node.state === "done"
                        ? tokens.done
                         : node.state === "returned"
                         ? `${tokens.current} ring-2`
                        : node.state === "current"
                        ? tokens.current
                        : node.state === "skipped"
                        ? tokens.skip
                        : "bg-slate-50 border-slate-200 text-slate-300"
                    }`}
                  >
                    {node.state === "returned" ? (
                      <Undo2 className="h-4 w-4" aria-label="Returned" />
                    ) : node.state === "done" && (node.key === "declined" || node.key === "lost" || node.key === "closed") ? (
                      <X className="h-4 w-4" />
                    ) : node.state === "done" ? (
                      <Check className="h-4 w-4" />
                    ) : node.state === "skipped" ? (
                      <Minus className="h-3 w-3" />
                    ) : node.state === "current" ? (
                      <div className={`w-2.5 h-2.5 rounded-full ${tokens.dot}`} />
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-slate-200" />
                    )}
                  </div>
                </div>

                {/* Label */}
                <p
                  className={`mt-2 text-xs font-semibold text-center leading-tight ${
                    node.state === "done" || node.state === "returned" || node.state === "current"
                      ? tokens.text
                      : "text-slate-300"
                  }`}
                >
                  {node.label}
                  {node.optional && node.state === "skipped" && (
                    <span className="block text-[10px] font-normal text-slate-300">skipped</span>
                  )}
                </p>
                {reviewSchedule && ["engineering-review", "production-review", "art-final-review"].includes(node.key) && (
                  <p className="mt-1 text-[10px] text-center text-slate-500 leading-tight">
                    {(() => {
                      const included = node.key === "engineering-review" ? reviewSchedule.includeEngineering
                        : node.key === "production-review" ? reviewSchedule.includeProduction : true;
                      const date = node.key === "engineering-review" ? reviewSchedule.engineering
                        : node.key === "production-review" ? reviewSchedule.production : reviewSchedule.artFinal;
                      return !included ? "Not scheduled"
                        : date ? `Due ${formatStepDueDate(date)}` : "Due date not set";
                    })()}
                  </p>
                )}

                {/* Completion metadata */}
                {(node.state === "done" || node.state === "returned") && (node.completion || node.returnedTransition) && (
                  <div className="mt-1.5 flex flex-col items-center gap-0.5 text-center">
                    {(() => {
                      const metadata = node.returnedTransition ?? node.completion;
                      if (!metadata) return null;
                      return (
                        <>
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium leading-tight ${roleClass(metadata.actorRole)}`}
                    >
                      {metadata.actorName}
                    </span>
                    <span className="text-[10px] text-slate-400 leading-tight">
                      {transitionDecisionLabel(metadata.decision, metadata.toStage)}
                    </span>
                    <span className="text-[10px] text-slate-400 leading-tight">
                      {formatDistanceToNow(new Date(metadata.createdAt), { addSuffix: true })}
                    </span>
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* Current stage — show "In progress" */}
                {node.state === "current" && !Object.keys(TERMINAL_STAGES).includes(node.key) && (
                  <div className="mt-1.5 flex flex-col items-center gap-0.5">
                    <span className={`text-[10px] font-medium ${tokens.meta}`}>In progress</span>
                  </div>
                )}

                {/* Terminal (won/declined/lost/abandoned) — show who + when */}
                {node.state === "done" && !node.completion && Object.keys(TERMINAL_STAGES).includes(node.key) && (
                  (() => {
                    // Find the transition that arrived at this terminal stage
                    const arrival = [...transitions]
                      .reverse()
                      .find((t) => t.toStage === node.key);
                    return arrival ? (
                      <div className="mt-1.5 flex flex-col items-center gap-0.5 text-center">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium leading-tight ${roleClass(arrival.actorRole)}`}
                        >
                          {arrival.actorName}
                        </span>
                        <span className="text-[10px] text-slate-400 leading-tight">
                          {transitionDecisionLabel(arrival.decision, arrival.toStage)}
                        </span>
                        <span className="text-[10px] text-slate-400 leading-tight">
                          {formatDistanceToNow(new Date(arrival.createdAt), { addSuffix: true })}
                        </span>
                      </div>
                    ) : null;
                  })()
                )}
              </div>

              {/* Connector line between nodes */}
              {!isLast && (
                <div className="flex min-w-0 items-center justify-center mt-4 px-1">
                  <div
                    className={`h-0.5 w-full transition-colors ${
                      connectorFilled
                        ? nextNode?.state === "skipped"
                          ? "bg-slate-200"
                          : tokens.bar
                        : "bg-slate-200"
                    }`}
                  />
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
      <p className="sm:hidden mt-3 text-[10px] text-slate-500">Swipe to view all workflow steps.</p>
    </div>
  );
}
