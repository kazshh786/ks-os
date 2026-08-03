import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  Globe2,
  Loader2,
  Palette,
  Plus,
  Rocket,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import { Link, useParams } from "react-router";
import {
  SITE_DESIGN_PRESETS,
  siteThemeAccessibilityIssues,
  type SiteDesignPreset,
  type SiteDesignPresetKey,
} from "@ks-os/contracts";
import { agencyFetch, useAgencyAuth } from "./AgencyAuth";

const PAGE_TYPES = [
  "HOME",
  "SERVICE_HUB",
  "SERVICE_DETAIL",
  "LOCATION_DETAIL",
  "ABOUT",
  "TEAM_HUB",
  "TEAM_DETAIL",
  "CONTACT",
  "FAQ",
  "POLICIES",
  "RESULTS",
  "NEW_CLIENT_GUIDE",
  "AFTERCARE_GUIDE",
  "CONSULTATION_GUIDE",
  "BOOKING",
] as const;
const DEFAULT_PAGE_TYPES = [
  "HOME",
  "SERVICE_HUB",
  "SERVICE_DETAIL",
  "LOCATION_DETAIL",
  "ABOUT",
  "CONTACT",
  "FAQ",
  "POLICIES",
  "NEW_CLIENT_GUIDE",
  "AFTERCARE_GUIDE",
  "CONSULTATION_GUIDE",
  "BOOKING",
];
const TERMINAL_RUNS = new Set([
  "READY",
  "FAILED",
  "PARTIALLY_FAILED",
  "ACTION_REQUIRED",
  "CANCELLED",
]);
const EDITABLE_DRAFTS = new Set(["DRAFT", "VALIDATING", "READY_TO_PROVISION"]);
const COMPLETE_STAGE_STATUSES = new Set(["COMPLETE", "SKIPPED"]);
const COMMERCIAL_STAGE_KEYS = [
  "SALE_HANDOVER",
  "CONTRACT",
  "SETUP_FEE",
  "DIRECT_DEBIT",
] as const;

type DesignSource = "KS_NATIVE" | "GOOGLE_STITCH" | "LICENSED_TEMPLATE";
type NativeThemeMode = "PRESET" | "LIBRARY";
type SectionVariant =
  | "editorial"
  | "grid"
  | "split"
  | "compact"
  | "standard"
  | "featured"
  | "quiet";
type ColourKey = keyof ThemeColours;

type ThemeColours = {
  primaryColour: string;
  secondaryColour: string;
  accentColour: string;
  backgroundColour: string;
  surfaceColour: string;
  textColour: string;
  mutedTextColour: string;
  borderColour: string;
};

type ThemeRecord = ThemeColours & Record<string, unknown>;
type PaymentPreference = {
  allowPayLater: boolean;
  onlinePaymentsRequested: boolean;
  depositCollectionRequested: boolean;
};
type OnboardingStage = {
  id: string;
  stageKey: string;
  status: string;
  dueAt?: string | null;
  notes?: string | null;
  blockerNote?: string | null;
};
type Onboarding = {
  status: string;
  completionPercentage: number;
  stages: OnboardingStage[];
};
type LibraryTheme = {
  reference: string;
  name: string;
  description: string;
  theme: ThemeRecord;
  preview: Record<string, unknown>;
};

type ServiceDraft = {
  name: string;
  description: string;
  durationMinutes: string;
  price: string;
};

const EMPTY_SERVICE: ServiceDraft = {
  name: "",
  description: "",
  durationMinutes: "30",
  price: "",
};
const DEFAULT_COLOURS: ThemeColours = {
  primaryColour: "#2A1F4F",
  secondaryColour: "#51407A",
  accentColour: "#B54B78",
  backgroundColour: "#FAF8FF",
  surfaceColour: "#FFFFFF",
  textColour: "#211A3B",
  mutedTextColour: "#5A536E",
  borderColour: "#DDD7EA",
};
const colourLabels: Record<ColourKey, string> = {
  primaryColour: "Primary",
  secondaryColour: "Secondary",
  accentColour: "Accent",
  backgroundColour: "Background",
  surfaceColour: "Surface",
  textColour: "Text",
  mutedTextColour: "Muted text",
  borderColour: "Border",
};
const commercialDefinitions: Record<
  string,
  { title: string; description: string; owner: string }
> = {
  SALE_HANDOVER: {
    title: "Sales handover",
    description: "Confirm package, scope, contact and promises.",
    owner: "Agency",
  },
  CONTRACT: {
    title: "Contract",
    description: "Confirm the signed agreement and approved scope.",
    owner: "Client and agency",
  },
  SETUP_FEE: {
    title: "Setup fee",
    description: "Confirm the setup fee is paid or waived.",
    owner: "Agency",
  },
  DIRECT_DEBIT: {
    title: "Direct Debit",
    description: "Confirm the recurring mandate is active.",
    owner: "Client",
  },
};
const tone: Record<string, string> = {
  READY: "border-emerald-700 bg-emerald-950/35 text-emerald-200",
  COMPLETE: "border-emerald-700 bg-emerald-950/35 text-emerald-200",
  ACTIVE: "border-emerald-700 bg-emerald-950/35 text-emerald-200",
  LIVE: "border-emerald-700 bg-emerald-950/35 text-emerald-200",
  PASS: "border-emerald-700 bg-emerald-950/35 text-emerald-200",
  ACTION_REQUIRED: "border-amber-700 bg-amber-950/35 text-amber-200",
  DNS_REVIEW_REQUIRED: "border-amber-700 bg-amber-950/35 text-amber-200",
  WARNING: "border-amber-700 bg-amber-950/35 text-amber-200",
  BLOCKED: "border-rose-800 bg-rose-950/35 text-rose-200",
  BLOCKING: "border-rose-800 bg-rose-950/35 text-rose-200",
  FAILED: "border-rose-800 bg-rose-950/35 text-rose-200",
  IN_PROGRESS: "border-violet-700 bg-violet-950/35 text-violet-200",
  QUEUED: "border-violet-700 bg-violet-950/35 text-violet-200",
  READY_TO_PROVISION: "border-violet-700 bg-violet-950/35 text-violet-200",
  NOT_STARTED: "border-slate-800 bg-slate-950 text-slate-400",
  PENDING: "border-slate-800 bg-slate-950 text-slate-400",
  SKIPPED: "border-slate-700 bg-slate-900 text-slate-300",
};
const label = (value?: string) => (value || "NOT_STARTED").replaceAll("_", " ");
const statusClass = (value?: string) =>
  tone[value || "NOT_STARTED"] || tone.IN_PROGRESS;

function Status({ value }: { value?: string }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${statusClass(value)}`}
    >
      {label(value)}
    </span>
  );
}
function Panel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-900/85 p-5 shadow-xl shadow-slate-950/20 sm:p-6">
      <div className="flex flex-col gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-black text-white">{title}</h2>
          {description ? (
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">
              {description}
            </p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="pt-5">{children}</div>
    </section>
  );
}
function Stage({
  index,
  title,
  detail,
  ready,
  icon: Icon,
}: {
  index: number;
  title: string;
  detail: string;
  ready: boolean;
  icon: React.ElementType;
}) {
  return (
    <li
      className={`rounded-2xl border p-4 ${ready ? tone.READY : tone.NOT_STARTED}`}
    >
      <div className="flex items-center justify-between">
        <Icon className="h-5 w-5" />
        <span className="text-[10px] font-black">{index}/7</span>
      </div>
      <strong className="mt-4 block text-xs">{title}</strong>
      <p className="mt-1 text-[11px] leading-4 opacity-70">{detail}</p>
    </li>
  );
}
function Metric({
  title,
  value,
  detail,
}: {
  title: string;
  value: React.ReactNode;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
      <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">
        {title}
      </p>
      <p className="mt-2 text-xl font-black text-white">{value}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
    </div>
  );
}
function coloursFromTheme(
  theme: Record<string, unknown> | undefined,
): ThemeColours {
  const output = { ...DEFAULT_COLOURS };
  for (const key of Object.keys(output) as ColourKey[]) {
    const value = theme?.[key];
    if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value))
      output[key] = value.toUpperCase();
  }
  return output;
}
function ThemePreview({ name, theme }: { name: string; theme: ThemeRecord }) {
  const merged = { ...DEFAULT_COLOURS, ...theme };
  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={{
        backgroundColor: merged.backgroundColour,
        borderColor: merged.borderColour,
        color: merged.textColour,
      }}
    >
      <div
        className="flex h-10 items-center justify-between border-b px-3 text-[8px]"
        style={{
          backgroundColor: merged.surfaceColour,
          borderColor: merged.borderColour,
        }}
      >
        <strong>{name}</strong>
        <span style={{ color: merged.mutedTextColour }}>
          Home · Services · About
        </span>
        <span
          className="rounded px-2 py-1 font-black text-white"
          style={{ backgroundColor: merged.primaryColour }}
        >
          Book now
        </span>
      </div>
      <div className="grid aspect-[16/7] grid-cols-2 items-center gap-4 p-4">
        <div>
          <p
            className="text-[7px] font-black uppercase"
            style={{ color: merged.accentColour }}
          >
            Booking-led website
          </p>
          <p className="mt-2 text-base font-black leading-none">
            A clear route from interest to appointment
          </p>
        </div>
        <div
          className="h-full rounded-lg"
          style={{
            background: `linear-gradient(135deg, ${merged.secondaryColour}, ${merged.primaryColour})`,
          }}
        />
      </div>
    </div>
  );
}
function ColourEditor({
  values,
  onChange,
}: {
  values: ThemeColours;
  onChange: (key: ColourKey, value: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {(Object.keys(colourLabels) as ColourKey[]).map((key) => (
        <label key={key} className="text-xs font-bold text-slate-300">
          {colourLabels[key]}
          <span className="mt-2 flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-2">
            <input
              type="color"
              value={values[key]}
              onChange={(event) =>
                onChange(key, event.target.value.toUpperCase())
              }
              className="h-8 w-10 cursor-pointer bg-transparent"
            />
            <input
              value={values[key]}
              onChange={(event) =>
                onChange(key, event.target.value.toUpperCase())
              }
              maxLength={7}
              aria-label={`${colourLabels[key]} hex colour`}
              className="min-w-0 flex-1 bg-transparent font-mono text-xs text-white outline-none"
            />
          </span>
        </label>
      ))}
    </div>
  );
}

export function AgencyWorkspaceLaunchPipeline({
  tenantIdOverride,
  onBack,
}: { tenantIdOverride?: string; onBack?: () => void } = {}) {
  const params = useParams();
  const tenantId = tenantIdOverride || params.tenantId;
  const { session } = useAgencyAuth();
  const [detail, setDetail] = useState<any>(null);
  const [context, setContext] = useState<any>(null);
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null);
  const [booking, setBooking] = useState<any>(null);
  const [domains, setDomains] = useState<any[]>([]);
  const [studio, setStudio] = useState<any>(null);
  const [qualityRuns, setQualityRuns] = useState<any[]>([]);
  const [designSource, setDesignSource] = useState<DesignSource>("KS_NATIVE");
  const [nativeThemeMode, setNativeThemeMode] =
    useState<NativeThemeMode>("PRESET");
  const [presetKey, setPresetKey] = useState<SiteDesignPresetKey>("NORTHLIGHT");
  const [libraryThemeReference, setLibraryThemeReference] = useState("");
  const [defaultSectionVariant, setDefaultSectionVariant] =
    useState<SectionVariant>("standard");
  const [templateReference, setTemplateReference] = useState("");
  const [customColours, setCustomColours] = useState(false);
  const [colourOverrides, setColourOverrides] =
    useState<ThemeColours>(DEFAULT_COLOURS);
  const [pageTypes, setPageTypes] = useState<string[]>(DEFAULT_PAGE_TYPES);
  const [paymentPreference, setPaymentPreference] = useState<PaymentPreference>(
    {
      allowPayLater: true,
      onlinePaymentsRequested: false,
      depositCollectionRequested: false,
    },
  );
  const [serviceDraft, setServiceDraft] = useState<ServiceDraft>(EMPTY_SERVICE);
  const [showServiceForm, setShowServiceForm] = useState(false);
  const [customHostname, setCustomHostname] = useState("");
  const [domainDetails, setDomainDetails] = useState<any>(null);
  const [launchChecks, setLaunchChecks] = useState<any[]>([]);
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const canManageStages = Boolean(
    session?.capabilities.includes("tenants.manage"),
  );
  const canProvision = Boolean(
    session?.capabilities.includes("provisioning.create") &&
      session.capabilities.includes("provisioning.update") &&
      session.capabilities.includes("provisioning.execute"),
  );
  const canPublish = Boolean(
    session?.capabilities.includes("sites.publications.create"),
  );

  const load = useCallback(
    async (showLoading = true) => {
      if (!tenantId) return;
      if (showLoading) setLoading(true);
      setError("");
      try {
        const [nextDetail, nextContext, nextOnboarding, nextBooking] =
          await Promise.all([
            agencyFetch(`/tenants/${tenantId}`),
            agencyFetch(`/tenants/${tenantId}/delivery-context`),
            agencyFetch(`/tenants/${tenantId}/onboarding`),
            agencyFetch(`/tenants/${tenantId}/onboarding-booking`),
          ]);
        setDetail(nextDetail);
        setContext(nextContext);
        setOnboarding(nextOnboarding);
        setBooking(nextBooking);
        const savedDesign = nextContext.draft?.pagePlan?.design || {};
        const inferredSource: DesignSource = savedDesign.source || "KS_NATIVE";
        const assignedReference =
          nextContext.designLibrary?.assignedTheme?.reference || "";
        const selectedLibrary =
          savedDesign.libraryItemReference || assignedReference;
        const selectedPreset =
          savedDesign.presetKey ||
          nextContext.designLibrary?.defaultPresetKey ||
          "NORTHLIGHT";
        setDesignSource(inferredSource);
        setNativeThemeMode(selectedLibrary ? "LIBRARY" : "PRESET");
        setLibraryThemeReference(selectedLibrary);
        setPresetKey(selectedPreset);
        setDefaultSectionVariant(
          savedDesign.defaultSectionVariant || "standard",
        );
        setTemplateReference(
          inferredSource === "KS_NATIVE"
            ? ""
            : nextContext.draft?.templateVersionReference || "",
        );
        setPageTypes(
          nextContext.draft?.pagePlan?.requestedPageTypes?.length
            ? nextContext.draft.pagePlan.requestedPageTypes
            : DEFAULT_PAGE_TYPES,
        );
        setPaymentPreference(
          nextContext.draft?.paymentPreference || {
            allowPayLater: true,
            onlinePaymentsRequested: false,
            depositCollectionRequested: false,
          },
        );
        const presets: SiteDesignPreset[] =
          nextContext.designLibrary?.presets || SITE_DESIGN_PRESETS;
        const themes: LibraryTheme[] = nextContext.designLibrary?.themes || [];
        const base = selectedLibrary
          ? themes.find((theme) => theme.reference === selectedLibrary)?.theme
          : presets.find((item) => item.key === selectedPreset)?.theme;
        const savedOverrides =
          savedDesign.themeOverrides &&
          Object.keys(savedDesign.themeOverrides).length
            ? savedDesign.themeOverrides
            : null;
        setCustomColours(Boolean(savedOverrides));
        setColourOverrides({
          ...coloursFromTheme(base),
          ...(savedOverrides || {}),
        });
        const siteReference =
          nextContext.site?.reference || nextContext.run?.siteReference;
        if (siteReference) {
          const [nextDomains, nextStudio, nextQuality] = await Promise.all([
            agencyFetch(`/sites/${siteReference}/domains`).catch(() => []),
            agencyFetch(`/sites/${siteReference}/studio`).catch(() => null),
            agencyFetch(`/sites/${siteReference}/quality-runs`).catch(() => []),
          ]);
          setDomains(nextDomains);
          setStudio(nextStudio);
          setQualityRuns(nextQuality);
        } else {
          setDomains([]);
          setStudio(null);
          setQualityRuns([]);
        }
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "The client launch pipeline could not be loaded.",
        );
      } finally {
        setLoading(false);
      }
    },
    [tenantId],
  );

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const reference = context?.run?.reference;
    if (!reference || TERMINAL_RUNS.has(context.run.status)) return;
    const timer = window.setInterval(
      () =>
        void agencyFetch(`/provisioning-runs/${reference}`)
          .then((run) => {
            setContext((current: any) =>
              current ? { ...current, run } : current,
            );
            if (TERMINAL_RUNS.has(run.status)) void load(false);
          })
          .catch(() => undefined),
      3_000,
    );
    return () => window.clearInterval(timer);
  }, [context?.run?.reference, context?.run?.status, load]);

  const commercialStages = useMemo(
    () =>
      COMMERCIAL_STAGE_KEYS.map((stageKey) =>
        onboarding?.stages.find((stage) => stage.stageKey === stageKey),
      ).filter(Boolean) as OnboardingStage[],
    [onboarding],
  );
  const commercialReady =
    commercialStages.length > 0 &&
    commercialStages.every((stage) =>
      COMPLETE_STAGE_STATUSES.has(stage.status),
    );
  const presets: SiteDesignPreset[] =
    context?.designLibrary?.presets || SITE_DESIGN_PRESETS;
  const libraryThemes: LibraryTheme[] = context?.designLibrary?.themes || [];
  const selectedPreset =
    presets.find((item) => item.key === presetKey) || presets[0];
  const selectedLibraryTheme =
    libraryThemes.find((theme) => theme.reference === libraryThemeReference) ||
    null;
  const selectedBaseTheme =
    (nativeThemeMode === "LIBRARY"
      ? selectedLibraryTheme?.theme
      : selectedPreset?.theme) || DEFAULT_COLOURS;
  const effectiveTheme = {
    ...selectedBaseTheme,
    ...(customColours ? colourOverrides : {}),
  } as ThemeRecord;
  const colourIssues = customColours
    ? siteThemeAccessibilityIssues(effectiveTheme as any)
    : [];
  const nativeTemplateReference =
    context?.designLibrary?.nativeTemplateVersionReference || "";
  const technicalTemplateReference =
    designSource === "KS_NATIVE" ? nativeTemplateReference : templateReference;
  const advancedTemplates = (context?.approvedTemplates || []).filter(
    (template: any) =>
      designSource === "GOOGLE_STITCH"
        ? template.sourceType === "GOOGLE_STITCH"
        : template.sourceType === "ENVATO_HTML",
  );
  const run = context?.run;
  const activeRun = Boolean(run && !TERMINAL_RUNS.has(run.status));
  const tenant = detail?.tenant || context?.tenant;
  const workspaceActive = tenant?.lifecycleStatus === "ACTIVE";
  const planLocked = Boolean(
    run || (context?.draft && !EDITABLE_DRAFTS.has(context.draft.status)),
  );
  const knowledgeReady = context?.knowledge?.ready === true;
  const briefReady =
    context?.productionBrief?.status === "LOCKED_FOR_PROVISIONING" &&
    context.productionBrief?.readyForProvisioning;
  const bookingReady = booking?.readiness?.readyForBuild === true;
  const siteReference = context?.site?.reference || run?.siteReference;
  const fallbackDomain = domains.find(
    (domain) => domain.domainType === "FALLBACK",
  );
  const customDomain =
    domains.find(
      (domain) =>
        domain.domainType === "CUSTOM" && domain.domainRole === "CANONICAL",
    ) || domains.find((domain) => domain.domainType === "CUSTOM");
  const stagingHostname =
    fallbackDomain?.hostname ||
    (tenant?.subdomain ? `${tenant.subdomain}.sites.kasimshah.com` : "");
  const customLive =
    customDomain?.status === "ACTIVE" &&
    customDomain?.domainRole === "CANONICAL";
  const latestQuality = qualityRuns[0];
  const qualityReady =
    ["READY", "PASS"].includes(latestQuality?.publicationGateStatus) ||
    latestQuality?.status === "COMPLETED";
  const reviewReady =
    context?.readiness?.review === "READY" ||
    studio?.version?.status === "APPROVED";
  const published =
    studio?.publication?.status === "LIVE" ||
    context?.readiness?.publication === "READY";

  const draftBody = useMemo(
    () =>
      context
        ? {
            productionBriefReference: context.productionBrief?.reference,
            planVersionReference: context.plan?.versionReference,
            workspace: {
              name: context.tenant.name,
              subdomain: context.tenant.subdomain,
              timezone: context.tenant.timezone,
              currency: context.tenant.currency,
            },
            templateVersionReference: technicalTemplateReference,
            pagePlan: {
              requestedPageTypes: pageTypes,
              targetMarketingPageCount: 10,
              preferredLayoutReferences: {},
              design: {
                source: designSource,
                presetKey,
                defaultSectionVariant,
                ...(designSource === "KS_NATIVE" &&
                nativeThemeMode === "LIBRARY" &&
                libraryThemeReference
                  ? { libraryItemReference: libraryThemeReference }
                  : {}),
                ...(designSource === "KS_NATIVE" && customColours
                  ? { themeOverrides: colourOverrides }
                  : {}),
              },
            },
            paymentPreference,
          }
        : null,
    [
      colourOverrides,
      context,
      customColours,
      defaultSectionVariant,
      designSource,
      libraryThemeReference,
      nativeThemeMode,
      pageTypes,
      paymentPreference,
      presetKey,
      technicalTemplateReference,
    ],
  );

  const prerequisites = [
    {
      label: "Commercial gates complete",
      ready: commercialReady,
      action: "Complete the contract, fee and subscription gates.",
    },
    {
      label: "Production brief locked",
      ready: Boolean(briefReady),
      action: "Complete and lock fact finding.",
    },
    {
      label: "Booking setup ready",
      ready: bookingReady,
      action:
        "Add a service, location, bookable staff member, availability and assignment.",
    },
    {
      label: "Knowledge pack active",
      ready: knowledgeReady,
      action: "Activate exactly one approved PUBLIC_SITE knowledge pack.",
    },
    {
      label: "Renderer ready",
      ready:
        Boolean(technicalTemplateReference) &&
        (designSource !== "KS_NATIVE" ||
          context?.designLibrary?.nativeTemplateReady === true),
      action: "Select an approved design renderer.",
    },
    {
      label: "Accessible palette",
      ready: colourIssues.length === 0,
      action: "Adjust custom colours until contrast checks pass.",
    },
  ];
  const blockers = prerequisites.filter((item) => !item.ready);

  const command = async (
    key: string,
    operation: () => Promise<any>,
    success: string,
  ) => {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      const result = await operation();
      setNotice(success);
      await load(false);
      return result;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The action could not be completed.",
      );
      return null;
    } finally {
      setBusy("");
    }
  };

  const markStageComplete = (stage: OnboardingStage) =>
    tenantId &&
    command(
      `stage:${stage.stageKey}`,
      () =>
        agencyFetch(`/tenants/${tenantId}/onboarding/${stage.stageKey}`, {
          method: "PATCH",
          body: JSON.stringify({
            status: "COMPLETE",
            dueAt: stage.dueAt || null,
            notes: stage.notes || null,
            blockerCode: null,
            blockerNote: null,
          }),
        }),
      `${commercialDefinitions[stage.stageKey]?.title || label(stage.stageKey)} completed.`,
    );
  const addService = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!tenantId) return;
    const price = Number(serviceDraft.price);
    const result = await command(
      "service",
      () =>
        agencyFetch(`/tenants/${tenantId}/onboarding-booking/services`, {
          method: "POST",
          body: JSON.stringify({
            name: serviceDraft.name.trim(),
            description: serviceDraft.description.trim(),
            durationMinutes: Number(serviceDraft.durationMinutes),
            priceMinor: Math.round(price * 100),
          }),
        }),
      "The service was added to the booking system. It will be available to the website build, but no page is published automatically.",
    );
    if (result) {
      setServiceDraft(EMPTY_SERVICE);
      setShowServiceForm(false);
    }
  };
  const build = async () => {
    if (!tenantId || !context || !draftBody || !canProvision || busy) return;
    if (blockers.length) {
      setError(blockers.map((item) => item.action).join(" "));
      return;
    }
    await command(
      "build",
      async () => {
        const current = context.draft;
        const editable =
          current?.reference && EDITABLE_DRAFTS.has(current.status);
        const draft = await agencyFetch(
          editable
            ? `/provisioning-drafts/${current.reference}`
            : "/provisioning-drafts",
          {
            method: editable ? "PATCH" : "POST",
            body: JSON.stringify(draftBody),
          },
        );
        const validation = await agencyFetch(
          `/provisioning-drafts/${draft.reference}/validate`,
          { method: "POST" },
        );
        if (validation.status !== "READY_TO_PROVISION")
          throw new Error(
            (validation.blockingIssues || [])
              .map((issue: any) => issue.message)
              .filter(Boolean)
              .join(" ") || "The launch plan has blocking issues.",
          );
        const storageKey = `ks-os-delivery-idempotency:${draft.reference}`;
        const idempotencyKey =
          sessionStorage.getItem(storageKey) ||
          `agency-delivery:${draft.reference}:${crypto.randomUUID()}`;
        sessionStorage.setItem(storageKey, idempotencyKey);
        return agencyFetch("/provisioning-runs", {
          method: "POST",
          body: JSON.stringify({
            provisioningDraftReference: draft.reference,
            idempotencyKey,
          }),
        });
      },
      "Build started. KS OS is configuring booking, selecting the strongest ten marketing pages, generating with the active playbooks, applying the chosen design and preparing the staging subdomain.",
    );
  };
  const addDomain = () =>
    siteReference &&
    customHostname.trim() &&
    command(
      "domain",
      () =>
        agencyFetch(`/sites/${siteReference}/domains/custom`, {
          method: "POST",
          body: JSON.stringify({ hostname: customHostname.trim() }),
        }),
      "DNS configuration was prepared. Review the displayed records, then verify the hostname.",
    ).then((result) => result && setDomainDetails(result));
  const verifyDomain = () =>
    siteReference &&
    customDomain?.reference &&
    command(
      "verify-domain",
      () =>
        agencyFetch(
          `/sites/${siteReference}/domains/${customDomain.reference}/verify-and-promote`,
          { method: "POST", body: "{}" },
        ),
      "Domain verification completed. A verified domain is promoted as the production canonical address.",
    ).then((result) => result && setDomainDetails(result));
  const runQuality = () =>
    siteReference &&
    studio?.version?.reference &&
    command(
      "quality",
      () =>
        agencyFetch(`/sites/${siteReference}/quality-runs`, {
          method: "POST",
          body: JSON.stringify({
            siteVersionReference: studio.version.reference,
            auditType: "FULL_SITE_QUALITY",
            reason: "PRE_PUBLICATION",
          }),
        }),
      "A full accessibility, SEO, conversion, booking and performance audit was queued.",
    );
  const publish = () =>
    siteReference &&
    studio?.version?.reference &&
    latestQuality?.reference &&
    customLive &&
    command(
      "publish",
      () =>
        agencyFetch(`/sites/${siteReference}/publications`, {
          method: "POST",
          body: JSON.stringify({
            siteVersionReference: studio.version.reference,
            qualityRunReference: latestQuality.reference,
            reason: "INITIAL_PUBLICATION",
            acknowledgeWarnings: false,
          }),
        }),
      "Publication started. The custom domain will become indexable only after the exact approved snapshot passes publication health checks.",
    );
  const activateWorkspace = async () => {
    if (!tenantId) return;
    const checks = await command(
      "checks",
      () =>
        agencyFetch(`/tenants/${tenantId}/launch-checks`, { method: "POST" }),
      "Workspace launch checks completed.",
    );
    setLaunchChecks(checks?.checks || []);
    if (checks?.ready)
      await command(
        "activate",
        () => agencyFetch(`/tenants/${tenantId}/launch`, { method: "POST" }),
        "The client workspace and booking operations are active.",
      );
  };

  if (loading)
    return (
      <div className="grid min-h-80 place-items-center rounded-3xl border border-slate-800 bg-slate-900">
        <p className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading launch pipeline…
        </p>
      </div>
    );
  if (!tenantId || !tenant || !context || !onboarding)
    return (
      <p
        role="alert"
        className="rounded-2xl border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200"
      >
        {error || "The client launch pipeline is unavailable."}
      </p>
    );

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-violet-800/60 bg-gradient-to-br from-violet-950 via-slate-950 to-slate-900 p-6 shadow-2xl sm:p-8">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                className="mb-4 inline-flex min-h-10 items-center gap-2 text-xs font-black text-slate-400 hover:text-white"
              >
                <ArrowLeft className="h-4 w-4" />
                All clients
              </button>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Status value={tenant.lifecycleStatus} />
              <Status
                value={
                  run?.status || context.draft?.status || onboarding.status
                }
              />
            </div>
            <p className="mt-4 text-xs font-black uppercase tracking-[0.22em] text-violet-300">
              One governed path from client creation to bookings
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">
              Launch {tenant.name}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              Complete facts and booking setup, choose the design, build the
              ten-page marketing architecture, review the noindex staging
              subdomain, then verify the custom domain for indexable go-live.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void build()}
            disabled={
              !canProvision ||
              Boolean(busy) ||
              activeRun ||
              Boolean(run?.status === "READY") ||
              blockers.length > 0
            }
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-black text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Sparkles className="h-4 w-4" />
            {busy === "build"
              ? "Preparing build…"
              : activeRun
                ? "Build in progress"
                : run?.status === "READY"
                  ? "Build ready for review"
                  : "Build booking and website"}
          </button>
        </div>
      </section>
      {error ? (
        <p
          role="alert"
          className="rounded-2xl border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="rounded-2xl border border-emerald-800 bg-emerald-950/35 p-4 text-sm text-emerald-200"
        >
          {notice}
        </p>
      ) : null}

      <ol className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stage
          index={1}
          title="Commercial"
          detail="Agreement and billing"
          ready={commercialReady}
          icon={FileCheck2}
        />
        <Stage
          index={2}
          title="Facts"
          detail="Locked production brief"
          ready={Boolean(briefReady)}
          icon={ShieldCheck}
        />
        <Stage
          index={3}
          title="Booking"
          detail="Services, staff and hours"
          ready={bookingReady}
          icon={CheckCircle2}
        />
        <Stage
          index={4}
          title="Design"
          detail="Theme, colours and pages"
          ready={colourIssues.length === 0}
          icon={Palette}
        />
        <Stage
          index={5}
          title="Build"
          detail="Ten pages and native booking"
          ready={run?.status === "READY"}
          icon={Wrench}
        />
        <Stage
          index={6}
          title="Staging"
          detail="Noindex client preview"
          ready={Boolean(stagingHostname && run?.status === "READY")}
          icon={Globe2}
        />
        <Stage
          index={7}
          title="Go live"
          detail="Custom domain and indexing"
          ready={Boolean(customLive && published)}
          icon={Rocket}
        />
      </ol>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
        <div className="space-y-6">
          <Panel
            title="1. Commercial gates"
            description="These are the confirmations KS OS cannot infer safely."
          >
            <div className="grid gap-3 md:grid-cols-2">
              {commercialStages.map((stage) => {
                const definition = commercialDefinitions[stage.stageKey];
                const complete = COMPLETE_STAGE_STATUSES.has(stage.status);
                return (
                  <article
                    key={stage.id}
                    className="rounded-2xl border border-slate-800 bg-slate-950 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-black uppercase text-slate-500">
                          {definition?.owner}
                        </p>
                        <h3 className="mt-1 text-sm font-black text-white">
                          {definition?.title}
                        </h3>
                      </div>
                      <Status value={stage.status} />
                    </div>
                    <p className="mt-3 text-xs leading-5 text-slate-400">
                      {stage.blockerNote || definition?.description}
                    </p>
                    {!complete && canManageStages ? (
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => void markStageComplete(stage)}
                        className="mt-4 min-h-11 rounded-xl border border-emerald-700 px-3 text-xs font-black text-emerald-200"
                      >
                        Confirm complete
                      </button>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </Panel>

          <Panel
            title="2. Facts and website guidance"
            description="The website uses the locked production brief and the active approved knowledge pack. Existing booking records do not need to be duplicated in fact finding."
            action={
              <Link
                to={`/agency/fact-finding?tenant=${tenantId}&return=${encodeURIComponent(`/agency/provisioning?tenant=${tenantId}`)}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-violet-700 px-3 text-xs font-black text-violet-200"
              >
                Open fact finding <ArrowRight className="h-4 w-4" />
              </Link>
            }
          >
            <div
              className={`rounded-2xl border p-4 ${knowledgeReady ? tone.READY : tone.BLOCKING}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black">
                    {knowledgeReady
                      ? `${context.knowledge.name} ${context.knowledge.semanticVersion}`
                      : "Knowledge pack unavailable"}
                  </p>
                  <p className="mt-2 text-xs leading-5 opacity-75">
                    {knowledgeReady
                      ? `${context.knowledge.ruleCount} approved rules, ${context.knowledge.pagePlaybookCount} page playbooks and ${context.knowledge.sectionPlaybookCount} section playbooks are pinned to the build.`
                      : "Activate exactly one approved PUBLIC_SITE knowledge pack."}
                  </p>
                </div>
                <Status value={knowledgeReady ? "READY" : "BLOCKING"} />
              </div>
            </div>
          </Panel>

          <Panel
            title="3. Booking setup"
            description="Services already created by the client are reused. Adding a service here updates booking immediately but never creates or publishes a website page automatically."
            action={
              <button
                type="button"
                onClick={() => setShowServiceForm((value) => !value)}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-600 px-4 text-xs font-black text-white"
              >
                <Plus className="h-4 w-4" />
                Add service
              </button>
            }
          >
            <div className="grid gap-3 sm:grid-cols-5">
              <Metric
                title="Services"
                value={booking?.readiness?.activeServiceCount || 0}
                detail="Active booking services"
              />
              <Metric
                title="Locations"
                value={booking?.readiness?.activeLocationCount || 0}
                detail="Active client locations"
              />
              <Metric
                title="Bookable staff"
                value={booking?.readiness?.bookableStaffCount || 0}
                detail="Active booking users"
              />
              <Metric
                title="Availability"
                value={booking?.readiness?.availabilityRuleCount || 0}
                detail="Schedule rules"
              />
              <Metric
                title="Assignments"
                value={
                  booking?.readiness?.activeStaffServiceAssignmentCount || 0
                }
                detail="Staff-service links"
              />
            </div>
            {showServiceForm ? (
              <form
                onSubmit={addService}
                className="mt-5 rounded-2xl border border-violet-800 bg-violet-950/20 p-4"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-xs font-bold text-slate-300">
                    Service name
                    <input
                      required
                      value={serviceDraft.name}
                      onChange={(event) =>
                        setServiceDraft((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white"
                    />
                  </label>
                  <label className="text-xs font-bold text-slate-300">
                    Duration in minutes
                    <input
                      required
                      type="number"
                      min="5"
                      max="1440"
                      value={serviceDraft.durationMinutes}
                      onChange={(event) =>
                        setServiceDraft((current) => ({
                          ...current,
                          durationMinutes: event.target.value,
                        }))
                      }
                      className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white"
                    />
                  </label>
                  <label className="text-xs font-bold text-slate-300">
                    Price ({booking?.tenant?.currency || "GBP"})
                    <input
                      required
                      type="number"
                      min="0"
                      step="0.01"
                      value={serviceDraft.price}
                      onChange={(event) =>
                        setServiceDraft((current) => ({
                          ...current,
                          price: event.target.value,
                        }))
                      }
                      className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white"
                    />
                  </label>
                  <label className="text-xs font-bold text-slate-300 sm:col-span-2">
                    Description
                    <textarea
                      required
                      minLength={10}
                      rows={3}
                      value={serviceDraft.description}
                      onChange={(event) =>
                        setServiceDraft((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white"
                    />
                  </label>
                </div>
                <button
                  disabled={busy === "service"}
                  className="mt-4 min-h-11 rounded-xl bg-emerald-500 px-4 text-xs font-black text-slate-950"
                >
                  {busy === "service" ? "Adding…" : "Add to booking system"}
                </button>
              </form>
            ) : null}
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {(booking?.services || []).map((service: any) => (
                <article
                  key={service.reference}
                  className="rounded-2xl border border-slate-800 bg-slate-950 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-black text-white">
                        {service.name}
                      </h3>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        {service.description}
                      </p>
                    </div>
                    <Status
                      value={service.ready ? "READY" : "ACTION_REQUIRED"}
                    />
                  </div>
                  <p className="mt-3 text-xs font-bold text-slate-300">
                    {service.durationMinutes} min ·{" "}
                    {new Intl.NumberFormat("en-GB", {
                      style: "currency",
                      currency: booking.tenant.currency,
                    }).format(service.effectivePriceMinor / 100)}
                  </p>
                </article>
              ))}
            </div>
          </Panel>

          <Panel
            title="4. Website design and ten-page scope"
            description="KS OS selects the strongest ten marketing pages justified by services, locations and approved facts. Booking and required policy pages are included without consuming that target."
          >
            <fieldset disabled={planLocked}>
              <div className="grid gap-3 md:grid-cols-3">
                {(
                  [
                    "KS_NATIVE",
                    "GOOGLE_STITCH",
                    "LICENSED_TEMPLATE",
                  ] as DesignSource[]
                ).map((source) => (
                  <button
                    key={source}
                    type="button"
                    aria-pressed={designSource === source}
                    onClick={() => setDesignSource(source)}
                    className={`min-h-24 rounded-2xl border p-4 text-left ${designSource === source ? "border-violet-500 bg-violet-950/35" : "border-slate-800 bg-slate-950"}`}
                  >
                    <strong className="text-sm text-white">
                      {source === "KS_NATIVE"
                        ? "KS Native"
                        : source === "GOOGLE_STITCH"
                          ? "Approved Stitch import"
                          : "Licensed template"}
                    </strong>
                    <span className="mt-2 block text-[11px] text-slate-500">
                      {source === "KS_NATIVE"
                        ? "Recommended governed component system."
                        : "Use a previously approved renderer version."}
                    </span>
                  </button>
                ))}
              </div>
              {designSource === "KS_NATIVE" ? (
                <div className="mt-5 space-y-5">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setNativeThemeMode("PRESET")}
                      className="min-h-11 rounded-xl border border-slate-700 px-4 text-xs font-black"
                    >
                      KS presets
                    </button>
                    <button
                      type="button"
                      onClick={() => setNativeThemeMode("LIBRARY")}
                      className="min-h-11 rounded-xl border border-slate-700 px-4 text-xs font-black"
                    >
                      Studio themes ({libraryThemes.length})
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {(nativeThemeMode === "PRESET"
                      ? presets
                      : libraryThemes
                    ).map((item: any) => {
                      const selected =
                        nativeThemeMode === "PRESET"
                          ? presetKey === item.key
                          : libraryThemeReference === item.reference;
                      return (
                        <button
                          key={item.key || item.reference}
                          type="button"
                          onClick={() => {
                            if (nativeThemeMode === "PRESET")
                              setPresetKey(item.key);
                            else setLibraryThemeReference(item.reference);
                            if (!customColours)
                              setColourOverrides(coloursFromTheme(item.theme));
                          }}
                          className={`rounded-2xl border p-3 text-left ${selected ? "border-violet-500 bg-violet-950/25" : "border-slate-800 bg-slate-950"}`}
                        >
                          <ThemePreview name={item.name} theme={item.theme} />
                          <strong className="mt-3 block text-sm text-white">
                            {item.name}
                          </strong>
                          <span className="mt-1 block text-[10px] text-slate-500">
                            {item.description}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <label className="flex min-h-11 items-center gap-3 text-xs font-black text-white">
                    <input
                      type="checkbox"
                      checked={customColours}
                      onChange={(event) => {
                        setCustomColours(event.target.checked);
                        if (event.target.checked)
                          setColourOverrides(
                            coloursFromTheme(selectedBaseTheme),
                          );
                      }}
                    />
                    Customise this client palette
                  </label>
                  {customColours ? (
                    <>
                      <ColourEditor
                        values={colourOverrides}
                        onChange={(key, value) =>
                          setColourOverrides((current) => ({
                            ...current,
                            [key]: value,
                          }))
                        }
                      />
                      {colourIssues.length ? (
                        <ul className="rounded-xl border border-rose-800 p-3 text-xs text-rose-200">
                          {colourIssues.map((issue) => (
                            <li key={String(issue)}>{String(issue)}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs font-bold text-emerald-300">
                          Palette passes core contrast checks.
                        </p>
                      )}
                    </>
                  ) : null}
                </div>
              ) : (
                <label className="mt-5 block text-xs font-bold text-slate-300">
                  Approved renderer
                  <select
                    value={templateReference}
                    onChange={(event) =>
                      setTemplateReference(event.target.value)
                    }
                    className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white"
                  >
                    <option value="">Choose approved renderer…</option>
                    {advancedTemplates.map((template: any) => (
                      <option
                        key={template.reference}
                        value={template.reference}
                      >
                        {template.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="text-xs font-bold text-slate-300">
                  Default section treatment
                  <select
                    value={defaultSectionVariant}
                    onChange={(event) =>
                      setDefaultSectionVariant(
                        event.target.value as SectionVariant,
                      )
                    }
                    className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white"
                  >
                    {(
                      context.designLibrary?.sectionVariants || ["standard"]
                    ).map((variant: string) => (
                      <option key={variant} value={variant}>
                        {label(variant)}
                      </option>
                    ))}
                  </select>
                </label>
                <div>
                  <p className="text-xs font-bold text-slate-300">
                    Eligible page types
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {PAGE_TYPES.map((pageType) => (
                      <label
                        key={pageType}
                        className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 text-[11px] text-slate-300"
                      >
                        <input
                          type="checkbox"
                          checked={pageTypes.includes(pageType)}
                          onChange={(event) =>
                            setPageTypes((current) =>
                              event.target.checked
                                ? [...new Set([...current, pageType])]
                                : current.filter((value) => value !== pageType),
                            )
                          }
                        />
                        {label(pageType)}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </fieldset>
          </Panel>

          <Panel
            title="5. Payments and build"
            description="Native booking is mandatory. The same booking journey powers staging and production."
          >
            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  ["allowPayLater", "Allow launch before online payments"],
                  ["onlinePaymentsRequested", "Configure online payments"],
                  ["depositCollectionRequested", "Collect booking deposits"],
                ] as Array<[keyof PaymentPreference, string]>
              ).map(([key, text]) => (
                <label
                  key={key}
                  className="flex min-h-14 items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950 p-4 text-xs font-bold text-slate-300"
                >
                  <input
                    type="checkbox"
                    checked={paymentPreference[key]}
                    disabled={planLocked}
                    onChange={(event) =>
                      setPaymentPreference((current) => ({
                        ...current,
                        [key]: event.target.checked,
                      }))
                    }
                  />
                  {text}
                </label>
              ))}
            </div>
          </Panel>

          <Panel
            title="6. Staging preview and quality"
            description="The managed subdomain is a shareable client preview. It always sends noindex/nofollow, blocks its sitemap and never becomes the SEO canonical."
          >
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <p className="text-[10px] font-black uppercase text-slate-500">
                Managed staging address
              </p>
              <p className="mt-2 break-all font-mono text-sm text-indigo-300">
                https://{stagingHostname}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {run?.status === "READY" && stagingHostname ? (
                  <a
                    href={`https://${stagingHostname}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-violet-700 px-3 text-xs font-black text-violet-200"
                  >
                    Open staging <ExternalLink className="h-4 w-4" />
                  </a>
                ) : null}
                {siteReference ? (
                  <Link
                    to={`/agency/sites/${siteReference}/studio`}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-3 text-xs font-black text-slate-200"
                  >
                    Open Site Studio <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : null}
                {studio?.version?.reference ? (
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void runQuality()}
                    className="min-h-11 rounded-xl border border-emerald-700 px-3 text-xs font-black text-emerald-200"
                  >
                    {busy === "quality"
                      ? "Queueing…"
                      : "Run full quality audit"}
                  </button>
                ) : null}
              </div>
            </div>
          </Panel>

          <Panel
            title="7. Production domain and go-live"
            description="Add the client's own hostname. KS OS prepares the exact routing and ownership records, verifies SSL and promotes it as canonical. Only then can the published site become index/follow."
          >
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <input
                value={customHostname}
                onChange={(event) =>
                  setCustomHostname(
                    event.target.value
                      .toLowerCase()
                      .replace(/^https?:\/\//, "")
                      .replace(/\/$/, ""),
                  )
                }
                placeholder="www.clientdomain.co.uk"
                className="min-h-11 rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white"
              />
              <button
                type="button"
                disabled={!siteReference || !customHostname || Boolean(busy)}
                onClick={() => void addDomain()}
                className="min-h-11 rounded-xl bg-violet-600 px-4 text-xs font-black text-white"
              >
                {busy === "domain" ? "Adding…" : "Add custom domain"}
              </button>
            </div>
            {customDomain ? (
              <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-sm text-white">
                      {customDomain.hostname}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {customDomain.domainRole} · ownership{" "}
                      {customDomain.ownershipStatus} · SSL{" "}
                      {customDomain.sslStatus}
                    </p>
                  </div>
                  <Status value={customDomain.status} />
                </div>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void verifyDomain()}
                  className="mt-4 min-h-11 rounded-xl border border-emerald-700 px-3 text-xs font-black text-emerald-200"
                >
                  {busy === "verify-domain"
                    ? "Checking domain…"
                    : "Verify DNS and promote"}
                </button>
              </div>
            ) : null}
            {domainDetails?.dnsRecords?.length ? (
              <div className="mt-4 overflow-x-auto rounded-2xl border border-amber-800 bg-amber-950/20 p-4">
                <p className="text-xs font-black text-amber-200">
                  Add these records at the client's DNS provider
                </p>
                <table className="mt-3 w-full text-left text-xs">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="p-2">Type</th>
                      <th>Name</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {domainDetails.dnsRecords.map(
                      (record: any, index: number) => (
                        <tr
                          key={`${record.type}-${record.name}-${index}`}
                          className="border-t border-slate-800"
                        >
                          <td className="p-2 font-black text-white">
                            {record.type}
                          </td>
                          <td className="font-mono text-slate-300">
                            {record.name}
                          </td>
                          <td className="break-all font-mono text-indigo-300">
                            {record.value}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={
                  !canPublish ||
                  !customLive ||
                  !reviewReady ||
                  !qualityReady ||
                  Boolean(busy)
                }
                onClick={() => void publish()}
                className="min-h-11 rounded-xl bg-emerald-500 px-4 text-xs font-black text-slate-950 disabled:opacity-40"
              >
                {busy === "publish" ? "Publishing…" : "Publish approved site"}
              </button>
              <button
                type="button"
                disabled={workspaceActive || Boolean(busy)}
                onClick={() => void activateWorkspace()}
                className="min-h-11 rounded-xl border border-violet-700 px-4 text-xs font-black text-violet-200 disabled:opacity-40"
              >
                {workspaceActive
                  ? "Workspace active"
                  : "Activate client booking operations"}
              </button>
            </div>
            {launchChecks.map((check: any) => (
              <p
                key={check.code}
                className={`mt-2 rounded-xl border p-3 text-xs ${check.passed ? tone.READY : tone.BLOCKING}`}
              >
                {check.area}: {check.message}
              </p>
            ))}
          </Panel>
        </div>

        <aside className="space-y-6 xl:sticky xl:top-6 xl:self-start">
          <Panel
            title="Launch readiness"
            description="Only unresolved decisions are shown."
          >
            <div className="space-y-2">
              {prerequisites.map((item) => (
                <div
                  key={item.label}
                  className={`rounded-xl border p-3 ${item.ready ? tone.READY : tone.BLOCKING}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <strong className="text-xs">{item.label}</strong>
                    <Status value={item.ready ? "READY" : "BLOCKING"} />
                  </div>
                  {!item.ready ? (
                    <p className="mt-2 text-[11px] opacity-75">{item.action}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </Panel>
          <Panel
            title="Build contract"
            description="What the main build action guarantees."
          >
            <ul className="space-y-3 text-xs leading-5 text-slate-300">
              <li>
                • Reuses existing booking records or creates only missing
                records.
              </li>
              <li>
                • Selects up to ten marketing pages from verified client demand
                and data.
              </li>
              <li>
                • Adds native booking and required policy routes outside that
                marketing target.
              </li>
              <li>
                • Pins the approved knowledge-pack version and design source.
              </li>
              <li>
                • Creates a noindex managed staging hostname for client review.
              </li>
              <li>
                • Requires human review, quality evidence and verified custom
                DNS before indexed publication.
              </li>
            </ul>
          </Panel>
          <Panel title="Current state">
            <div className="grid gap-3">
              <Metric
                title="Build"
                value={label(run?.status || context.draft?.status)}
                detail={
                  run?.currentStep ? label(run.currentStep) : "Not started"
                }
              />
              <Metric
                title="Staging"
                value={stagingHostname ? "Reserved" : "Pending"}
                detail="Always noindex/nofollow"
              />
              <Metric
                title="Production"
                value={customLive ? "Verified" : "Pending"}
                detail={customDomain?.hostname || "Add client domain"}
              />
              <Metric
                title="Quality"
                value={qualityReady ? "Ready" : "Required"}
                detail={
                  latestQuality?.publicationGateStatus || "Run full audit"
                }
              />
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
