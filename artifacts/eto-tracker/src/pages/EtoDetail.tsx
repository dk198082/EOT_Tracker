import { useState, useRef, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetEtoRequest,
  useListTransitions,
  useListComments,
  useCreateComment,
  useSubmitTransition,
  useGetEngineeringOutput,
  useGetProductionOutput,
  useGetArtFinalOutput,
  useGetMe,
  useListUsers,
  useGetReviewAssignmentDefaults,
  getGetReviewAssignmentDefaultsQueryKey,
  useListAttachments,
  useCreateAttachment,
  useDeleteAttachment,
  useRequestUploadUrl,
  useUpdateEtoRequest,
  useUpsertEngineeringOutput,
  useUpsertProductionOutput,
  useUpsertArtFinalOutput,
  useListDetailChanges,
  useSplitEtoRequest,
  getAttachmentDownloadUrl,
  getGetEtoRequestQueryKey,
  getGetEngineeringOutputQueryKey,
  getGetProductionOutputQueryKey,
  getGetArtFinalOutputQueryKey,
  getListTransitionsQueryKey,
  getListCommentsQueryKey,
  getListAttachmentsQueryKey,
  getListDetailChangesQueryKey,
  getListEtoRequestsQueryKey,
} from "@workspace/api-client-react";
import type { TransitionInput, Attachment, DetailChange, EtoRequest, EngineeringOutput, ProductionOutput, ArtFinalOutput } from "@workspace/api-client-react";
import type { UppyFile } from "@uppy/core";
import { ObjectUploader } from "@workspace/object-storage-web";
import { toast } from "sonner";
import { PriceCalculator } from "@/components/PriceCalculator";
import { etoLabel } from "@/lib/eto-label";
import { calculateReviewStepDates, type ReviewStepSchedule } from "@/lib/review-step-dates";
import type { SalesPriceSuggestion } from "@/lib/price-calculation";
import { calculateLeadTime, type ReviewLeadTimes } from "@/lib/lead-time-calculation";
import { StagePill } from "@/components/StagePill";
import { AssignedProductionNote } from "@/components/AssignedProductionNote";
import { ReassignReview } from "@/components/ReassignReview";
import { EmailAuditTrail } from "@/components/EmailAuditTrail";
import { RiskScoreFields, type SelectedRiskScore } from "@/components/RiskScoreFields";
import { ReviewScheduleFields, validReviewDurations, formatCalendarDate } from "@/components/ReviewScheduleFields";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/MoneyInput";
import { formatMoney, formatHistoryMoney, moneyInputValue, isWholeMoney, isWholeBudget } from "@/lib/money";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, MessageSquare, Paperclip, Clock, Loader2, Download, Trash2, ExternalLink, Pencil, GitBranch } from "lucide-react";
import { StageProgressBar, transitionDecisionLabel } from "@/components/StageProgressBar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDistanceToNow, format } from "date-fns";
import { shouldShowArtFinalReturnToEngineering } from "@/lib/artFinalActions";

interface EtoDetailProps {
  id: number;
}

// Stages considered "past" a given stage
const STAGE_ORDER = [
  "draft",
  "art-review",
  "engineering-review",
  "production-review",
  "art-final-review",
  "quoted",
  "won",
  "declined",
  "lost",
];

function stageIndex(s: string) {
  return STAGE_ORDER.indexOf(s);
}

function isPastStage(currentStage: string, checkStage: string) {
  return stageIndex(currentStage) > stageIndex(checkStage);
}

export default function EtoDetail({ id }: EtoDetailProps) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [calculatorSuggestion, setCalculatorSuggestion] = useState<{ etoId: number; price: SalesPriceSuggestion | null } | null>(null);
  const handleSalesPriceChange = useCallback((price: SalesPriceSuggestion | null) => {
    setCalculatorSuggestion({ etoId: id, price });
  }, [id]);
  const suggestedPrice = calculatorSuggestion?.etoId === id ? calculatorSuggestion.price : null;

  const { data: eto, isLoading: etoLoading, error: etoError } = useGetEtoRequest(id, {
    query: { refetchInterval: 30_000, queryKey: getGetEtoRequestQueryKey(id) },
  });
  const { data: transitions } = useListTransitions(id);
  const { data: comments } = useListComments(id);
  const { data: me } = useGetMe();
  const { data: attachments } = useListAttachments(id);

  // Conditional output queries
  const showEngOutput = eto?.archived || (transitions?.some(
    (transition) => transition.decision === "engineering-quote-ready",
  ) ?? false);
  const showProdOutput = eto?.archived || (transitions?.some(
    (transition) => transition.decision === "production-approve",
  ) ?? false);
  const showArtFinalOutput = eto?.archived || (
    (transitions?.some((transition) => transition.decision === "art-final-quote") ?? false)
    || (eto ? isPastStage(eto.stage, "art-final-review") : false)
  );

  const { data: engOutput, isLoading: engOutputLoading, error: engOutputError } = useGetEngineeringOutput(id, {
    query: { enabled: showEngOutput || eto?.stage === "art-final-review", queryKey: getGetEngineeringOutputQueryKey(id) },
  });
  const { data: prodOutput, isLoading: prodOutputLoading, error: prodOutputError } = useGetProductionOutput(id, {
    query: { enabled: showProdOutput || eto?.stage === "art-final-review", queryKey: getGetProductionOutputQueryKey(id) },
  });
  const { data: artFinalOutput, isLoading: artFinalOutputLoading } = useGetArtFinalOutput(id, {
    query: { enabled: showArtFinalOutput, queryKey: getGetArtFinalOutputQueryKey(id) },
  });

  const leadTimes: ReviewLeadTimes = {
    design: { value: engOutput?.designLeadTimeWeeks, loading: engOutputLoading, error: !!engOutputError && engOutputError.status !== 404 },
    procurement: { value: prodOutput?.procurementLeadTime, loading: prodOutputLoading, error: !!prodOutputError && prodOutputError.status !== 404 },
    assembly: { value: prodOutput?.assemblyLeadTimeWeeks, loading: prodOutputLoading, error: !!prodOutputError && prodOutputError.status !== 404 },
  };
  const suggestedLeadTime = calculateLeadTime(leadTimes)?.roundedWeeks ?? null;

  const { data: detailChanges } = useListDetailChanges(id);
  const auditCurrencies = {
    "request:Budget Currency": eto?.budgetCurrency ?? "USD",
    "engineering:Cost Estimate Currency": engOutput?.costEstimateCurrency ?? "USD",
    "production:Procurement Cost Currency": prodOutput?.procurementCostCurrency ?? "USD",
    "production:Assembly Cost Currency": prodOutput?.assemblyCostCurrency ?? "USD",
    "art-final:Market Price Currency": artFinalOutput?.marketPriceCurrency ?? "USD",
  };

  const { mutate: createComment, isPending: commentPending } = useCreateComment();
  const { mutate: submitTransition, isPending: transitionPending } = useSubmitTransition();
  const { mutate: createAttachment } = useCreateAttachment();
  const { mutateAsync: requestUploadUrl } = useRequestUploadUrl();
  const { mutate: splitEtoRequest, isPending: splitPending } = useSplitEtoRequest();

  const userRole = me?.role ?? "";

  // Map from Uppy file ID → objectPath (populated during onGetUploadParameters)
  const objectPathMap = useRef<Map<string, string>>(new Map());

  const [commentBody, setCommentBody] = useState("");

  function handlePostComment() {
    if (!commentBody.trim()) return;
    createComment(
      { id, data: { body: commentBody.trim() } },
      {
        onSuccess: () => {
          setCommentBody("");
          qc.invalidateQueries({ queryKey: getListCommentsQueryKey(id) });
        },
        onError: () => toast.error("Failed to post comment"),
      }
    );
  }

  function handleTransition(data: TransitionInput) {
    submitTransition(
      { id, data },
      {
        onSuccess: (updated) => {
          toast.success(`ETO moved to ${updated.stage}`);
          qc.invalidateQueries({ queryKey: getGetEtoRequestQueryKey(id) });
          qc.invalidateQueries({ queryKey: getListTransitionsQueryKey(id) });
        },
        onError: () => {
          qc.invalidateQueries({ queryKey: getGetEtoRequestQueryKey(id) });
          qc.invalidateQueries({ queryKey: getListTransitionsQueryKey(id) });
          toast.error("Failed to submit workflow action. The request may have changed; please try again.");
        },
      }
    );
  }

  function handleSplit(count: number) {
    splitEtoRequest(
      { id, data: { count } },
      {
        onSuccess: (result) => {
          toast.success(
            `Created ${result.children.length} linked ETO requests: ${result.children
              .map((child) => child.etoNumber)
              .join(", ")}`,
          );
          qc.invalidateQueries({ queryKey: getGetEtoRequestQueryKey(id) });
          qc.invalidateQueries({ queryKey: getListTransitionsQueryKey(id) });
          qc.invalidateQueries({ queryKey: getListEtoRequestsQueryKey() });
        },
        onError: () => {
          qc.invalidateQueries({ queryKey: getGetEtoRequestQueryKey(id) });
          toast.error("Failed to split this request. It may have changed; refresh and try again.");
        },
      },
    );
  }

  if (etoLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64 rounded" />
        <Skeleton className="h-64 w-full rounded" />
      </div>
    );
  }

  if (!eto) {
    return (
      <div className="p-6 text-center text-slate-500">
        <p>{etoError?.status === 409 ? "This link or session is from before the database change. Reload and open the correct version from the ETO list."
          : etoError?.status === 503 ? "The archive schema is unavailable. No changes can be saved."
          : "ETO request not found."}</p>
        <Link href="/eto-requests" className="text-blue-600 hover:underline mt-2 inline-block">
          Back to list
        </Link>
      </div>
    );
  }

  const reviewStepDates = calculateReviewStepDates(eto, transitions ?? []);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/eto-requests")}
          className="text-slate-500 hover:text-slate-700 transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex flex-wrap min-w-0 items-center gap-3 flex-1">
          <h1 className="text-2xl font-bold text-slate-900 break-words min-w-0">{etoLabel(eto)}</h1>
          <StagePill stage={eto.stage} />
        </div>
      </div>

      {/* Stage progress bar */}
      {eto.source && (
        <div className={`rounded-lg border p-4 text-sm ${eto.archived ? "border-amber-300 bg-amber-50 text-amber-950" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
          <strong>{eto.archived ? "Archived workspace version — read-only" : `Active ${eto.source} version`}</strong>
          <p>Original {eto.source} record #{eto.sourceId}. {eto.archived && "Its original ETO number, history and files are preserved. No edits, workflow actions, comments, splits, calculator saves or file changes are allowed, including for SuperUsers."}</p>
          {eto.archiveReason && <p>{eto.archiveReason}</p>}
        </div>
      )}
      <StageProgressBar
        currentStage={eto.stage}
        transitions={transitions ?? []}
        includeEngineeringReview={eto.includeEngineeringReview}
        includeProductionReview={eto.includeProductionReview}
        reviewSchedule={reviewStepDates}
      />

      {(eto.parentEtoRequestId || (eto.splitChildren?.length ?? 0) > 0) && (
        <Card className="border-blue-200 bg-blue-50/40">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <GitBranch className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
              <div className="space-y-2 min-w-0">
                <p className="text-sm font-semibold text-slate-800">Linked split requests</p>
                {eto.parentEtoRequestId && eto.parentEtoNumber && (
                  <p className="text-sm text-slate-600">
                    Split from{" "}
                    <Link
                      href={`/eto-requests/${eto.parentEtoRequestId}`}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      {eto.parentEtoNumber}
                    </Link>
                  </p>
                )}
                {eto.splitChildren && eto.splitChildren.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {eto.splitChildren.map((child) => (
                      <Link
                        key={child.id}
                        href={`/eto-requests/${child.id}${child.recordKey ? `?recordKey=${encodeURIComponent(child.recordKey)}` : ""}`}
                        className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-white px-2.5 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50"
                      >
                        {child.etoNumber}
                        <StagePill stage={child.stage} className="text-[10px] !px-1.5 !py-0" />
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT: 2/3 */}
        <div className="lg:col-span-2 space-y-6">
          {/* Request Details */}
          <EditableRequestDetails
            reviewStepDates={reviewStepDates}
            key={`${id}:${userRole}`}
            eto={eto}
            etoId={id}
            canEdit={!eto.archived && (userRole === "art" || userRole === "superuser")}
            onSaved={() => {
              qc.invalidateQueries({ queryKey: getGetEtoRequestQueryKey(id) });
              void qc.refetchQueries({ queryKey: getListDetailChangesQueryKey(id) });
            }}
          />

          {/* Engineering Output */}
          {showEngOutput && engOutput && (
            <EditableEngineeringOutput
              output={engOutput}
              etoId={id}
              canEdit={!eto.archived && (userRole === "engineering" || userRole === "art" || userRole === "superuser")}
              onSaved={() => {
                qc.invalidateQueries({ queryKey: getGetEngineeringOutputQueryKey(id) });
                qc.invalidateQueries({ queryKey: getListDetailChangesQueryKey(id) });
              }}
            />
          )}

          {/* Production Output */}
          {showProdOutput && prodOutput && (
            <EditableProductionOutput
              output={prodOutput}
              etoId={id}
              canEdit={!eto.archived && (userRole === "production" || userRole === "art" || userRole === "superuser")}
              onSaved={() => {
                qc.invalidateQueries({ queryKey: getGetProductionOutputQueryKey(id) });
                qc.invalidateQueries({ queryKey: getListDetailChangesQueryKey(id) });
              }}
            />
          )}

          {/* ART Final Output */}
          {showArtFinalOutput && artFinalOutput && (
            <EditableArtFinalOutput
              output={artFinalOutput}
              etoId={id}
              canEdit={!eto.archived && (userRole === "art" || userRole === "superuser")}
              onSaved={() => {
                qc.invalidateQueries({ queryKey: getGetArtFinalOutputQueryKey(id) });
                qc.invalidateQueries({ queryKey: getListDetailChangesQueryKey(id) });
              }}
            />
          )}

          {/* Comments */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                Comments
                {comments && comments.length > 0 && (
                  <span className="text-xs font-normal text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                    {comments.length}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Comment thread */}
              <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                {!comments || comments.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-4">No comments yet.</p>
                ) : (
                  comments.map((c) => (
                    <div key={c.id} className="bg-slate-50 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-slate-800">{c.authorName}</span>
                          <span className="text-xs text-slate-400 capitalize bg-slate-200 px-1.5 py-0.5 rounded">
                            {c.authorRole}
                          </span>
                          {c.simulatedRole && (
                            <span className="text-xs text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                              acting as {c.simulatedRole}
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-slate-400">
                          {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap">{c.body}</p>
                    </div>
                  ))
                )}
              </div>

              {/* New comment input */}
              {!eto.archived && <div className="space-y-2">
                <Label htmlFor="eto-comment" required>Comment</Label>
                <Textarea
                  id="eto-comment"
                  placeholder="Add a comment..."
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  rows={3}
                  className="resize-none"
                />
                <div className="flex justify-end">
                  <Button
                    onClick={handlePostComment}
                    disabled={!commentBody.trim() || commentPending}
                    size="sm"
                    className="bg-[#1E3A5F] hover:bg-[#162d4a] text-white"
                  >
                    {commentPending && <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />}
                    Post Comment
                  </Button>
                </div>
              </div>}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT: 1/3 */}
        <div className="flex flex-col gap-6">
          {/* Workflow Actions */}
          <Card className="order-1">
            <CardHeader>
              <CardTitle className="text-base font-semibold text-slate-800">Workflow Actions</CardTitle>
            </CardHeader>
            <CardContent>
              {eto.archived && <p className="text-sm text-slate-500">Archived ETOs have no workflow or split actions.</p>}
              {me && !eto.archived && (
                <WorkflowActions
                  key={id}
                  eto={eto}
                  reviewStepDates={reviewStepDates}
                  suggestedPrice={suggestedPrice}
                  suggestedLeadTime={suggestedLeadTime}
                  userRole={me.role}
                  engineeringReviewCompleted={showEngOutput}
                  engineeringOutput={engOutput}
                  productionOutput={prodOutput}
                  artFinalOutput={artFinalOutput}
                  engineeringOutputLoading={showEngOutput && engOutputLoading}
                  productionOutputLoading={showProdOutput && prodOutputLoading}
                  artFinalOutputLoading={showArtFinalOutput && artFinalOutputLoading}
                  onTransition={handleTransition}
                  isPending={transitionPending}
                  onSplit={handleSplit}
                  isSplitPending={splitPending}
                />
              )}
            </CardContent>
          </Card>

          {(eto.archived || eto.stage === "art-final-review") && (
            <PriceCalculator
              key={id}
              etoId={id}
              archived={eto.archived}
              onSalesPriceChange={handleSalesPriceChange}
              leadTimes={leadTimes}
              canEdit={!eto.archived && (me?.role === "art" || me?.role === "superuser")}
              design={{ value: engOutput?.designCost, currency: "USD", loading: engOutputLoading, error: !!engOutputError && engOutputError.status !== 404 }}
              procure={{ value: prodOutput?.procurementCost, currency: prodOutput?.procurementCostCurrency ?? "USD", loading: prodOutputLoading, error: !!prodOutputError && prodOutputError.status !== 404 }}
              assembly={{ value: prodOutput?.assemblyCost, currency: prodOutput?.assemblyCostCurrency ?? "USD", loading: prodOutputLoading, error: !!prodOutputError && prodOutputError.status !== 404 }}
              engineeringRisk={{ score: engOutput?.riskScore, notes: engOutput?.riskNotes, loading: engOutputLoading, error: !!engOutputError && engOutputError.status !== 404 }}
              productionRisk={{ score: prodOutput?.riskScore, notes: prodOutput?.riskNotes, loading: prodOutputLoading, error: !!prodOutputError && prodOutputError.status !== 404 }}
            />
          )}

          {/* Attachments */}
          <Card className="order-2">
            <CardHeader>
              <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
                <Paperclip className="h-4 w-4" />
                Attachments
                {attachments && attachments.length > 0 && (
                  <span className="text-xs font-normal text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                    {attachments.length}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {attachments && attachments.length > 0 ? (
                <div className="space-y-2">
                  {attachments.map((att) => (
                    <AttachmentRow key={att.id} etoId={id} attachment={att} currentUserId={me?.id} currentUserRole={me?.role} archived={eto.archived} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400 text-center py-2">No attachments yet.</p>
              )}
              {!eto.archived && <ObjectUploader
                maxNumberOfFiles={10}
                maxFileSize={52428800}
                onGetUploadParameters={async (file) => {
                  const { uploadURL, objectPath } = await requestUploadUrl({
                    data: {
                      name: file.name,
                      size: file.size ?? 0,
                      contentType: file.type ?? "application/octet-stream",
                      etoRequestId: id,
                    },
                  });
                  objectPathMap.current.set(file.id, objectPath);
                  return {
                    method: "PUT" as const,
                    url: uploadURL,
                    // headers: { "Content-Type": file.type ?? "application/octet-stream" },
                    headers: {
                              "Content-Type": file.type ?? "application/octet-stream",
                              "x-ms-blob-type": "BlockBlob",
                            },
                  };
                }}
                onComplete={(result) => {
                  const successful = result.successful ?? [];
                  let registered = 0;
                  for (const file of successful) {
                    const objectPath = objectPathMap.current.get(file.id);
                    if (!objectPath) continue;
                    objectPathMap.current.delete(file.id);
                    createAttachment(
                      {
                        id,
                        data: {
                          filename: file.name,
                          storageKey: objectPath,
                          contentType: file.type ?? undefined,
                          fileSize: file.size ?? undefined,
                        },
                      },
                      {
                        onSuccess: () => {
                          registered++;
                          if (registered === successful.length) {
                            qc.invalidateQueries({ queryKey: getListAttachmentsQueryKey(id) });
                            toast.success(
                              registered === 1
                                ? "File attached successfully"
                                : `${registered} files attached`
                            );
                          }
                        },
                        onError: () => toast.error(`Failed to register ${file.name}`),
                      }
                    );
                  }
                }}
                buttonClassName="w-full flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <Paperclip className="h-3.5 w-3.5" />
                Attach Files
              </ObjectUploader>}
            </CardContent>
          </Card>

          {/* Audit Trail */}
          <Card className="order-3">
            <CardHeader>
              <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Audit Trail
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Tabs defaultValue="stage">
                <TabsList className="w-full mb-4">
                  <TabsTrigger value="stage" className="flex-1">
                    Stage
                    {transitions && transitions.length > 0 && (
                      <span className="ml-1.5 text-[10px] bg-slate-200 text-slate-600 rounded-full px-1.5 py-0.5">
                        {transitions.length}
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="details" className="flex-1">
                    Details
                    {detailChanges && detailChanges.length > 0 && (
                      <span className="ml-1.5 text-[10px] bg-slate-200 text-slate-600 rounded-full px-1.5 py-0.5">
                        {detailChanges.length}
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="email" className="flex-1">Email</TabsTrigger>
                </TabsList>

                <TabsContent value="email">
                  <EmailAuditTrail requestId={id} />
                </TabsContent>

                {/* Stage tab */}
                <TabsContent value="stage">
                  {!transitions || transitions.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-4">No transitions yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {[...transitions].reverse().map((t) => (
                        <div key={t.id} className="border-l-2 border-slate-200 pl-3 space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-medium text-slate-700">{t.actorName}</span>
                            <span className="text-xs text-slate-400 capitalize bg-slate-100 px-1.5 py-0.5 rounded">
                              {t.actorRole}
                            </span>
                            {t.simulatedRole && (
                              <span className="text-xs text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                                acting as {t.simulatedRole}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-slate-600">
                            <StagePill stage={t.fromStage} className="text-[10px] !px-1.5 !py-0" />
                            <span className="text-slate-400">→</span>
                            <StagePill stage={t.toStage} className="text-[10px] !px-1.5 !py-0" />
                          </div>
                          <p className="text-xs text-slate-500 italic">
                            {transitionDecisionLabel(t.decision, t.toStage)}
                          </p>
                          {t.decision === "approve-engineering" && (
                            <p className="text-xs text-slate-500">
                              Engineering: {t.includeEngineeringReview === false ? "Skipped" : "Included"}
                              {" · "}
                              Production: {t.includeProductionReview === false ? "Skipped" : "Included"}
                            </p>
                          )}
                          {t.reason && (
                            <p className="text-xs text-slate-500">"{t.reason}"</p>
                          )}
                          <p className="text-xs text-slate-400">
                            {formatDistanceToNow(new Date(t.createdAt), { addSuffix: true })}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                {/* Details tab */}
                <TabsContent value="details">
                  {!detailChanges || detailChanges.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-4">No detail edits yet.</p>
                  ) : (
                    <div className="space-y-4">
                      {detailChanges.map((dc) => (
                        <div key={dc.id} className="border-l-2 border-blue-200 pl-3 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-medium text-slate-700">{dc.changedByName}</span>
                            <span className="text-xs text-slate-400 capitalize bg-slate-100 px-1.5 py-0.5 rounded">
                              {dc.changedByRole}
                            </span>
                            {dc.simulatedRole && (
                              <span className="text-xs text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                                acting as {dc.simulatedRole}
                              </span>
                            )}
                            <span className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                              {dc.section === "request" ? "Request Details"
                                : dc.section === "engineering" ? "Engineering Output"
                                : dc.section === "production" ? "Production Output"
                                : "ART Final Output"}
                            </span>
                          </div>
                          <div className="space-y-1">
                            {(dc.changes as Array<{ field: string; oldValue: string | null; newValue: string | null }>).map((chg, i) => (
                              <div key={i} className="text-xs text-slate-600">
                                <span className="font-medium">{chg.field}:</span>{" "}
                                <span className="text-red-500 line-through">{formatHistoryMoney(chg.oldValue, chg.field, dc, detailChanges ?? [], auditCurrencies, true)}</span>
                                {" → "}
                                <span className="text-green-700">{formatHistoryMoney(chg.newValue, chg.field, dc, detailChanges ?? [], auditCurrencies, false)}</span>
                              </div>
                            ))}
                          </div>
                          <p className="text-xs text-slate-400">
                            {formatDistanceToNow(new Date(dc.changedAt), { addSuffix: true })}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}

// ─── Attachment Row ─────────────────────────────────────────────────────────

function AttachmentRow({
  etoId,
  attachment,
  currentUserId,
  currentUserRole,
  archived,
}: {
  etoId: number;
  attachment: Attachment;
  currentUserId?: number;
  currentUserRole?: string;
  archived?: boolean;
}) {
  const qc = useQueryClient();
  const [actionLoading, setActionLoading] = useState<"open" | "download" | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { mutate: deleteAttachment, isPending: deleting } = useDeleteAttachment();

  const canDelete =
    !archived && (currentUserRole === "admin" || currentUserRole === "superuser" || currentUserId === attachment.uploaderId);

  async function resolveUrl(): Promise<string> {
    const { url } = await getAttachmentDownloadUrl(etoId, attachment.id);
    return url;
  }

  async function handleOpen() {
    setActionLoading("open");
    try {
      const url = await resolveUrl();
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Failed to get file link");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDownload() {
    setActionLoading("download");
    try {
      const url = await resolveUrl();
      // Force a download by fetching as blob and creating an object URL
      const resp = await fetch(url);
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = attachment.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch {
      toast.error("Failed to download file");
    } finally {
      setActionLoading(null);
    }
  }

  function handleDelete() {
    deleteAttachment(
      { id: etoId, attachmentId: attachment.id },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListAttachmentsQueryKey(etoId) });
          toast.success("Attachment removed");
        },
        onError: () => toast.error("Failed to remove attachment"),
      }
    );
  }

  const busy = actionLoading !== null || deleting;

  return (
    <>
      <div className="flex items-center gap-2 text-sm text-slate-700 bg-slate-50 rounded p-2">
        <Paperclip className="h-3.5 w-3.5 text-slate-400 shrink-0" />
        <span className="truncate flex-1">{attachment.filename}</span>
        {attachment.fileSize && (
          <span className="text-xs text-slate-400 shrink-0">
            ({Math.round(attachment.fileSize / 1024)} KB)
          </span>
        )}

        {/* Open in new tab */}
        <button
          onClick={handleOpen}
          disabled={busy}
          className="shrink-0 text-slate-400 hover:text-[#1E3A5F] transition-colors disabled:opacity-50"
          title="Open in new tab"
        >
          {actionLoading === "open" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ExternalLink className="h-3.5 w-3.5" />
          )}
        </button>

        {/* Download */}
        <button
          onClick={handleDownload}
          disabled={busy}
          className="shrink-0 text-slate-400 hover:text-[#1E3A5F] transition-colors disabled:opacity-50"
          title="Download"
        >
          {actionLoading === "download" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
        </button>

        {/* Delete */}
        {canDelete && (
          <>
            <button
              onClick={() => setConfirmOpen(true)}
              disabled={busy}
              className="shrink-0 text-slate-400 hover:text-red-600 transition-colors disabled:opacity-50"
              title="Remove attachment"
            >
              {deleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </button>
            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove this attachment?</AlertDialogTitle>
                  <AlertDialogDescription>
                    "{attachment.filename}" will be permanently deleted. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="bg-red-600 hover:bg-red-700 text-white"
                  >
                    Remove
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </div>

    </>
  );
}

// ─── Workflow Actions ───────────────────────────────────────────────────────

interface WorkflowActionsProps {
  eto: EtoRequest;
  reviewStepDates: ReviewStepSchedule;
  suggestedPrice: SalesPriceSuggestion | null;
  suggestedLeadTime: string | null;
  userRole: string;
  engineeringReviewCompleted: boolean;
  engineeringOutput?: EngineeringOutput;
  productionOutput?: ProductionOutput;
  artFinalOutput?: ArtFinalOutput;
  engineeringOutputLoading: boolean;
  productionOutputLoading: boolean;
  artFinalOutputLoading: boolean;
  onTransition: (data: TransitionInput) => void;
  isPending: boolean;
  onSplit: (count: number) => void;
  isSplitPending: boolean;
}

function WorkflowActions({
  eto,
  reviewStepDates,
  suggestedPrice,
  suggestedLeadTime,
  userRole,
  engineeringReviewCompleted,
  engineeringOutput,
  productionOutput,
  artFinalOutput,
  engineeringOutputLoading,
  productionOutputLoading,
  artFinalOutputLoading,
  onTransition,
  isPending,
  onSplit,
  isSplitPending,
}: WorkflowActionsProps) {
  const { stage } = eto;

  const isSuperUser = userRole === "superuser";
  const canManageAbandonment = isSuperUser || userRole === "art";
  const abandonableStages = [
    "draft",
    "art-review",
    "art-final-review",
    "quoted",
  ];
  let stageActions: React.ReactNode = null;

  if (stage === "abandoned") {
    return canManageAbandonment ? (
      <ReopenActions onTransition={onTransition} isPending={isPending} />
    ) : (
      <p className="text-sm text-slate-400 text-center py-2">
        This request is abandoned. Only ART or SuperUser can re-open it.
      </p>
    );
  }

  if ((eto.splitChildren?.length ?? 0) > 0) {
    return (
      <div className="rounded-md border border-blue-100 bg-blue-50 p-3">
        <p className="text-sm font-medium text-slate-700">This original request has been split.</p>
        <p className="text-xs text-slate-500 mt-1">
          Continue the workflow on each linked child ETO.
        </p>
      </div>
    );
  }

  if (stage === "draft" && (isSuperUser || userRole === "sales" || userRole === "art")) {
    stageActions = <DraftActions onTransition={onTransition} isPending={isPending} />;
  }

  if (stage === "art-review" && (isSuperUser || userRole === "art")) {
    stageActions = (
      <ArtReviewActions
        onTransition={onTransition}
        isPending={isPending}
        onSplit={onSplit}
        isSplitPending={isSplitPending}
        canSplit={!eto.parentEtoRequestId && (eto.splitChildren?.length ?? 0) === 0}
        initialIncludeEngineering={eto.includeEngineeringReview}
        initialIncludeProduction={eto.includeProductionReview}
        initialProductionAssigneeId={eto.productionAssigneeId}
        schedule={eto}
        reviewStepDates={reviewStepDates}
      />
    );
  }

  if (stage === "engineering-review" && (isSuperUser || userRole === "engineering")) {
    stageActions = engineeringOutputLoading
      ? <Skeleton className="h-24 w-full" />
      : <EngineeringActions onTransition={onTransition} isPending={isPending} includeProductionReview={eto.includeProductionReview} entity={eto.entity} productionAssigneeId={eto.productionAssigneeId} previousOutput={engineeringOutput} reassign={<ReassignReview eto={eto} department="engineering" disabled={isPending} />} />;
  }

  if (stage === "production-review" && (isSuperUser || userRole === "production")) {
    stageActions = productionOutputLoading
      ? <Skeleton className="h-24 w-full" />
      : <ProductionActions onTransition={onTransition} isPending={isPending} includeEngineeringReview={eto.includeEngineeringReview} previousOutput={productionOutput} reassign={<ReassignReview eto={eto} department="production" disabled={isPending} />} />;
  }

  if (stage === "art-final-review" && (isSuperUser || userRole === "art")) {
    stageActions = artFinalOutputLoading ? <Skeleton className="h-32 w-full" /> : (
      <ArtFinalActions
        onTransition={onTransition}
        isPending={isPending}
        includeEngineeringReview={eto.includeEngineeringReview}
        includeProductionReview={eto.includeProductionReview}
        engineeringReviewCompleted={engineeringReviewCompleted}
        previousOutput={artFinalOutput}
        suggestedPrice={suggestedPrice}
        suggestedLeadTime={suggestedLeadTime}
      />
    );
  }

  if (stage === "quoted" && (isSuperUser || userRole === "sales" || userRole === "art")) {
    stageActions = <QuotedActions onTransition={onTransition} isPending={isPending} />;
  }

  if (canManageAbandonment && abandonableStages.includes(stage)) {
    return (
      <div className="space-y-3">
        {stageActions}
        {stageActions && <div className="border-t border-slate-200" />}
        <AbandonActions onTransition={onTransition} isPending={isPending} />
      </div>
    );
  }

  return stageActions ?? (
    <p className="text-sm text-slate-400 text-center py-2">
      No actions available for your role at this stage.
    </p>
  );
}

function AbandonActions({
  onTransition,
  isPending,
}: {
  onTransition: (d: TransitionInput) => void;
  isPending: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");

  if (!confirming) {
    return (
      <Button
        variant="outline"
        className="w-full text-red-600 border-red-200 hover:bg-red-50"
        onClick={() => setConfirming(true)}
        disabled={isPending}
      >
        Mark Abandoned/On Hold
      </Button>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <Label required>Abandonment Reason</Label>
        <p className="text-xs text-slate-500 mt-1">
          This closes the request until ART or a SuperUser re-opens it.
        </p>
      </div>
      <Textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
      />
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setConfirming(false);
            setReason("");
          }}
          className="flex-1"
          disabled={isPending}
        >
          Back
        </Button>
        <Button
          size="sm"
          className="flex-1 bg-red-600 hover:bg-red-700 text-white"
          disabled={!reason.trim() || isPending}
          onClick={() => onTransition({ decision: "mark-abandoned", reason: reason.trim() })}
        >
          {isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
          Mark Abandoned/On Hold
        </Button>
      </div>
    </div>
  );
}

function ReopenActions({
  onTransition,
  isPending,
}: {
  onTransition: (d: TransitionInput) => void;
  isPending: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Re-open this request at the workflow stage it had before it was abandoned.
      </p>
      <Button
        className="w-full bg-[#1E3A5F] hover:bg-[#162d4a] text-white"
        onClick={() => onTransition({ decision: "reopen" })}
        disabled={isPending}
      >
        {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Re-open
      </Button>
    </div>
  );
}

// ─── Draft Actions ──────────────────────────────────────────────────────────

function DraftActions({ onTransition, isPending }: { onTransition: (d: TransitionInput) => void; isPending: boolean }) {
  return (
    <Button
      className="w-full bg-[#1E3A5F] hover:bg-[#162d4a] text-white"
      onClick={() => onTransition({ decision: "submit" })}
      disabled={isPending}
    >
      {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
      Submit to ART Review
    </Button>
  );
}

// ─── ART Review Actions ─────────────────────────────────────────────────────

function ArtReviewActions({
  onTransition,
  isPending,
  onSplit,
  isSplitPending,
  canSplit,
  initialIncludeEngineering,
  initialIncludeProduction,
  initialProductionAssigneeId,
  schedule,
  reviewStepDates,
}: {
  onTransition: (d: TransitionInput) => void;
  isPending: boolean;
  onSplit: (count: number) => void;
  isSplitPending: boolean;
  canSplit: boolean;
  initialIncludeEngineering: boolean;
  initialIncludeProduction: boolean;
  initialProductionAssigneeId?: number | null;
  schedule: EtoRequest;
  reviewStepDates: ReviewStepSchedule;
}) {
  const [action, setAction] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [productionAssigneeId, setProductionAssigneeId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [splitCount, setSplitCount] = useState("2");
  const [includeEngineering, setIncludeEngineering] = useState(initialIncludeEngineering);
  const [includeProduction, setIncludeProduction] = useState(initialIncludeProduction);
  const [entity, setEntity] = useState<"TOUS" | "TOUK" | "">(schedule.entity ?? "");
  const [reviewDurations, setReviewDurations] = useState([
    String(schedule.engineeringReviewDurationWeeks ?? 1),
    String(schedule.productionReviewDurationWeeks ?? 1),
    String(schedule.artFinalReviewDurationWeeks ?? 1),
  ]);

  const { data: engineers } = useListUsers({ role: "engineering" });
  const { data: productionUsers } = useListUsers({ role: "production" });
  const { data: reviewerDefaults } = useGetReviewAssignmentDefaults(
    { entity: entity === "TOUK" ? "TOUK" : "TOUS" },
    { query: {
      queryKey: getGetReviewAssignmentDefaultsQueryKey({ entity: entity === "TOUK" ? "TOUK" : "TOUS" }),
      enabled: entity === "TOUS" || entity === "TOUK", refetchInterval: 30_000,
    } },
  );
  const selectedAssignee = assigneeId ??
    (reviewerDefaults?.engineeringUserId &&
      engineers?.some((eng) => eng.id === reviewerDefaults.engineeringUserId)
      ? String(reviewerDefaults.engineeringUserId) : "");
  const defaultProductionName = productionUsers?.find((u) => u.id === reviewerDefaults?.productionUserId)?.name;
  const preferredProductionId = initialProductionAssigneeId ?? reviewerDefaults?.productionUserId;
  const selectedProductionAssignee = productionAssigneeId ??
    (preferredProductionId && productionUsers?.some((u) => u.id === preferredProductionId)
      ? String(preferredProductionId) : "");

  if (!action) {
    return (
      <div className="space-y-2">
        <Button
          className="w-full justify-start bg-green-600 text-white hover:bg-green-700"
          onClick={() => setAction("approve-engineering")}
        >
          Accept
        </Button>
        {canSplit && (
          <Button
            variant="outline"
            className="w-full text-left justify-start text-blue-700 border-blue-200 hover:bg-blue-50"
            onClick={() => setAction("split-request")}
          >
            <GitBranch className="h-4 w-4 mr-2" />
            Split Request
          </Button>
        )}
        <Button
          variant="outline"
          className="w-full text-left justify-start"
          onClick={() => setAction("return-draft")}
        >
          Back to Draft
        </Button>
        <Button
          variant="outline"
          className="w-full text-left justify-start text-red-600 border-red-200 hover:bg-red-50"
          onClick={() => setAction("decline")}
        >
          Decline
        </Button>
      </div>
    );
  }

  if (action === "split-request") {
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label required>Number of child requests</Label>
          <Select value={splitCount} onValueChange={setSplitCount}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 9 }, (_, index) => index + 2).map((count) => (
                <SelectItem key={count} value={String(count)}>
                  {count} child ETOs
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="rounded-md border border-blue-100 bg-blue-50 p-3 text-xs text-slate-600 space-y-1">
          <p>
            Creates suffixes <strong>-01</strong> through{" "}
            <strong>-{String(Number(splitCount)).padStart(2, "0")}</strong>.
          </p>
          <p>Each child starts in ART Review with copied Request Details and independent attachment copies.</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAction(null)}
            className="flex-1"
            disabled={isSplitPending}
          >
            Back
          </Button>
          <Button
            size="sm"
            className="flex-1 bg-blue-700 hover:bg-blue-800 text-white"
            disabled={isSplitPending || isPending}
            onClick={() => onSplit(Number(splitCount))}
          >
            {isSplitPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Create {splitCount}
          </Button>
        </div>
      </div>
    );
  }

  if (action === "approve-engineering") {
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="art-review-entity">Entity</Label>
          <Select value={entity} onValueChange={(value) => {
            if (value === "TOUS" || value === "TOUK") {
              setEntity(value);
              setAssigneeId(null);
              setProductionAssigneeId(null);
            }
          }}>
            <SelectTrigger id="art-review-entity" data-testid="select-art-review-entity">
              <SelectValue placeholder="Select entity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TOUS">TOUS</SelectItem>
              <SelectItem value="TOUK">TOUK</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <ReviewScheduleFields durations={reviewDurations}
          onChange={(index, value) => setReviewDurations((previous) => previous.map((duration, i) => i === index ? value : duration))}
          savedDueDate={schedule.dueDate} acceptedDate={schedule.artReviewAcceptedDate}
          savedStepDates={reviewStepDates}
          includeEngineering={includeEngineering} includeProduction={includeProduction}
          onIncludeEngineeringChange={setIncludeEngineering}
          onIncludeProductionChange={setIncludeProduction}
          engineeringAssignment={
          <div className="space-y-1.5">
            <Label htmlFor="engineering-assignee" required>Assign Engineer</Label>
            <Select value={selectedAssignee} onValueChange={setAssigneeId}>
              <SelectTrigger id="engineering-assignee">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {engineers && engineers.length > 0 ? (
                  engineers.map((eng) => (
                    <SelectItem key={eng.id} value={String(eng.id)}>
                      {eng.name}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="__no-engineers__" disabled>
                    No Engineering users available
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            {reviewerDefaults?.engineeringUserId && (
              <p className="text-xs text-slate-500">Default: {engineers?.find((u) => u.id === reviewerDefaults.engineeringUserId)?.name ?? "Unavailable"}. You can choose another engineer for this ETO.</p>
            )}
            {engineers?.length === 0 && (
              <p className="text-xs text-amber-700">
                No users have the Engineering role. An admin must assign that role in User Management before this review can be accepted.
              </p>
            )}
          </div>
          }
          productionAssignment={
          <div className="space-y-1.5">
            <Label htmlFor="production-assignee" required>Assign Production</Label>
            <Select value={selectedProductionAssignee} onValueChange={setProductionAssigneeId}>
              <SelectTrigger id="production-assignee">
                <SelectValue placeholder="Select a Production assignee" />
              </SelectTrigger>
              <SelectContent>
                {productionUsers && productionUsers.length > 0 ? (
                  productionUsers.map((user) => (
                    <SelectItem key={user.id} value={String(user.id)}>
                      {user.name}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="__no-production__" disabled>
                    No Production users available
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            {reviewerDefaults?.productionUserId && (
              <p className="text-xs text-slate-500">
                Default: {defaultProductionName ?? "Unavailable"}. You can choose another Production assignee for this ETO.
              </p>
            )}
            {productionUsers?.length === 0 && (
              <p className="text-xs text-amber-700">
                No users have the Production role. An admin must assign that role before this review can be accepted.
              </p>
            )}
          </div>
          }
        />
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setAction(null)} className="flex-1">
            Back
          </Button>
          <Button
            size="sm"
            className="flex-1 bg-[#1E3A5F] hover:bg-[#162d4a] text-white"
            disabled={(!schedule.dueDate && !validReviewDurations(reviewDurations, includeEngineering, includeProduction)) || (includeEngineering && !selectedAssignee) || (includeProduction && !selectedProductionAssignee) || isPending}
            onClick={() => onTransition({
              decision: "approve-engineering",
              entity: entity || undefined,
              assigneeId: includeEngineering ? Number(selectedAssignee) : null,
              productionAssigneeId: includeProduction ? Number(selectedProductionAssignee) : null,
              engineeringReviewDurationWeeks: includeEngineering || validReviewDurations([reviewDurations[0], "0", "0"])
                ? Number(reviewDurations[0]) : undefined,
              productionReviewDurationWeeks: includeProduction || validReviewDurations([reviewDurations[1], "0", "0"])
                ? Number(reviewDurations[1]) : undefined,
              artFinalReviewDurationWeeks: Number(reviewDurations[2]),
              reviewTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              includeEngineeringReview: includeEngineering,
              includeProductionReview: includeProduction,
            })}
          >
            {isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Confirm
          </Button>
        </div>
      </div>
    );
  }

  if (action === "decline" || action === "return-draft") {
    const isDecline = action === "decline";
    return (
      <div className="space-y-3">
        <Label required>{isDecline ? "Decline Reason" : "Reason for Returning to Draft"}</Label>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
        />
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setAction(null)} className="flex-1">
            Back
          </Button>
          <Button
            size="sm"
            className={`flex-1 text-white ${isDecline ? "bg-red-600 hover:bg-red-700" : "bg-[#1E3A5F] hover:bg-[#162d4a]"}`}
            disabled={!reason.trim() || isPending}
            onClick={() => onTransition({ decision: action, reason })}
          >
            {isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            {isDecline ? "Decline" : "Return to Draft"}
          </Button>
        </div>
      </div>
    );
  }

  return null;
}

// ─── Engineering Actions ────────────────────────────────────────────────────

function EngineeringActions({ onTransition, isPending, includeProductionReview, entity, productionAssigneeId, previousOutput, reassign }: { onTransition: (d: TransitionInput) => void; isPending: boolean; includeProductionReview: boolean; entity?: string | null; productionAssigneeId?: number | null; previousOutput?: EngineeringOutput; reassign: React.ReactNode }) {
  const [action, setAction] = useState<string | null>(null);
  const [designHours, setDesignHours] = useState(previousOutput?.estimatedDesignHours ?? "");
  const [pnGuidance, setPnGuidance] = useState(previousOutput?.pnGuidance ?? "");
  const [notes, setNotes] = useState(previousOutput?.notes ?? "");
  const [reason, setReason] = useState("");
  const [riskScore, setRiskScore] = useState<SelectedRiskScore>(previousOutput?.riskScore ?? "");
  const [riskNotes, setRiskNotes] = useState(previousOutput?.riskNotes ?? "");

  if (!action) {
    return (
      <div className="space-y-2">
        <Button
          className="w-full bg-[#1E3A5F] hover:bg-[#162d4a] text-white"
          onClick={() => {
            setRiskScore(previousOutput?.riskScore ?? "");
            setRiskNotes(previousOutput?.riskNotes ?? "");
            setAction("engineering-quote-ready");
          }}
        >
          Complete Engineering → {includeProductionReview ? "Production" : "ART Final Review"}
        </Button>
        {reassign}
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setAction("engineering-return-art")}
        >
          Back to ART Review
        </Button>
      </div>
    );
  }

  if (action === "engineering-quote-ready") {
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label required>Estimated Design hours</Label>
          <Input type="number" min="0" max="1000000" step="any" value={designHours} onChange={(e) => setDesignHours(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label required>P/N Guidance</Label>
          <Textarea value={pnGuidance} onChange={(e) => setPnGuidance(e.target.value)} rows={2} />
        </div>
        <RiskScoreFields score={riskScore} notes={riskNotes} onScoreChange={setRiskScore} onNotesChange={setRiskNotes} />
        <div className="space-y-1.5">
          <Label>Notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>
        {includeProductionReview && (
          <AssignedProductionNote productionAssigneeId={productionAssigneeId} entity={entity} />
        )}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setAction(null)} className="flex-1">
            Back
          </Button>
          <Button
            size="sm"
            className="flex-1 bg-[#1E3A5F] hover:bg-[#162d4a] text-white"
            disabled={!designHours.trim() || !Number.isFinite(Number(designHours)) || Number(designHours) <= 0 || Number(designHours) > 1_000_000 || !pnGuidance.trim() || !riskScore || (riskScore === "High" && !riskNotes.trim()) || isPending}
            onClick={() => onTransition({
              decision: "engineering-quote-ready",
              engineeringEstimatedDesignHours: designHours.trim(),
              engineeringPnGuidance: pnGuidance,
              engineeringNotes: notes || null,
              engineeringRiskScore: riskScore || undefined,
              engineeringRiskNotes: riskScore === "High" ? riskNotes.trim() : null,
            })}
          >
            {isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Submit
          </Button>
        </div>
      </div>
    );
  }

  if (action === "engineering-return-art") {
    return (
      <div className="space-y-3">
        <Label required>Reason for Returning to ART Review</Label>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
        />
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setAction(null)} className="flex-1">
            Back
          </Button>
          <Button
            size="sm"
            className="flex-1 bg-[#1E3A5F] hover:bg-[#162d4a] text-white"
            disabled={!reason.trim() || isPending}
            onClick={() => onTransition({ decision: "engineering-return-art", reason })}
          >
            {isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Return to ART Review
          </Button>
        </div>
      </div>
    );
  }

  return null;
}

// ─── Production Actions ─────────────────────────────────────────────────────

function validNonNegativeInput(value: string): boolean {
  return !!value.trim() && Number.isFinite(Number(value)) && Number(value) >= 0;
}

function ProductionActions({ onTransition, isPending, includeEngineeringReview, previousOutput, reassign }: { onTransition: (d: TransitionInput) => void; isPending: boolean; includeEngineeringReview: boolean; previousOutput?: ProductionOutput; reassign: React.ReactNode }) {
  const [action, setAction] = useState<string | null>(null);
  const [procurementCost, setProcurementCost] = useState(moneyInputValue(previousOutput?.procurementCost));
  const [procurementCostCurrency, setProcurementCostCurrency] = useState<Currency>(previousOutput?.procurementCostCurrency ?? "USD");
  const [procurementLeadTime, setProcurementLeadTime] = useState(previousOutput?.procurementLeadTime ?? "");
  const [assemblyTimeHours, setAssemblyTimeHours] = useState(previousOutput?.assemblyTimeHours ?? "");
  const [notes, setNotes] = useState(previousOutput?.notes ?? "");
  const [reason, setReason] = useState("");
  const [riskScore, setRiskScore] = useState<SelectedRiskScore>(previousOutput?.riskScore ?? "");
  const [riskNotes, setRiskNotes] = useState(previousOutput?.riskNotes ?? "");

  if (!action) {
    return (
      <div className="space-y-2">
        <Button
          className="w-full bg-[#1E3A5F] hover:bg-[#162d4a] text-white"
          onClick={() => {
            setRiskScore(previousOutput?.riskScore ?? "");
            setRiskNotes(previousOutput?.riskNotes ?? "");
            setAction("production-approve");
          }}
        >
          Complete Production → ART Final Review
        </Button>
        {reassign}
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setAction("production-return-engineering")}
        >
          Back to {includeEngineeringReview ? "Engineering" : "ART Review"}
        </Button>
      </div>
    );
  }

  if (action === "production-approve") {
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label required>Procurement Cost</Label>
          <div className="flex overflow-hidden rounded-md border border-input bg-background shadow-sm focus-within:ring-1 focus-within:ring-ring">
            <MoneyInput currency={procurementCostCurrency} className="h-9 rounded-none border-0 shadow-none focus-visible:ring-0"
              value={procurementCost} onChange={(e) => setProcurementCost(e.target.value)} />
            <CurrencySelect value={procurementCostCurrency} onValueChange={setProcurementCostCurrency} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label required>Procurement Lead Time (weeks)</Label>
          <Input type="number" min="0" step="any" value={procurementLeadTime} onChange={(e) => setProcurementLeadTime(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label required>Assembly Time (hours)</Label>
          <Input type="number" min="0" step="any" value={assemblyTimeHours} onChange={(e) => setAssemblyTimeHours(e.target.value)} />
        </div>
        <RiskScoreFields score={riskScore} notes={riskNotes} onScoreChange={setRiskScore} onNotesChange={setRiskNotes} />
        <div className="space-y-1.5">
          <Label>Notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setAction(null)} className="flex-1">
            Back
          </Button>
          <Button
            size="sm"
            className="flex-1 bg-[#1E3A5F] hover:bg-[#162d4a] text-white"
            disabled={!isWholeMoney(procurementCost) || !validNonNegativeInput(procurementLeadTime) || !validNonNegativeInput(assemblyTimeHours) || Number(assemblyTimeHours) > 1_000_000 || !riskScore || (riskScore === "High" && !riskNotes.trim()) || isPending}
            onClick={() => onTransition({
              decision: "production-approve",
              productionProcurementCost: procurementCost.trim(),
              productionProcurementCostCurrency: procurementCostCurrency,
              productionProcurementLeadTime: procurementLeadTime.trim(),
              productionAssemblyTimeHours: assemblyTimeHours.trim(),
              productionNotes: notes || null,
              productionRiskScore: riskScore || undefined,
              productionRiskNotes: riskScore === "High" ? riskNotes.trim() : null,
            })}
          >
            {isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Approve
          </Button>
        </div>
      </div>
    );
  }

  if (action === "production-return-engineering") {
    return (
      <div className="space-y-3">
        <Label required>Reason for Returning to {includeEngineeringReview ? "Engineering" : "ART Review"}</Label>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
        />
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setAction(null)} className="flex-1">
            Back
          </Button>
          <Button
            size="sm"
            className="flex-1 bg-[#1E3A5F] hover:bg-[#162d4a] text-white"
            disabled={!reason.trim() || isPending}
            onClick={() => onTransition({ decision: "production-return-engineering", reason })}
          >
            {isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Return to {includeEngineeringReview ? "Engineering" : "ART Review"}
          </Button>
        </div>
      </div>
    );
  }

  return null;
}

// ─── ART Final Actions ──────────────────────────────────────────────────────

function ArtFinalActions({
  onTransition,
  isPending,
  includeEngineeringReview,
  includeProductionReview,
  engineeringReviewCompleted,
  previousOutput,
  suggestedPrice,
  suggestedLeadTime,
}: {
  onTransition: (d: TransitionInput) => void;
  isPending: boolean;
  includeEngineeringReview: boolean;
  includeProductionReview: boolean;
  engineeringReviewCompleted: boolean;
  previousOutput?: ArtFinalOutput;
  suggestedPrice: SalesPriceSuggestion | null;
  suggestedLeadTime: string | null;
}) {
  const [action, setAction] = useState<string | null>(null);
  // Quote overrides belong to this form only, never to calculator assumptions.
  const [marketPriceOverride, setMarketPriceOverride] = useState<string | null>(null);
  const [currencyOverride, setCurrencyOverride] = useState<Currency | null>(null);
  const marketPrice = marketPriceOverride ?? suggestedPrice?.salesPrice ?? moneyInputValue(previousOutput?.marketPrice);
  const marketPriceCurrency = currencyOverride ?? (suggestedPrice && !suggestedPrice.multiCurrency
    ? suggestedPrice.currency as Currency : previousOutput?.marketPriceCurrency ?? "USD");
  const [marketLeadtimeOverride, setMarketLeadtimeOverride] = useState<string | null>(null);
  const marketLeadtime = marketLeadtimeOverride ?? suggestedLeadTime ?? previousOutput?.marketLeadtime ?? "";
  const [quoteDescriptionOverride, setQuoteDescriptionOverride] = useState<string | null>(null);
  const quoteDescription = quoteDescriptionOverride ?? previousOutput?.quoteDescription ?? "";
  const [notes, setNotes] = useState(previousOutput?.notes ?? "");
  const [reason, setReason] = useState("");

  if (!action) {
    return (
      <div className="space-y-2">
        <Button
          className="w-full bg-[#1E3A5F] hover:bg-[#162d4a] text-white"
          onClick={() => setAction("art-final-quote")}
        >
          Generate Quote
        </Button>
        <Button
          variant="outline"
          className="w-full justify-center text-center text-amber-700 border-amber-200 hover:bg-amber-50"
          onClick={() => setAction("art-final-return-production")}
        >
          Back to {includeProductionReview ? "Production" : includeEngineeringReview ? "Engineering" : "ART Review"}
        </Button>
        {shouldShowArtFinalReturnToEngineering({
          engineeringReviewCompleted,
          includeEngineeringReview,
          includeProductionReview,
        }) && (
          <Button
            variant="outline"
            className="w-full justify-center text-center text-purple-700 border-purple-200 hover:bg-purple-50"
            onClick={() => setAction("art-final-return-engineering")}
          >
            Back to Engineering
          </Button>
        )}
        <Button
          variant="outline"
          className="w-full text-red-600 border-red-200 hover:bg-red-50"
          onClick={() => setAction("decline")}
        >
          Decline
        </Button>
      </div>
    );
  }

  if (action === "art-final-quote") {
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label required>Market Price</Label>
          <div className="flex overflow-hidden rounded-md border border-input bg-background shadow-sm focus-within:ring-1 focus-within:ring-ring">
            <MoneyInput currency={marketPriceCurrency}
              className="h-9 rounded-none border-0 shadow-none focus-visible:ring-0"
              value={marketPrice}
              onChange={(e) => setMarketPriceOverride(e.target.value)}
            />
            <CurrencySelect value={marketPriceCurrency} onValueChange={setCurrencyOverride} />
          </div>
          <p className="text-xs text-slate-500">
            Starts from the calculator Sales Price. You can override it without changing the calculator.
          </p>
          {suggestedPrice?.multiCurrency && (
            <p className="text-xs text-amber-700">The calculator combines currencies without conversion. Confirm the quote currency and Market Price.</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label required>Market Lead Time (weeks)</Label>
          <Input type="number" min="0" step="any" data-testid="input-quote-market-lead-time"
            value={marketLeadtime} onChange={(e) => setMarketLeadtimeOverride(e.target.value)} />
          <p className="text-xs text-slate-500">
            Starts from the calculator Lead Time, rounded up to a whole week. You can override it without changing the calculator.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="quote-description" required>Description</Label>
          <Textarea id="quote-description" data-testid="input-quote-description" value={quoteDescription}
            onChange={(e) => setQuoteDescriptionOverride(e.target.value)} rows={3} required />
          {!quoteDescription.trim() && <p className="text-xs text-red-600">Description is required to generate a quote.</p>}
        </div>
        <div className="space-y-1.5">
          <Label>Notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setAction(null)} className="flex-1">
            Back
          </Button>
          <Button
            size="sm"
            className="flex-1 bg-[#1E3A5F] hover:bg-[#162d4a] text-white"
            disabled={!isWholeMoney(marketPrice) || !marketLeadtime || !quoteDescription.trim() || isPending}
            onClick={() => onTransition({
              decision: "art-final-quote",
              artMarketPrice: marketPrice,
              artMarketPriceCurrency: marketPriceCurrency,
              artMarketLeadtime: marketLeadtime,
              artQuoteDescription: quoteDescription.trim(),
              artNotes: notes || null,
            })}
          >
            {isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Generate Quote
          </Button>
        </div>
      </div>
    );
  }

  if (action === "art-final-return-production" || action === "art-final-return-engineering") {
    const returnTarget = action === "art-final-return-engineering"
      ? "Engineering"
      : includeProductionReview
        ? "Production"
        : includeEngineeringReview
          ? "Engineering"
          : "ART Review";

    return (
      <div className="space-y-3">
        <Label required>Reason for Returning to {returnTarget}</Label>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
        />
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setAction(null)} className="flex-1">
            Back
          </Button>
          <Button
            size="sm"
            className="flex-1 bg-[#1E3A5F] hover:bg-[#162d4a] text-white"
            disabled={!reason.trim() || isPending}
            onClick={() => onTransition({ decision: action, reason: reason.trim() })}
          >
            {isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Return to {returnTarget}
          </Button>
        </div>
      </div>
    );
  }

  if (action === "decline") {
    return (
      <div className="space-y-3">
        <Label required>Decline Reason</Label>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
        />
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setAction(null)} className="flex-1">
            Back
          </Button>
          <Button
            size="sm"
            className="flex-1 bg-red-600 hover:bg-red-700 text-white"
            disabled={!reason.trim() || isPending}
            onClick={() => onTransition({ decision: "decline", reason })}
          >
            {isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Decline
          </Button>
        </div>
      </div>
    );
  }

  return null;
}

// ─── Quoted Actions ─────────────────────────────────────────────────────────

function QuotedActions({ onTransition, isPending }: { onTransition: (d: TransitionInput) => void; isPending: boolean }) {
  const [action, setAction] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  if (!action) {
    return (
      <div className="space-y-2">
        <Button
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
          onClick={() => onTransition({ decision: "mark-won" })}
          disabled={isPending}
        >
          {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Mark Won
        </Button>
        <Button
          variant="outline"
          className="w-full text-red-600 border-red-200 hover:bg-red-50"
          onClick={() => setAction("mark-lost")}
        >
          Mark Lost
        </Button>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setAction("quoted-return-art-final")}
        >
          Back to ART Final Review
        </Button>
      </div>
    );
  }

  const isLoss = action === "mark-lost";

  return (
    <div className="space-y-3">
      <Label required>{isLoss ? "Loss Reason" : "Reason for Returning to ART Final Review"}</Label>
      <Textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
      />
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => setAction(null)} className="flex-1">
          Back
        </Button>
        <Button
          size="sm"
          className={`flex-1 text-white ${isLoss ? "bg-red-600 hover:bg-red-700" : "bg-[#1E3A5F] hover:bg-[#162d4a]"}`}
          disabled={!reason.trim() || isPending}
          onClick={() => onTransition({
            decision: isLoss ? "mark-lost" : "quoted-return-art-final",
            reason,
          })}
        >
          {isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
          {isLoss ? "Mark Lost" : "Return to ART Final Review"}
        </Button>
      </div>
    </div>
  );
}

// ─── Editable Request Details ────────────────────────────────────────────────

const DISTRIBUTOR_OPTS = ["Yes", "No"] as const;
const REQUEST_TYPE_OPTS = ["Accessory", "Environmental testing", "Software", "Load Frame", "Retrofit", "Automation"] as const;
const MACHINE_TYPE_OPTS = ["ST", "SL", "Impact", "MFI", "HDVT"] as const;
const CURRENCY_OPTIONS = ["USD", "GBP", "EUR", "CNY"] as const;
const FORCE_UNIT_OPTIONS = ["kN", "lbs", "N"] as const;
const DISPLACEMENT_UNIT_OPTIONS = ["mm", "in"] as const;
type Currency = (typeof CURRENCY_OPTIONS)[number];
type ForceUnit = (typeof FORCE_UNIT_OPTIONS)[number];
type DisplacementUnit = (typeof DISPLACEMENT_UNIT_OPTIONS)[number];

function formatMeasurement(value: string, unit: string): string {
  return /(?:k?N|lbs?|lbf|mm|in(?:ches)?)\s*$/i.test(value.trim())
    ? value
    : `${value} ${unit}`;
}

function EditableRequestDetails({
  eto,
  reviewStepDates,
  etoId,
  canEdit,
  onSaved,
}: {
  eto: EtoRequest & { submittedByName?: string; assigneeName?: string | null; stickyEngineerName?: string | null; declineReason?: string | null };
  etoId: number;
  reviewStepDates: ReviewStepSchedule;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const { data: engineers } = useListUsers({ role: "engineering" });
  const buildForm = () => ({
    assigneeId: eto.assigneeId === null ? "" : String(eto.assigneeId),
    customerName: eto.customerName ?? "",
    quoteNumber: eto.quoteNumber ?? "",
    distributor: eto.distributor ?? "",
    requestType: eto.requestType ?? "",
    machineType: eto.machineType ?? "",
    expectedForceRange: eto.expectedForceRange ?? "",
    expectedForceUnit: (eto.expectedForceUnit ?? "N") as ForceUnit,
    expectedDisplacement: eto.expectedDisplacement ?? "",
    expectedDisplacementUnit: (eto.expectedDisplacementUnit ?? "mm") as DisplacementUnit,
    materials: eto.materials ?? "",
    specimenDimensions: eto.specimenDimensions ?? "",
    resultsRequired: eto.resultsRequired ?? "",
    relevantStandards: eto.relevantStandards ?? "",
    customDetails: eto.customDetails ?? "",
    budgetRange: moneyInputValue(eto.budgetRange),
    budgetCurrency: (eto.budgetCurrency ?? "USD") as Currency,
    acceptableLeadTime: eto.acceptableLeadTime ?? "",
    similarParts: eto.similarParts ?? "",
  });
  const [form, setForm] = useState(buildForm);
  const { mutate: update, isPending } = useUpdateEtoRequest();

  function startEdit() { setForm(buildForm()); setEditing(true); }

  function handleSave() {
    if (!canEdit) return;
    if (!isWholeBudget(form.budgetRange)) {
      toast.error("Budget Range must contain whole-number amounts, such as 1000 - 2000");
      return;
    }
    update(
      { id: etoId, data: {
        ...(eto.stage === "engineering-review"
          ? { assigneeId: form.assigneeId ? Number(form.assigneeId) : null }
          : {}),
        customerName: form.customerName,
        quoteNumber: form.quoteNumber,
        distributor: form.distributor || null,
        requestType: form.requestType || null,
        machineType: form.machineType || null,
        expectedForceRange: form.expectedForceRange || null,
        expectedForceUnit: form.expectedForceUnit,
        expectedDisplacement: form.expectedDisplacement || null,
        expectedDisplacementUnit: form.expectedDisplacementUnit,
        materials: form.materials,
        specimenDimensions: form.specimenDimensions,
        resultsRequired: form.resultsRequired || null,
        relevantStandards: form.relevantStandards || null,
        customDetails: form.customDetails || null,
        budgetRange: form.budgetRange || null,
        budgetCurrency: form.budgetCurrency,
        acceptableLeadTime: form.acceptableLeadTime || null,
        similarParts: form.similarParts || null,
      }},
      {
        onSuccess: () => { toast.success("Request details updated"); setEditing(false); onSaved(); },
        onError: () => toast.error("Failed to save changes"),
      }
    );
  }

  const f = (key: keyof typeof form) => ({
    value: form[key] ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((p) => ({ ...p, [key]: e.target.value })),
  });

  function sel(key: keyof typeof form) {
    return {
      value: form[key] ?? "",
      onValueChange: (v: string) => setForm((p) => ({ ...p, [key]: v })),
    };
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold text-slate-800">Request Details</CardTitle>
          {canEdit && !editing && (
            <Button variant="ghost" size="sm" onClick={startEdit} className="h-7 px-2 text-slate-500 hover:text-slate-700">
              <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
            </Button>
          )}
          {editing && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-7" onClick={() => setEditing(false)} disabled={isPending}>Cancel</Button>
              <Button size="sm" className="h-7 bg-[#1E3A5F] hover:bg-[#162d4a] text-white" onClick={handleSave} disabled={isPending}>
                {isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />} Save
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!editing ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <DetailField label="Customer" value={eto.customerName} />
            <DetailField label="Quote Number" value={eto.quoteNumber} />
            {eto.distributor && <DetailField label="Distributor" value={eto.distributor} />}
            {eto.requestType && <DetailField label="Request Type" value={eto.requestType} />}
            {eto.machineType && <DetailField label="Machine Type" value={eto.machineType} />}
            {eto.expectedForceRange && (
              <DetailField
                label="Expected Force Range"
                value={formatMeasurement(eto.expectedForceRange, eto.expectedForceUnit ?? "N")}
              />
            )}
            {eto.expectedDisplacement && (
              <DetailField
                label="Expected Displacement"
                value={formatMeasurement(eto.expectedDisplacement, eto.expectedDisplacementUnit ?? "mm")}
              />
            )}
            <DetailField label="Materials to be Tested" value={eto.materials} />
            <DetailField label="Specimen Dimensions" value={eto.specimenDimensions} />
            {eto.resultsRequired && <DetailField label="Results Required" value={eto.resultsRequired} fullWidth />}
            {eto.relevantStandards && <DetailField label="Relevant Standard" value={eto.relevantStandards} fullWidth />}
            {eto.customDetails && <DetailField label="Custom Requests" value={eto.customDetails} fullWidth />}
            {eto.budgetRange && <DetailField label="Budget Range" value={formatMoney(eto.budgetRange, eto.budgetCurrency ?? "USD")} />}
            {eto.acceptableLeadTime && <DetailField label="Acceptable Lead Time (weeks)" value={eto.acceptableLeadTime} />}
            {eto.similarParts && <DetailField label="Similar Parts / Machines" value={eto.similarParts} fullWidth />}
            <DetailField label="Entity" value={eto.entity ?? "Not selected"} />
            <DetailField label="Submitted By" value={eto.submittedByName ?? ""} />
            <DetailField
              label="Submitted On"
              value={format(new Date(eto.createdAt), "EEEE, MMMM d, yyyy 'at' h:mm a")}
            />
            {eto.assigneeName && <DetailField label="Assignee" value={eto.assigneeName} />}
            <DetailField label="Due Date" value={eto.dueDate ? formatCalendarDate(eto.dueDate) : "Not set — calculated when ART accepts"} />
            <DetailField label="Engineering Review Due Date" value={!reviewStepDates.includeEngineering
              ? "Not included in the accepted schedule" : reviewStepDates.engineering
                ? formatCalendarDate(reviewStepDates.engineering) : "Not set — calculated when ART accepts"} />
            <DetailField label="Production Review Due Date" value={!reviewStepDates.includeProduction
              ? "Not included in the accepted schedule" : reviewStepDates.production
                ? formatCalendarDate(reviewStepDates.production) : "Not set — calculated when ART accepts"} />
            <DetailField label="ART Final Review Due Date" value={reviewStepDates.artFinal
              ? formatCalendarDate(reviewStepDates.artFinal) : "Not set — calculated when ART accepts"} />
            {eto.stickyEngineerName && <DetailField label="Engineer" value={eto.stickyEngineerName} />}
            {eto.declineReason && (
              <DetailField
                label={eto.stage === "lost" || eto.stage === "closed" ? "Loss Reason" : "Decline Reason"}
                value={eto.declineReason}
                fullWidth
                className="text-red-700 bg-red-50 p-2 rounded"
              />
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {eto.stage === "engineering-review" && (
              <div className="space-y-1 sm:col-span-2">
                <Label>Assigned Engineer</Label>
                <Select
                  value={form.assigneeId || "__unassigned__"}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      assigneeId: value === "__unassigned__" ? "" : value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select an Engineer…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unassigned__">Unassigned</SelectItem>
                    {engineers?.map((engineer) => (
                      <SelectItem key={engineer.id} value={String(engineer.id)}>
                        {engineer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {engineers?.length === 0 && (
                  <p className="text-xs text-amber-700">
                    No users have the Engineering role. An admin can add or update one in User Management.
                  </p>
                )}
              </div>
            )}
            <div className="space-y-1"><Label required>Customer Name</Label><Input {...f("customerName")} /></div>
            <div className="space-y-1"><Label required>Quote Number</Label><Input {...f("quoteNumber")} /></div>
            <div className="space-y-1">
              <Label>Distributor</Label>
              <Select {...sel("distributor")}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>{DISTRIBUTOR_OPTS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Request Type</Label>
              <Select {...sel("requestType")}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {form.requestType === "Machine" && <SelectItem value="Machine">Machine (legacy)</SelectItem>}
                  {REQUEST_TYPE_OPTS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Machine Type</Label>
              <Select {...sel("machineType")}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>{MACHINE_TYPE_OPTS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Expected Force Range</Label>
              <div className="flex overflow-hidden rounded-md border border-input bg-background shadow-sm focus-within:ring-1 focus-within:ring-ring">
                <Input
                  className="h-9 rounded-none border-0 shadow-none focus-visible:ring-0"
                  {...f("expectedForceRange")}
                />
                <Select {...sel("expectedForceUnit")}>
                  <SelectTrigger
                    className="h-9 w-24 shrink-0 rounded-none border-0 border-l border-input bg-slate-50 px-2 shadow-none focus:ring-0"
                    aria-label="Expected force unit"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FORCE_UNIT_OPTIONS.map((unit) => (
                      <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Expected Displacement</Label>
              <div className="flex overflow-hidden rounded-md border border-input bg-background shadow-sm focus-within:ring-1 focus-within:ring-ring">
                <Input
                  className="h-9 rounded-none border-0 shadow-none focus-visible:ring-0"
                  {...f("expectedDisplacement")}
                />
                <Select {...sel("expectedDisplacementUnit")}>
                  <SelectTrigger
                    className="h-9 w-24 shrink-0 rounded-none border-0 border-l border-input bg-slate-50 px-2 shadow-none focus:ring-0"
                    aria-label="Expected displacement unit"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DISPLACEMENT_UNIT_OPTIONS.map((unit) => (
                      <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1"><Label required>Materials to be Tested</Label><Input {...f("materials")} /></div>
            <div className="space-y-1"><Label required>Specimen Dimensions</Label><Input {...f("specimenDimensions")} /></div>
            <div className="space-y-1 sm:col-span-2"><Label>Results Required</Label><Input {...f("resultsRequired")} /></div>
            <div className="space-y-1 sm:col-span-2"><Label>Relevant Standard</Label><Input {...f("relevantStandards")} /></div>
            <div className="space-y-1 sm:col-span-2"><Label>Custom Requests</Label><Textarea rows={3} {...f("customDetails")} /></div>
            <div className="space-y-1">
              <Label>Budget Range</Label>
              <div className="flex overflow-hidden rounded-md border border-input bg-background shadow-sm focus-within:ring-1 focus-within:ring-ring">
                <MoneyInput range currency={form.budgetCurrency}
                  className="h-9 rounded-none border-0 shadow-none focus-visible:ring-0"
                  {...f("budgetRange")}
                />
                <CurrencySelect
                  value={form.budgetCurrency}
                  onValueChange={(value) => setForm((p) => ({ ...p, budgetCurrency: value }))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Acceptable Lead Time (weeks)</Label>
              <Input {...f("acceptableLeadTime")} />
            </div>
            <div className="space-y-1 sm:col-span-2"><Label>Similar Parts / Machines</Label><Input {...f("similarParts")} /></div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Editable Engineering Output ─────────────────────────────────────────────

function EditableEngineeringOutput({
  output,
  etoId,
  canEdit,
  onSaved,
}: {
  output: EngineeringOutput;
  etoId: number;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    costEstimate: moneyInputValue(output.costEstimate),
    costEstimateCurrency: (output.costEstimateCurrency ?? "USD") as Currency,
    docLeadtime: output.docLeadtime ?? "",
    estimatedDesignHours: output.estimatedDesignHours ?? "",
    pnGuidance: output.pnGuidance ?? "",
    notes: output.notes ?? "",
  });
  const { mutate: upsert, isPending } = useUpsertEngineeringOutput();
  const [riskScore, setRiskScore] = useState<SelectedRiskScore>(output.riskScore ?? "");
  const [riskNotes, setRiskNotes] = useState(output.riskNotes ?? "");

  function startEdit() {
    setRiskScore(output.riskScore ?? "");
    setRiskNotes(output.riskNotes ?? "");
    setForm({
      costEstimate: moneyInputValue(output.costEstimate),
      costEstimateCurrency: (output.costEstimateCurrency ?? "USD") as Currency,
      docLeadtime: output.docLeadtime ?? "",
      estimatedDesignHours: output.estimatedDesignHours ?? "",
      pnGuidance: output.pnGuidance ?? "",
      notes: output.notes ?? "",
    });
    setEditing(true);
  }

  function handleSave() {
    upsert(
      { id: etoId, data: {
        costEstimate: form.costEstimate || null,
        costEstimateCurrency: form.costEstimateCurrency,
        docLeadtime: form.docLeadtime || null,
        estimatedDesignHours: form.estimatedDesignHours || null,
        riskScore: riskScore || null,
        riskNotes: riskScore === "High" ? riskNotes.trim() : null,
        pnGuidance: form.pnGuidance || null,
        notes: form.notes || null,
      } },
      {
        onSuccess: () => { toast.success("Engineering output updated"); setEditing(false); onSaved(); },
        onError: () => toast.error("Failed to save changes"),
      }
    );
  }

  const f = (key: keyof typeof form) => ({
    value: form[key] ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((p) => ({ ...p, [key]: e.target.value })),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold text-purple-800">Engineering Output</CardTitle>
          {canEdit && !editing && (
            <Button variant="ghost" size="sm" onClick={startEdit} className="h-7 px-2 text-slate-500 hover:text-slate-700">
              <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
            </Button>
          )}
          {editing && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-7" onClick={() => setEditing(false)} disabled={isPending}>Cancel</Button>
              <Button size="sm" className="h-7 bg-[#1E3A5F] hover:bg-[#162d4a] text-white" onClick={handleSave} disabled={isPending || !riskScore || (riskScore === "High" && !riskNotes.trim()) || (form.estimatedDesignHours !== "" && (!Number.isFinite(Number(form.estimatedDesignHours)) || Number(form.estimatedDesignHours) <= 0 || Number(form.estimatedDesignHours) > 1_000_000)) || (!!output.estimatedDesignHours && !form.estimatedDesignHours)}>
                {isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />} Save
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!editing ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            {output.estimatedDesignHours && <DetailField label="Estimated Design hours" value={output.estimatedDesignHours} />}
            {output.designCost !== null && output.designCost !== undefined && <DetailField label="Design Cost" value={formatMoney(output.designCost)} />}
            {output.designLeadTimeWeeks !== null && output.designLeadTimeWeeks !== undefined && <DetailField label="Design Lead Time" value={`${output.designLeadTimeWeeks} weeks`} />}
            {output.estimatedDesignHours && !output.designCost && !output.designLeadTimeWeeks && (
              <p className="text-xs text-slate-500 sm:col-span-2">Design calculations were not recorded for this earlier Engineering review. Its existing result has not been changed.</p>
            )}
            {output.costEstimate && <DetailField label="Cost Estimate" value={formatMoney(output.costEstimate, output.costEstimateCurrency ?? "USD")} />}
            {output.docLeadtime && <DetailField label="Doc Lead Time (weeks)" value={output.docLeadtime} />}
            {output.pnGuidance && <DetailField label="P/N Guidance" value={output.pnGuidance} fullWidth />}
            {output.riskScore && <DetailField label="Risk Score" value={output.riskScore} />}
            {output.riskScore === "High" && output.riskNotes && <DetailField label="Risk Notes" value={output.riskNotes} fullWidth />}
            {output.notes && <DetailField label="Notes" value={output.notes} fullWidth />}
            {!output.estimatedDesignHours && !output.designCost && !output.designLeadTimeWeeks && !output.costEstimate && !output.docLeadtime && !output.pnGuidance && !output.notes && !output.riskScore && (
              <p className="text-sm text-slate-400 sm:col-span-2">No output recorded yet.</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label required={!!output.estimatedDesignHours}>Estimated Design hours</Label>
              <Input type="number" min="0" max="1000000" step="any" {...f("estimatedDesignHours")} />
              <p className="text-xs text-slate-500">Changing hours recalculates Design Cost and Lead Time. Existing calculated ETOs keep their original formula rates.</p>
            </div>
            <div className="space-y-1">
              <Label>Cost Estimate</Label>
              <div className="flex overflow-hidden rounded-md border border-input bg-background shadow-sm focus-within:ring-1 focus-within:ring-ring">
                <MoneyInput currency={form.costEstimateCurrency}
                  className="h-9 rounded-none border-0 shadow-none focus-visible:ring-0"
                  {...f("costEstimate")}
                />
                <CurrencySelect
                  value={form.costEstimateCurrency}
                  onValueChange={(value) => setForm((p) => ({ ...p, costEstimateCurrency: value }))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Doc Lead Time (weeks)</Label>
                <Input {...f("docLeadtime")} />
            </div>
            <div className="space-y-1 sm:col-span-2"><Label>P/N Guidance</Label><Textarea rows={2} {...f("pnGuidance")} /></div>
            <div className="sm:col-span-2">
              <RiskScoreFields score={riskScore} notes={riskNotes} onScoreChange={setRiskScore} onNotesChange={setRiskNotes} />
            </div>
            <div className="space-y-1 sm:col-span-2"><Label>Notes</Label><Textarea rows={2} {...f("notes")} /></div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Editable Production Output ──────────────────────────────────────────────

function EditableProductionOutput({
  output,
  etoId,
  canEdit,
  onSaved,
}: {
  output: ProductionOutput;
  etoId: number;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    procurementCost: moneyInputValue(output.procurementCost),
    procurementCostCurrency: (output.procurementCostCurrency ?? "USD") as Currency,
    procurementLeadTime: output.procurementLeadTime ?? "",
    assemblyTimeHours: output.assemblyTimeHours ?? "",
    mfgLeadtime: output.mfgLeadtime ?? "",
    prodLeadtime: output.prodLeadtime ?? "",
    notes: output.notes ?? "",
  });
  const { mutate: upsert, isPending } = useUpsertProductionOutput();
  const [riskScore, setRiskScore] = useState<SelectedRiskScore>(output.riskScore ?? "");
  const [riskNotes, setRiskNotes] = useState(output.riskNotes ?? "");

  function startEdit() {
    setRiskScore(output.riskScore ?? "");
    setRiskNotes(output.riskNotes ?? "");
    setForm({
      procurementCost: moneyInputValue(output.procurementCost),
      procurementCostCurrency: (output.procurementCostCurrency ?? "USD") as Currency,
      procurementLeadTime: output.procurementLeadTime ?? "",
      assemblyTimeHours: output.assemblyTimeHours ?? "",
      mfgLeadtime: output.mfgLeadtime ?? "",
      prodLeadtime: output.prodLeadtime ?? "",
      notes: output.notes ?? "",
    });
    setEditing(true);
  }

  function handleSave() {
    upsert(
      { id: etoId, data: {
        procurementCost: form.procurementCost || null,
        procurementCostCurrency: form.procurementCostCurrency,
        procurementLeadTime: form.procurementLeadTime || null,
        assemblyTimeHours: form.assemblyTimeHours || null,
        riskScore: riskScore || null,
        riskNotes: riskScore === "High" ? riskNotes.trim() : null,
        mfgLeadtime: form.mfgLeadtime || null,
        prodLeadtime: form.prodLeadtime || null,
        notes: form.notes || null,
      } },
      {
        onSuccess: () => { toast.success("Production output updated"); setEditing(false); onSaved(); },
        onError: () => toast.error("Failed to save changes"),
      }
    );
  }

  const f = (key: keyof typeof form) => ({
    value: form[key] ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((p) => ({ ...p, [key]: e.target.value })),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold text-amber-800">Production Output</CardTitle>
          {canEdit && !editing && (
            <Button variant="ghost" size="sm" onClick={startEdit} className="h-7 px-2 text-slate-500 hover:text-slate-700">
              <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
            </Button>
          )}
          {editing && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-7" onClick={() => setEditing(false)} disabled={isPending}>Cancel</Button>
              <Button size="sm" className="h-7 bg-[#1E3A5F] hover:bg-[#162d4a] text-white" onClick={handleSave} disabled={isPending || !riskScore || (riskScore === "High" && !riskNotes.trim()) || (output.assemblyTimeHours !== null && output.assemblyTimeHours !== undefined && !form.assemblyTimeHours.trim()) || Number(form.assemblyTimeHours) > 1_000_000 || [form.procurementCost, form.procurementLeadTime, form.assemblyTimeHours].some((value) => value !== "" && !validNonNegativeInput(value))}>
                {isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />} Save
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!editing ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            {output.procurementCost !== null && output.procurementCost !== undefined && <DetailField label="Procurement Cost" value={formatMoney(output.procurementCost, output.procurementCostCurrency ?? "USD")} />}
            {output.procurementLeadTime !== null && output.procurementLeadTime !== undefined && <DetailField label="Procurement Lead Time (weeks)" value={output.procurementLeadTime} />}
            {output.assemblyTimeHours !== null && output.assemblyTimeHours !== undefined && <DetailField label="Assembly Time (hours)" value={output.assemblyTimeHours} />}
            {output.assemblyCost !== null && output.assemblyCost !== undefined && <DetailField label="Assembly Cost" value={formatMoney(output.assemblyCost, output.assemblyCostCurrency ?? "USD")} />}
            {output.assemblyLeadTimeWeeks !== null && output.assemblyLeadTimeWeeks !== undefined && <DetailField label="Assembly Lead Time (weeks)" value={output.assemblyLeadTimeWeeks} />}
            {output.riskScore && <DetailField label="Risk Score" value={output.riskScore} />}
            {output.riskScore === "High" && output.riskNotes && <DetailField label="Risk Notes" value={output.riskNotes} fullWidth />}
            {output.assemblyTimeHours !== null && output.assemblyTimeHours !== undefined && output.assemblyCost === null && (
              <p className="text-xs text-slate-500 sm:col-span-2">This previously saved Assembly Time has no calculated estimate. Change the hours and save to calculate it.</p>
            )}
            {(output.mfgLeadtime || output.prodLeadtime) && <p className="text-xs text-slate-500 sm:col-span-2 border-t pt-3">Previously recorded production values</p>}
            {output.mfgLeadtime && <DetailField label="Mfg Lead Time (weeks)" value={output.mfgLeadtime} />}
            {output.prodLeadtime && <DetailField label="Prod Lead Time (weeks)" value={output.prodLeadtime} />}
            {output.notes && <DetailField label="Notes" value={output.notes} fullWidth />}
            {!output.procurementCost && !output.procurementLeadTime && !output.assemblyTimeHours && !output.mfgLeadtime && !output.prodLeadtime && !output.notes && !output.riskScore && (
              <p className="text-sm text-slate-400 sm:col-span-2">No output recorded yet.</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Procurement Cost</Label>
              <div className="flex overflow-hidden rounded-md border border-input bg-background shadow-sm focus-within:ring-1 focus-within:ring-ring">
                <MoneyInput currency={form.procurementCostCurrency} className="h-9 rounded-none border-0 shadow-none focus-visible:ring-0" {...f("procurementCost")} />
                <CurrencySelect value={form.procurementCostCurrency} onValueChange={(value) => setForm((p) => ({ ...p, procurementCostCurrency: value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Procurement Lead Time (weeks)</Label>
              <Input type="number" min="0" step="any" {...f("procurementLeadTime")} />
            </div>
            <div className="space-y-1">
              <Label required={output.assemblyTimeHours !== null && output.assemblyTimeHours !== undefined}>Assembly Time (hours)</Label>
              <Input type="number" min="0" step="any" {...f("assemblyTimeHours")} />
            </div>
            {(output.mfgLeadtime || output.prodLeadtime) && <p className="text-xs text-slate-500 sm:col-span-2 border-t pt-3">Previously recorded production values</p>}
            <div className="sm:col-span-2">
              <RiskScoreFields score={riskScore} notes={riskNotes} onScoreChange={setRiskScore} onNotesChange={setRiskNotes} />
            </div>
            {output.mfgLeadtime && <div className="space-y-1"><Label>Mfg Lead Time (weeks)</Label><Input {...f("mfgLeadtime")} /></div>}
            {output.prodLeadtime && <div className="space-y-1"><Label>Prod Lead Time (weeks)</Label><Input {...f("prodLeadtime")} /></div>}
            <div className="space-y-1 sm:col-span-2"><Label>Notes</Label><Textarea rows={2} {...f("notes")} /></div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Editable ART Final Output ───────────────────────────────────────────────

function EditableArtFinalOutput({
  output,
  etoId,
  canEdit,
  onSaved,
}: {
  output: ArtFinalOutput;
  etoId: number;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    marketPrice: moneyInputValue(output.marketPrice),
    marketPriceCurrency: (output.marketPriceCurrency ?? "USD") as Currency,
    marketLeadtime: output.marketLeadtime ?? "",
    quoteDescription: output.quoteDescription ?? "",
    notes: output.notes ?? "",
  });
  const { mutate: upsert, isPending } = useUpsertArtFinalOutput();

  function startEdit() {
    setForm({
      marketPrice: moneyInputValue(output.marketPrice),
      marketPriceCurrency: (output.marketPriceCurrency ?? "USD") as Currency,
      marketLeadtime: output.marketLeadtime ?? "",
      quoteDescription: output.quoteDescription ?? "",
      notes: output.notes ?? "",
    });
    setEditing(true);
  }

  function handleSave() {
    upsert(
      { id: etoId, data: {
        marketPrice: form.marketPrice || null,
        marketPriceCurrency: form.marketPriceCurrency,
        marketLeadtime: form.marketLeadtime || null,
        quoteDescription: form.quoteDescription.trim(),
        notes: form.notes || null,
      } },
      {
        onSuccess: () => { toast.success("ART Final output updated"); setEditing(false); onSaved(); },
        onError: () => toast.error("Failed to save changes"),
      }
    );
  }

  const f = (key: keyof typeof form) => ({
    value: form[key] ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((p) => ({ ...p, [key]: e.target.value })),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold text-cyan-800">ART Final Output</CardTitle>
          {canEdit && !editing && (
            <Button variant="ghost" size="sm" onClick={startEdit} className="h-7 px-2 text-slate-500 hover:text-slate-700">
              <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
            </Button>
          )}
          {editing && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-7" onClick={() => setEditing(false)} disabled={isPending}>Cancel</Button>
              <Button size="sm" className="h-7 bg-[#1E3A5F] hover:bg-[#162d4a] text-white" onClick={handleSave} disabled={isPending || !form.quoteDescription.trim()}>
                {isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />} Save
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!editing ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            {output.marketPrice && <DetailField label="Market Price" value={formatMoney(output.marketPrice, output.marketPriceCurrency ?? "USD")} />}
            {output.marketLeadtime && <DetailField label="Market Lead Time (weeks)" value={output.marketLeadtime} />}
            {output.quoteDescription && <DetailField label="Quote Description" value={output.quoteDescription} fullWidth />}
            {output.notes && <DetailField label="Notes" value={output.notes} fullWidth />}
            {!output.marketPrice && !output.marketLeadtime && !output.quoteDescription && !output.notes && (
              <p className="text-sm text-slate-400 sm:col-span-2">No output recorded yet.</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Market Price</Label>
              <div className="flex overflow-hidden rounded-md border border-input bg-background shadow-sm focus-within:ring-1 focus-within:ring-ring">
                <MoneyInput currency={form.marketPriceCurrency}
                  className="h-9 rounded-none border-0 shadow-none focus-visible:ring-0"
                  {...f("marketPrice")}
                />
                <CurrencySelect
                  value={form.marketPriceCurrency}
                  onValueChange={(value) => setForm((p) => ({ ...p, marketPriceCurrency: value }))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Market Lead Time (weeks)</Label>
                <Input {...f("marketLeadtime")} />
            </div>
            <div className="space-y-1 sm:col-span-2"><Label htmlFor="edit-quote-description" required>Description</Label><Textarea id="edit-quote-description" rows={3} required {...f("quoteDescription")} /></div>
            <div className="space-y-1 sm:col-span-2"><Label>Notes</Label><Textarea rows={2} {...f("notes")} /></div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function CurrencySelect({
  value,
  onValueChange,
}: {
  value: Currency;
  onValueChange: (value: Currency) => void;
}) {
  return (
    <Select value={value} onValueChange={(next) => onValueChange(next as Currency)}>
      <SelectTrigger className="h-9 w-24 shrink-0 rounded-none border-0 border-l border-input bg-slate-50 px-2 shadow-none focus:ring-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CURRENCY_OPTIONS.map((currency) => (
          <SelectItem key={currency} value={currency}>{currency}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DetailField({
  label,
  value,
  fullWidth = false,
  capitalize = false,
  className = "",
}: {
  label: string;
  value: string;
  fullWidth?: boolean;
  capitalize?: boolean;
  className?: string;
}) {
  return (
    <div className={fullWidth ? "sm:col-span-2" : ""}>
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-0.5">{label}</p>
      <p className={`text-slate-800 ${capitalize ? "capitalize" : ""} ${className}`}>{value}</p>
    </div>
  );
}
