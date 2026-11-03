const stageStyles: Record<string, string> = {
  "draft": "bg-slate-100 text-slate-600",
  "art-review": "bg-blue-100 text-blue-700",
  "engineering-review": "bg-purple-100 text-purple-700",
  "production-review": "bg-amber-100 text-amber-700",
  "art-final-review": "bg-cyan-100 text-cyan-700",
  "quoted": "bg-green-100 text-green-700",
  "won": "bg-emerald-100 text-emerald-700",
  "declined": "bg-red-100 text-red-700",
  "lost": "bg-orange-100 text-orange-700",
  "closed": "bg-orange-100 text-orange-700",
  "abandoned": "bg-slate-200 text-slate-700",
};

const stageLabels: Record<string, string> = {
  "draft": "Draft",
  "art-review": "ART Review",
  "engineering-review": "Engineering Review",
  "production-review": "Production Review",
  "art-final-review": "ART Final Review",
  "quoted": "Quoted",
  "won": "Won",
  "declined": "Declined",
  "lost": "Lost",
  "closed": "Lost",
  "abandoned": "Abandoned",
};

interface StagePillProps {
  stage: string;
  className?: string;
}

export function StagePill({ stage, className = "" }: StagePillProps) {
  const style = stageStyles[stage] ?? "bg-slate-100 text-slate-600";
  const label = stageLabels[stage] ?? stage;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${style} ${className}`}>
      {label}
    </span>
  );
}

export { stageLabels, stageStyles };
