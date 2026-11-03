/**
 * ETO Tracker Workflow State Machine
 *
 * Stages: draft → art-review → engineering-review → production-review
 *         → art-final-review → quoted → won | lost
 *         ART review gates may instead end as declined; active stages may be abandoned.
 *
 * Every active stage has one forward action and, after Draft, one adjacent
 * backward action. Abandon/Reopen remain separate lifecycle controls.
 */

import type { EtoStage } from "@workspace/db";
import { isSuperUser } from "./roles";

export type Decision =
  // Sales
  | "submit"
  // ART review
  | "approve-engineering"
  | "return-draft"
  | "decline"
  // Engineering
  | "engineering-quote-ready"
  | "engineering-return-art"
  // Production
  | "production-approve"
  | "production-return-engineering"
  // ART final
  | "art-final-quote"
  | "art-final-return-production"
  | "art-final-return-engineering"
  // Quoted close-out
  | "mark-won"
  | "mark-lost"
  | "quoted-return-art-final"
  // ART/SuperUser lifecycle controls
  | "mark-abandoned"
  | "reopen";

export interface TransitionResult {
  /** Next stage */
  toStage: EtoStage;
  /** Retained for API compatibility; linear actions are always false. */
  isMoreInfoLoop: boolean;
}

export interface WorkflowOptions {
  includeEngineeringReview?: boolean;
  includeProductionReview?: boolean;
  restoreStage?: EtoStage;
}

const ALLOWED: Record<EtoStage, Decision[]> = {
  draft: ["submit", "mark-abandoned"],
  "art-review": [
    "approve-engineering",
    "return-draft",
    "decline",
    "mark-abandoned",
  ],
  "engineering-review": [
    "engineering-quote-ready",
    "engineering-return-art",
    "mark-abandoned",
  ],
  "production-review": [
    "production-approve",
    "production-return-engineering",
    "mark-abandoned",
  ],
  "art-final-review": [
    "art-final-quote",
    "art-final-return-production",
    "art-final-return-engineering",
    "decline",
    "mark-abandoned",
  ],
  quoted: ["mark-won", "mark-lost", "quoted-return-art-final", "mark-abandoned"],
  won: [],
  declined: [],
  lost: [],
  abandoned: ["reopen"],
  closed: [], // legacy-only terminal value
};

function advance(stage: EtoStage, decision: Decision, options: WorkflowOptions): TransitionResult {
  const includeEngineering = options.includeEngineeringReview ?? true;
  const includeProduction = options.includeProductionReview ?? true;

  switch (stage) {
    case "draft":
      if (decision === "submit") return { toStage: "art-review", isMoreInfoLoop: false };
      if (decision === "mark-abandoned") return { toStage: "abandoned", isMoreInfoLoop: false };
      break;

    case "art-review":
      if (decision === "approve-engineering") {
        const toStage = includeEngineering
          ? "engineering-review"
          : includeProduction
            ? "production-review"
            : "art-final-review";
        return { toStage, isMoreInfoLoop: false };
      }
      if (decision === "return-draft") return { toStage: "draft", isMoreInfoLoop: false };
      if (decision === "decline") return { toStage: "declined", isMoreInfoLoop: false };
      if (decision === "mark-abandoned") return { toStage: "abandoned", isMoreInfoLoop: false };
      break;

    case "engineering-review":
      if (decision === "engineering-quote-ready") {
        return {
          toStage: includeProduction ? "production-review" : "art-final-review",
          isMoreInfoLoop: false,
        };
      }
      if (decision === "engineering-return-art") return { toStage: "art-review", isMoreInfoLoop: false };
      if (decision === "mark-abandoned") return { toStage: "abandoned", isMoreInfoLoop: false };
      break;

    case "production-review":
      if (decision === "production-approve") return { toStage: "art-final-review", isMoreInfoLoop: false };
      if (decision === "production-return-engineering") {
        return {
          toStage: includeEngineering ? "engineering-review" : "art-review",
          isMoreInfoLoop: false,
        };
      }
      if (decision === "mark-abandoned") return { toStage: "abandoned", isMoreInfoLoop: false };
      break;

    case "art-final-review":
      if (decision === "art-final-quote") return { toStage: "quoted", isMoreInfoLoop: false };
      if (decision === "art-final-return-production") {
        const toStage = includeProduction
          ? "production-review"
          : includeEngineering
            ? "engineering-review"
            : "art-review";
        return { toStage, isMoreInfoLoop: false };
      }
      if (decision === "art-final-return-engineering") {
        return { toStage: "engineering-review", isMoreInfoLoop: false };
      }
      if (decision === "decline") return { toStage: "declined", isMoreInfoLoop: false };
      if (decision === "mark-abandoned") return { toStage: "abandoned", isMoreInfoLoop: false };
      break;

    case "quoted":
      if (decision === "mark-won") return { toStage: "won", isMoreInfoLoop: false };
      if (decision === "mark-lost") return { toStage: "lost", isMoreInfoLoop: false };
      if (decision === "quoted-return-art-final") return { toStage: "art-final-review", isMoreInfoLoop: false };
      if (decision === "mark-abandoned") return { toStage: "abandoned", isMoreInfoLoop: false };
      break;

    case "abandoned":
      if (decision === "reopen" && options.restoreStage && options.restoreStage !== "abandoned") {
        return { toStage: options.restoreStage, isMoreInfoLoop: false };
      }
      break;

    default:
      break;
  }

  throw new Error(`Decision "${decision}" is not valid from stage "${stage}"`);
}

export function validateAndAdvance(
  stage: EtoStage,
  decision: Decision,
  actorRole: string,
  options: WorkflowOptions | EtoStage = {},
): TransitionResult {
  const normalizedOptions: WorkflowOptions =
    typeof options === "string" ? { restoreStage: options } : options;
  const allowed = ALLOWED[stage] ?? [];
  if (!allowed.includes(decision)) {
    throw new Error(`Decision "${decision}" is not allowed from stage "${stage}"`);
  }

  // Role-based guard
  const roleGuards: Partial<Record<Decision, string[]>> = {
    submit: ["sales", "art"],
    "approve-engineering": ["art"],
    "return-draft": ["art"],
    decline: ["art"],
    "engineering-quote-ready": ["engineering"],
    "engineering-return-art": ["engineering"],
    "production-approve": ["production"],
    "production-return-engineering": ["production"],
    "art-final-quote": ["art"],
    "art-final-return-production": ["art"],
    "art-final-return-engineering": ["art"],
    "mark-won": ["sales", "art"],
    "mark-lost": ["sales", "art"],
    "quoted-return-art-final": ["sales", "art"],
    "mark-abandoned": ["art"],
    reopen: ["art"],
  };

  const allowed_roles = roleGuards[decision];
  if (allowed_roles && !isSuperUser(actorRole) && !allowed_roles.includes(actorRole)) {
    throw new Error(
      `Role "${actorRole}" is not allowed to make decision "${decision}"`,
    );
  }

  return advance(stage, decision, normalizedOptions);
}
