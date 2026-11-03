import { useRef, useState } from "react";
import { etoLabel } from "@/lib/eto-label";
import { useLocation } from "wouter";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useCreateEtoRequest,
  useRequestUploadUrl,
  useCreateAttachment,
  useGetMe,
  useListEtoRequests,
} from "@workspace/api-client-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/MoneyInput";
import { isWholeBudget } from "@/lib/money";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RequiredMark } from "@/components/RequiredMark";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Loader2, Paperclip, X, FileText, UploadCloud } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

// ─── Dropdown options ─────────────────────────────────────────────────────────

const DISTRIBUTOR_OPTIONS = ["Yes", "No"] as const;

const REQUEST_TYPE_OPTIONS = [
  "Accessory",
  "Environmental testing",
  "Software",
  "Load Frame",
  "Retrofit",
  "Automation",
] as const;

const MACHINE_TYPE_OPTIONS = ["ST", "SL", "Impact", "MFI", "HDVT", "Other"] as const;
const CURRENCY_OPTIONS = ["USD", "GBP", "EUR", "CNY"] as const;
const FORCE_UNIT_OPTIONS = ["kN", "lbs", "N"] as const;
const DISPLACEMENT_UNIT_OPTIONS = ["mm", "in"] as const;

// ─── Form schema ──────────────────────────────────────────────────────────────

const schema = z.object({
  customerName: z.string().min(1, "Customer name is required"),
  quoteNumber: z.string().min(1, "Quote number is required"),
  distributor: z.enum(DISTRIBUTOR_OPTIONS, { required_error: "Please select Yes or No" }),
  requestType: z.enum(REQUEST_TYPE_OPTIONS, { required_error: "Request type is required" }),
  machineType: z.enum(MACHINE_TYPE_OPTIONS, { required_error: "System type is required" }),
  expectedForceRange: z.string().min(1, "Expected force range is required"),
  expectedForceUnit: z.enum(FORCE_UNIT_OPTIONS),
  expectedDisplacement: z.string().min(1, "Expected displacement is required"),
  expectedDisplacementUnit: z.enum(DISPLACEMENT_UNIT_OPTIONS),
  materials: z.string().min(1, "Materials are required"),
  specimenDimensions: z.string().min(1, "Specimen dimensions are required"),
  resultsRequired: z.string().min(1, "Results required is required"),
  customDetails: z.string().min(1, "Custom requests are required"),
  relevantStandards: z.string().optional(),
  budgetRange: z.string().optional().refine(isWholeBudget, "Enter a whole-number amount or range, such as 1000 - 2000"),
  budgetCurrency: z.enum(CURRENCY_OPTIONS),
  acceptableLeadTime: z.string().optional(),
  similarParts: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="text-red-600 text-xs mt-0.5">{msg}</p>;
}


// ─── Component ────────────────────────────────────────────────────────────────

export default function NewEtoRequest() {
  const [, navigate] = useLocation();
  const { mutateAsync: createEto } = useCreateEtoRequest();
  const { mutateAsync: requestUploadUrl } = useRequestUploadUrl();
  const { mutateAsync: createAttachment } = useCreateAttachment();

  const { data: me } = useGetMe();
  // Obtain the trusted epoch even when this form is opened directly, without
  // visiting the list first. It remains pinned across a database cutover.
  const { isLoading: identityLoading, error: identityError } = useListEtoRequests({ limit: 1 });
  const rfqDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      budgetCurrency: "USD",
      expectedForceUnit: "N",
      expectedDisplacementUnit: "mm",
    },
  });

  const [isDragOver, setIsDragOver] = useState(false);

  function addFiles(incoming: FileList | File[] | null) {
    if (!incoming) return;
    const next = Array.from(incoming);
    setQueuedFiles((prev) => {
      const existing = new Set(prev.map((f) => `${f.name}::${f.size}`));
      return [...prev, ...next.filter((f) => !existing.has(`${f.name}::${f.size}`))];
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    addFiles(e.dataTransfer.files);
  }

  function removeFile(index: number) {
    setQueuedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function onSubmit(values: FormValues) {
    setIsSubmitting(true);
    try {
      const newEto = await createEto({
        data: {
          customerName: values.customerName,
          quoteNumber: values.quoteNumber,
          distributor: values.distributor,
          requestType: values.requestType,
          machineType: values.machineType,
          expectedForceRange: values.expectedForceRange,
          expectedForceUnit: values.expectedForceUnit,
          expectedDisplacement: values.expectedDisplacement,
          expectedDisplacementUnit: values.expectedDisplacementUnit,
          materials: values.materials,
          specimenDimensions: values.specimenDimensions,
          resultsRequired: values.resultsRequired,
          customDetails: values.customDetails,
          relevantStandards: values.relevantStandards || undefined,
          budgetRange: values.budgetRange || undefined,
          budgetCurrency: values.budgetCurrency,
          acceptableLeadTime: values.acceptableLeadTime || undefined,
          similarParts: values.similarParts || undefined,
        },
      });

      if (queuedFiles.length > 0) {
        let uploaded = 0;
        let failed = 0;

        await Promise.all(
          queuedFiles.map(async (file) => {
            try {
              const { uploadURL, objectPath } = await requestUploadUrl({
                data: {
                  name: file.name,
                  size: file.size,
                  contentType: file.type || "application/octet-stream",
                  etoRequestId: newEto.id,
                },
              });
              await fetch(uploadURL, {
                method: "PUT",
                body: file,
                headers: { "Content-Type": file.type || "application/octet-stream" },
              });
              await createAttachment({
                id: newEto.id,
                data: {
                  storageKey: objectPath,
                  filename: file.name,
                  fileSize: file.size,
                  contentType: file.type || "application/octet-stream",
                },
              });
              uploaded++;
            } catch {
              failed++;
              toast.error(`Failed to upload ${file.name}`);
            }
          })
        );

        if (uploaded > 0) {
          toast.success(
            `${etoLabel(newEto)} created with ${uploaded} attachment${uploaded !== 1 ? "s" : ""}`
          );
        } else {
          toast.success(`${etoLabel(newEto)} created successfully`);
        }
        if (failed > 0) toast.warning(`${failed} file${failed !== 1 ? "s" : ""} could not be uploaded`);
      } else {
        toast.success(`${etoLabel(newEto)} created successfully`);
      }

      navigate(`/eto-requests/${newEto.id}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create ETO request";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (me && me.role !== "sales" && me.role !== "superuser") {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Card>
          <CardContent className="py-12 text-center">
            <h1 className="text-xl font-semibold text-slate-900">Sales access required</h1>
            <p className="mt-2 text-sm text-slate-500">
              New ETO requests can only be created by the Sales role.
            </p>
            <Button asChild variant="outline" className="mt-5">
              <Link href="/eto-requests">Back to ETO requests</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {identityError && (
        <p className="text-sm text-red-600" role="alert">
          Could not verify the current dataset. Reload this page before creating an ETO.
        </p>
      )}
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/eto-requests" className="text-slate-500 hover:text-slate-700 transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">New ETO Request</h1>
          <p className="text-slate-500 text-sm mt-1">Save a draft. An ETO number is assigned when you submit it to ART Review.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">

        {/* ── Card 1: Customer & Quote ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold text-slate-800">
              Customer &amp; Quote Information
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">

            <div className="space-y-1.5">
              <Label htmlFor="customerName">Customer Name <RequiredMark /></Label>
              <Input id="customerName" {...register("customerName")} />
              <FieldError msg={errors.customerName?.message} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="quoteNumber">Quote Number <RequiredMark /></Label>
              <Input id="quoteNumber" {...register("quoteNumber")} />
              <FieldError msg={errors.quoteNumber?.message} />
            </div>

            <div className="space-y-1.5">
              <Label>RFQ Date</Label>
              <Input value={rfqDate} readOnly className="bg-slate-50 text-slate-500 cursor-default" />
            </div>

            <div className="space-y-1.5">
              <Label>Sales Person</Label>
              <Input value={me?.name ?? "—"} readOnly className="bg-slate-50 text-slate-500 cursor-default" />
            </div>

            <div className="space-y-1.5">
              <Label>Distributor <RequiredMark /></Label>
              <Controller
                name="distributor"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      {DISTRIBUTOR_OPTIONS.map((o) => (
                        <SelectItem key={o} value={o}>{o}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError msg={errors.distributor?.message} />
            </div>

          </CardContent>
        </Card>

        {/* ── Card 2: Request Classification ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold text-slate-800">
              Request Classification
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">

            <div className="space-y-1.5">
              <Label>Request Type <RequiredMark /></Label>
              <Controller
                name="requestType"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select type…" />
                    </SelectTrigger>
                    <SelectContent>
                      {REQUEST_TYPE_OPTIONS.map((o) => (
                        <SelectItem key={o} value={o}>{o}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError msg={errors.requestType?.message} />
            </div>

            <div className="space-y-1.5">
              <Label>System Type <RequiredMark /></Label>
              <Controller
                name="machineType"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select machine…" />
                    </SelectTrigger>
                    <SelectContent>
                      {MACHINE_TYPE_OPTIONS.map((o) => (
                        <SelectItem key={o} value={o}>{o}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError msg={errors.machineType?.message} />
            </div>

          </CardContent>
        </Card>

        {/* ── Card 3: Test Requirements ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold text-slate-800">
              Test Requirements
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">

            <div className="space-y-1.5">
              <Label htmlFor="expectedForceRange">Expected Force Range <RequiredMark /></Label>
              <div className="flex overflow-hidden rounded-md border border-input bg-background shadow-sm focus-within:ring-1 focus-within:ring-ring">
                <Input
                  id="expectedForceRange"
                  className="h-9 rounded-none border-0 shadow-none focus-visible:ring-0"
                  {...register("expectedForceRange")}
                />
                <Controller
                  name="expectedForceUnit"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
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
                  )}
                />
              </div>
              <FieldError msg={errors.expectedForceRange?.message} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="expectedDisplacement">Expected Displacement <RequiredMark /></Label>
              <div className="flex overflow-hidden rounded-md border border-input bg-background shadow-sm focus-within:ring-1 focus-within:ring-ring">
                <Input
                  id="expectedDisplacement"
                  className="h-9 rounded-none border-0 shadow-none focus-visible:ring-0"
                  {...register("expectedDisplacement")}
                />
                <Controller
                  name="expectedDisplacementUnit"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
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
                  )}
                />
              </div>
              <FieldError msg={errors.expectedDisplacement?.message} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="materials">Materials to be Tested <RequiredMark /></Label>
              <Input
                id="materials"
                {...register("materials")}
              />
              <FieldError msg={errors.materials?.message} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="specimenDimensions">Specimen Dimensions <RequiredMark /></Label>
              <Input
                id="specimenDimensions"
                {...register("specimenDimensions")}
              />
              <FieldError msg={errors.specimenDimensions?.message} />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="resultsRequired">Results Required <RequiredMark /></Label>
              <Input
                id="resultsRequired"
                {...register("resultsRequired")}
              />
              <FieldError msg={errors.resultsRequired?.message} />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="relevantStandards">Relevant Standard</Label>
              <Input
                id="relevantStandards"
                {...register("relevantStandards")}
              />
            </div>

          </CardContent>
        </Card>

        {/* ── Card 4: Additional Details ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold text-slate-800">
              Additional Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">

            <div className="space-y-1.5">
              <Label htmlFor="customDetails">Custom Requests <RequiredMark /></Label>
              <Textarea
                id="customDetails"
                rows={4}
                {...register("customDetails")}
              />
              <FieldError msg={errors.customDetails?.message} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="budgetRange">Budget Range</Label>
                <div className="flex overflow-hidden rounded-md border border-input bg-background shadow-sm focus-within:ring-1 focus-within:ring-ring">
                  <MoneyInput range currency={watch("budgetCurrency") ?? "USD"}
                    id="budgetRange"
                    className="h-9 rounded-none border-0 shadow-none focus-visible:ring-0"
                    {...register("budgetRange")}
                  />
                  <Controller
                    name="budgetCurrency"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger className="h-9 w-24 shrink-0 rounded-none border-0 border-l border-input bg-slate-50 px-2 shadow-none focus:ring-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CURRENCY_OPTIONS.map((currency) => (
                            <SelectItem key={currency} value={currency}>{currency}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                <FieldError msg={errors.budgetRange?.message} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="acceptableLeadTime">Acceptable Lead Time (weeks)</Label>
                <Input
                  id="acceptableLeadTime"
                  {...register("acceptableLeadTime")}
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="similarParts">Similar Parts or Machines</Label>
                <Input
                  id="similarParts"
                  {...register("similarParts")}
                />
              </div>
            </div>

          </CardContent>
        </Card>

        {/* ── Card 5: Attachments ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
              <Paperclip className="h-4 w-4" />
              Attachments
              {queuedFiles.length > 0 && (
                <span className="text-xs font-normal text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                  {queuedFiles.length}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {queuedFiles.length > 0 && (
              <ul className="space-y-2">
                {queuedFiles.map((file, i) => (
                  <li
                    key={`${file.name}::${file.size}::${i}`}
                    className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-700">{file.name}</p>
                      <p className="text-xs text-slate-400">{formatBytes(file.size)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition-colors"
                      aria-label={`Remove ${file.name}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />

            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={cn(
                "w-full flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-6 text-sm transition-colors cursor-pointer select-none",
                isDragOver
                  ? "border-[#1E3A5F] bg-blue-50"
                  : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
              )}
            >
              <UploadCloud className={cn("h-6 w-6 transition-colors", isDragOver ? "text-[#1E3A5F]" : "text-slate-400")} />
              <span className={cn("font-medium transition-colors", isDragOver ? "text-[#1E3A5F]" : "text-slate-600")}>
                {isDragOver ? "Drop files here" : "Drag & drop files, or click to browse"}
              </span>
              <span className="text-xs text-slate-400">Any file type · up to 50 MB each</span>
            </div>
          </CardContent>
        </Card>

        {/* ── Submit ── */}
        <div className="flex items-center gap-3 justify-end">
          <Link href="/eto-requests">
            <Button type="button" variant="outline" disabled={isSubmitting}>
              Cancel
            </Button>
          </Link>
          <Button
            type="submit"
            disabled={isSubmitting || identityLoading || !!identityError}
            className="bg-[#1E3A5F] hover:bg-[#162d4a] text-white"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isSubmitting
              ? queuedFiles.length > 0
                ? "Uploading…"
                : "Saving…"
              : "Create Draft"}
          </Button>
        </div>

      </form>
    </div>
  );
}
