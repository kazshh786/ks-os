import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleAlert,
  CreditCard,
  ExternalLink,
  FileCheck2,
  Globe2,
  LayoutTemplate,
  Loader2,
  Package,
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
import {
  launchPollingRequired,
  launchPublicationPolicy,
} from "./launch-publication-policy";

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
const surface =
  "rounded-3xl border border-slate-800/90 bg-slate-900/80 shadow-[0_24px_80px_rgba(2,6,23,0.24)]";

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
type JourneyStage = {
  id: number;
  title: string;
  detail: string;
  ready: boolean;
  status: string;
  icon: React.ElementType;
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
    title: "Sale handover",
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

const humanise = (value?: string) =>
  (value || "NOT_STARTED")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/(^|\s)\S/g, (match) => match.toUpperCase());
const statusTone = (value?: string) => {
  const status = (value || "NOT_STARTED").toUpperCase();
  if (
    ["READY", "COMPLETE", "ACTIVE", "LIVE", "PASS", "COMPLETED"].includes(
      status,
    )
  )
    return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
  if (
    [
      "ACTION_REQUIRED",
      "DNS_REVIEW_REQUIRED",
      "WARNING",
      "IN_PROGRESS",
      "QUEUED",
      "READY_TO_PROVISION",
    ].includes(status)
  )
    return "border-amber-400/30 bg-amber-400/10 text-amber-100";
  if (["BLOCKED", "BLOCKING", "FAILED", "PARTIALLY_FAILED"].includes(status))
    return "border-rose-400/30 bg-rose-400/10 text-rose-200";
  return "border-slate-700 bg-slate-800/70 text-slate-300";
};

function StatusBadge({ value }: { value?: string }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${statusTone(value)}`}
    >
      {humanise(value)}
    </span>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  detail: string;
  icon: React.ElementType;
}) {
  return (
    <section className={`${surface} p-5`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
            {label}
          </p>
          <p className="mt-3 text-2xl font-black tracking-tight text-white">
            {value}
          </p>
          <p className="mt-2 text-xs text-slate-500">{detail}</p>
        </div>
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-500/15 text-violet-200">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </section>
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

function StageShell({
  eyebrow,
  title,
  description,
  action,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={`${surface} overflow-hidden`}>
      <div className="flex flex-col gap-4 border-b border-slate-800 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-300">
            {eyebrow}
          </p>
          <h2 className="mt-2 text-xl font-black text-white">{title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            {description}
          </p>
        </div>
        {action}
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </section>
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

export function AgencyFocusedLaunchJourney({
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
  const [qualityFindings, setQualityFindings] = useState<any[]>([]);
  const [livePublication, setLivePublication] = useState<any>(null);
  const [publications, setPublications] = useState<any[]>([]);
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false);
  const [selectedStageId, setSelectedStageId] = useState<number | null>(null);
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
        setTemplateReference(nextContext.draft?.templateVersionReference || "");
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
          const [
            nextDomains,
            nextStudio,
            nextQuality,
            nextLive,
            nextPublications,
          ] = await Promise.all([
            agencyFetch(`/sites/${siteReference}/domains`).catch(() => []),
            agencyFetch(`/sites/${siteReference}/studio`).catch(() => null),
            agencyFetch(`/sites/${siteReference}/quality-runs`).catch(() => []),
            agencyFetch(`/sites/${siteReference}/publication-live`).catch(
              () => null,
            ),
            agencyFetch(`/sites/${siteReference}/publications`).catch(() => []),
          ]);
          const findings = nextQuality[0]?.reference
            ? await agencyFetch(
                `/sites/${siteReference}/quality-runs/${nextQuality[0].reference}/findings`,
              ).catch(() => [])
            : [];
          setDomains(nextDomains);
          setStudio(nextStudio);
          setQualityRuns(nextQuality);
          setQualityFindings(findings);
          setLivePublication(nextLive);
          setPublications(nextPublications);
        } else {
          setDomains([]);
          setStudio(null);
          setQualityRuns([]);
          setQualityFindings([]);
          setLivePublication(null);
          setPublications([]);
        }
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "The client launch journey could not be loaded.",
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
  useEffect(() => {
    if (!launchPollingRequired({
      qualityStatus: qualityRuns[0]?.status,
      publicationStatus: publications[0]?.status,
      domainStatuses: domains.map((domain) => domain.status),
    })) return;
    const timer = window.setInterval(() => void load(false), 3_000);
    return () => window.clearInterval(timer);
  }, [domains, load, publications, qualityRuns]);

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
  const rendererReady =
    Boolean(technicalTemplateReference) &&
    (designSource !== "KS_NATIVE" ||
      context?.designLibrary?.nativeTemplateReady === true);
  const designReady = rendererReady && colourIssues.length === 0;
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
  const factsReady = Boolean(knowledgeReady && briefReady);
  const bookingReady = booking?.readiness?.readyForBuild === true;
  const siteReference = context?.site?.reference || run?.siteReference;
  const domainType = (domain: any) => domain.domainType || domain.type;
  const domainRole = (domain: any) => domain.domainRole || domain.role;
  const fallbackDomain = domains.find(
    (domain) => domainType(domain) === "FALLBACK",
  );
  const customDomain =
    domains.find(
      (domain) =>
        domainType(domain) === "CUSTOM" && domainRole(domain) === "CANONICAL",
    ) || domains.find((domain) => domainType(domain) === "CUSTOM");
  const stagingHostname = fallbackDomain?.hostname || "";
  const latestQuality = qualityRuns[0];
  const reviewReady =
    context?.readiness?.review === "READY" ||
    studio?.version?.status === "APPROVED";
  const publicationPolicy = launchPublicationPolicy({
    domains,
    quality: latestQuality,
    versionReference: studio?.version?.reference,
    reviewApproved: reviewReady,
    warningsAcknowledged,
  });
  const { managedHostnameActive, qualityReady, warningsRequireAcknowledgement } = publicationPolicy;
  const published = livePublication?.status === "LIVE";
  const buildReady = run?.status === "READY";
  const stagingReady = buildReady;
  const goLiveReady = Boolean(
    managedHostnameActive && published && workspaceActive,
  );

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
      ready: rendererReady,
      action: "Select an approved design renderer.",
    },
    {
      label: "Accessible palette",
      ready: colourIssues.length === 0,
      action: "Adjust custom colours until contrast checks pass.",
    },
  ];
  const blockers = prerequisites.filter((item) => !item.ready);

  const journey: JourneyStage[] = [
    {
      id: 1,
      title: "Commercial",
      detail: "Agreement and billing",
      ready: commercialReady,
      status: commercialReady ? "COMPLETE" : "IN_PROGRESS",
      icon: FileCheck2,
    },
    {
      id: 2,
      title: "Facts",
      detail: "Brief and playbooks",
      ready: factsReady,
      status: factsReady
        ? "COMPLETE"
        : commercialReady
          ? "IN_PROGRESS"
          : "NOT_STARTED",
      icon: ShieldCheck,
    },
    {
      id: 3,
      title: "Booking",
      detail: "Services, staff and hours",
      ready: bookingReady,
      status: bookingReady
        ? "COMPLETE"
        : factsReady
          ? "IN_PROGRESS"
          : "NOT_STARTED",
      icon: CheckCircle2,
    },
    {
      id: 4,
      title: "Website design",
      detail: "Theme, colours and pages",
      ready: designReady,
      status: designReady
        ? "COMPLETE"
        : bookingReady
          ? "IN_PROGRESS"
          : "NOT_STARTED",
      icon: Palette,
    },
    {
      id: 5,
      title: "Build and review",
      detail: "Ten pages and native booking",
      ready: buildReady,
      status: buildReady
        ? "COMPLETE"
        : activeRun
          ? "IN_PROGRESS"
          : designReady
            ? "IN_PROGRESS"
            : "NOT_STARTED",
      icon: Wrench,
    },
    {
      id: 6,
      title: "Staging",
      detail: "Noindex client preview",
      ready: stagingReady && reviewReady && qualityReady,
      status:
        stagingReady && reviewReady && qualityReady
          ? "COMPLETE"
          : stagingReady
            ? "IN_PROGRESS"
            : "NOT_STARTED",
      icon: Globe2,
    },
    {
      id: 7,
      title: "Go live",
      detail: "Domain, publish and activate",
      ready: goLiveReady,
      status: goLiveReady
        ? "COMPLETE"
        : domains.length
          ? "IN_PROGRESS"
          : "NOT_STARTED",
      icon: Rocket,
    },
  ];
  const recommendedStage =
    journey.find((stage) => !stage.ready) || journey[journey.length - 1];
  const activeStageId = selectedStageId || recommendedStage.id;
  const activeStage =
    journey.find((stage) => stage.id === activeStageId) || recommendedStage;
  const completedCount = journey.filter((stage) => stage.ready).length;
  const progress = Math.round((completedCount / journey.length) * 100);

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
      `${commercialDefinitions[stage.stageKey]?.title || humanise(stage.stageKey)} completed.`,
    );
  const addService = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!tenantId) return;
    const result = await command(
      "service",
      () =>
        agencyFetch(`/tenants/${tenantId}/onboarding-booking/services`, {
          method: "POST",
          body: JSON.stringify({
            name: serviceDraft.name.trim(),
            description: serviceDraft.description.trim(),
            durationMinutes: Number(serviceDraft.durationMinutes),
            priceMinor: Math.round(Number(serviceDraft.price) * 100),
          }),
        }),
      "The service was added to booking. No website page was created or published automatically.",
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
      "Build started. KS OS is configuring booking, generating ten marketing pages with the active playbooks and preparing staging.",
    );
  };
  const reserveFallback = () =>
    siteReference &&
    command(
      "fallback-domain",
      () =>
        agencyFetch(`/sites/${siteReference}/domains/fallback`, {
          method: "POST",
          body: "{}",
        }),
      "The managed launch hostname is being activated.",
    ).then((result) => result && setDomainDetails(result));
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
    managedHostnameActive &&
    command(
      "publish",
      () =>
        agencyFetch(`/sites/${siteReference}/publications`, {
          method: "POST",
          body: JSON.stringify({
            siteVersionReference: studio.version.reference,
            qualityRunReference: latestQuality.reference,
            reason: "INITIAL_PUBLICATION",
            acknowledgeWarnings:
              warningsRequireAcknowledgement && warningsAcknowledged,
          }),
        }),
      "Publication started for the exact approved, quality-checked version.",
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

  const renderStage = () => {
    if (activeStageId === 1)
      return (
        <StageShell
          eyebrow="Step 1 of 7"
          title="Commercial readiness"
          description="Confirm the few commercial decisions KS OS cannot safely infer."
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
                    <StatusBadge value={stage.status} />
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
        </StageShell>
      );

    if (activeStageId === 2)
      return (
        <StageShell
          eyebrow="Step 2 of 7"
          title="Facts and website guidance"
          description="Lock verified client facts once, then use the active knowledge pack to guide every generated page."
          action={
            <Link
              to={`/agency/fact-finding?tenant=${tenantId}&return=${encodeURIComponent(`/agency/provisioning?tenant=${tenantId}`)}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-600 px-4 text-xs font-black text-white"
            >
              Open fact finding <ArrowRight className="h-4 w-4" />
            </Link>
          }
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div
              className={`rounded-2xl border p-5 ${briefReady ? statusTone("READY") : statusTone("BLOCKING")}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black">Production brief</p>
                  <p className="mt-2 text-xs leading-5 opacity-75">
                    {briefReady
                      ? "Locked and ready for provisioning."
                      : "Complete review and lock the approved client facts."}
                  </p>
                </div>
                <StatusBadge value={briefReady ? "READY" : "BLOCKING"} />
              </div>
            </div>
            <div
              className={`rounded-2xl border p-5 ${knowledgeReady ? statusTone("READY") : statusTone("BLOCKING")}`}
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
                      ? `${context.knowledge.ruleCount} approved rules and ${context.knowledge.pagePlaybookCount} page playbooks are pinned to the build.`
                      : "Activate exactly one approved PUBLIC_SITE knowledge pack."}
                  </p>
                </div>
                <StatusBadge value={knowledgeReady ? "READY" : "BLOCKING"} />
              </div>
            </div>
          </div>
        </StageShell>
      );

    if (activeStageId === 3)
      return (
        <StageShell
          eyebrow="Step 3 of 7"
          title="Booking setup"
          description="Reuse services already created by the client. Add only what is missing; creating a service never publishes a website page."
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
              detail="Active services"
            />
            <Metric
              title="Locations"
              value={booking?.readiness?.activeLocationCount || 0}
              detail="Client locations"
            />
            <Metric
              title="Staff"
              value={booking?.readiness?.bookableStaffCount || 0}
              detail="Bookable users"
            />
            <Metric
              title="Availability"
              value={booking?.readiness?.availabilityRuleCount || 0}
              detail="Schedule rules"
            />
            <Metric
              title="Assignments"
              value={booking?.readiness?.activeStaffServiceAssignmentCount || 0}
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
                  <StatusBadge
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
        </StageShell>
      );

    if (activeStageId === 4)
      return (
        <StageShell
          eyebrow="Step 4 of 7"
          title="Website design"
          description="Choose one design direction, then reveal advanced page and palette controls only when needed."
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
                    className={`min-h-11 rounded-xl border px-4 text-xs font-black ${nativeThemeMode === "PRESET" ? "border-violet-500 text-violet-200" : "border-slate-700 text-slate-400"}`}
                  >
                    KS presets
                  </button>
                  <button
                    type="button"
                    onClick={() => setNativeThemeMode("LIBRARY")}
                    className={`min-h-11 rounded-xl border px-4 text-xs font-black ${nativeThemeMode === "LIBRARY" ? "border-violet-500 text-violet-200" : "border-slate-700 text-slate-400"}`}
                  >
                    Studio themes ({libraryThemes.length})
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {(nativeThemeMode === "PRESET" ? presets : libraryThemes).map(
                    (item: any) => {
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
                    },
                  )}
                </div>
                <details className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                  <summary className="cursor-pointer text-xs font-black text-white">
                    Customise client colours
                  </summary>
                  <label className="mt-4 flex min-h-11 items-center gap-3 text-xs font-black text-white">
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
                    Use custom palette overrides
                  </label>
                  {customColours ? (
                    <div className="mt-4 space-y-4">
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
                    </div>
                  ) : null}
                </details>
              </div>
            ) : (
              <label className="mt-5 block text-xs font-bold text-slate-300">
                Approved renderer
                <select
                  value={templateReference}
                  onChange={(event) => setTemplateReference(event.target.value)}
                  className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white"
                >
                  <option value="">Choose approved renderer…</option>
                  {advancedTemplates.map((template: any) => (
                    <option key={template.reference} value={template.reference}>
                      {template.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <details className="mt-5 rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <summary className="cursor-pointer text-xs font-black text-white">
                Advanced page scope
              </summary>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-xs font-bold text-slate-300">
                  Default section treatment
                  <select
                    value={defaultSectionVariant}
                    onChange={(event) =>
                      setDefaultSectionVariant(
                        event.target.value as SectionVariant,
                      )
                    }
                    className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-white"
                  >
                    {(
                      context.designLibrary?.sectionVariants || ["standard"]
                    ).map((variant: string) => (
                      <option key={variant} value={variant}>
                        {humanise(variant)}
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
                        className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 text-[11px] text-slate-300"
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
                        {humanise(pageType)}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </details>
          </fieldset>
        </StageShell>
      );

    if (activeStageId === 5)
      return (
        <StageShell
          eyebrow="Step 5 of 7"
          title="Build and review"
          description="Confirm payment behaviour, resolve only the remaining blockers, then build booking and the ten-page website together."
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
          <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto]">
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <p className="text-xs font-black text-white">Launch readiness</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {prerequisites.map((item) => (
                  <div
                    key={item.label}
                    className={`flex items-start gap-2 rounded-xl border p-3 text-xs ${item.ready ? statusTone("READY") : statusTone("BLOCKING")}`}
                  >
                    {item.ready ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    ) : (
                      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    )}
                    <span>
                      <strong>{item.label}</strong>
                      {!item.ready ? (
                        <small className="mt-1 block opacity-75">
                          {item.action}
                        </small>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void build()}
              disabled={
                !canProvision ||
                Boolean(busy) ||
                activeRun ||
                buildReady ||
                blockers.length > 0
              }
              className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-6 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Sparkles className="h-4 w-4" />
              {busy === "build"
                ? "Preparing build…"
                : activeRun
                  ? "Build in progress"
                  : buildReady
                    ? "Build ready for review"
                    : "Build booking and website"}
            </button>
          </div>
          {buildReady && siteReference ? (
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                to={`/agency/sites/${siteReference}/studio`}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-violet-700 px-4 text-xs font-black text-violet-200"
              >
                Open Site Studio <ArrowRight className="h-4 w-4" />
              </Link>
              <button
                type="button"
                onClick={() => setSelectedStageId(6)}
                className="min-h-11 rounded-xl border border-slate-700 px-4 text-xs font-black text-slate-200"
              >
                Continue to staging
              </button>
            </div>
          ) : null}
        </StageShell>
      );

    if (activeStageId === 6)
      return (
        <StageShell
          eyebrow="Step 6 of 7"
          title="Secure preview and quality"
          description="Open staging through a signed preview in Site Studio. Preview content is never served from a public hostname or promoted without approval."
        >
          <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
            <p className="text-xs leading-5 text-slate-400">
              Site Studio keeps review links access-controlled, noindex and
              pinned to the exact immutable version.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {siteReference ? (
                <Link
                  to={`/agency/sites/${siteReference}/studio`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 text-xs font-black text-slate-200"
                >
                  Open Site Studio <ArrowRight className="h-4 w-4" />
                </Link>
              ) : null}
              {studio?.version?.reference ? (
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void runQuality()}
                  className="min-h-11 rounded-xl border border-emerald-700 px-4 text-xs font-black text-emerald-200"
                >
                  {busy === "quality" ? "Queueing…" : "Run full quality audit"}
                </button>
              ) : null}
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Metric
              title="Build"
              value={buildReady ? "Ready" : humanise(run?.status)}
              detail="Generated site snapshot"
            />
            <Metric
              title="Review"
              value={reviewReady ? "Approved" : "Required"}
              detail="Human review remains mandatory"
            />
            <Metric
              title="Quality"
              value={qualityReady ? "Pass" : "Required"}
              detail={
                latestQuality?.publicationGateStatus ||
                latestQuality?.status ||
                "Run full audit"
              }
            />
          </div>
        </StageShell>
      );

    return (
      <StageShell
        eyebrow="Step 7 of 7"
        title="Managed hostname and go-live"
        description="Activate the managed launch hostname or connect a custom domain, then publish the exact approved version and activate booking operations."
      >
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black text-white">
                Managed launch hostname
              </p>
              <p className="mt-1 font-mono text-xs text-indigo-300">
                {fallbackDomain?.hostname || "Not reserved"}
              </p>
            </div>
            <StatusBadge value={fallbackDomain?.status || "NOT_STARTED"} />
          </div>
          {!fallbackDomain ? (
            <button
              type="button"
              disabled={!siteReference || Boolean(busy)}
              onClick={() => void reserveFallback()}
              className="mt-4 min-h-11 rounded-xl border border-violet-700 px-3 text-xs font-black text-violet-200"
            >
              {busy === "fallback-domain"
                ? "Activating…"
                : "Activate managed hostname"}
            </button>
          ) : null}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
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
            {busy === "domain" ? "Preparing…" : "Prepare custom domain"}
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
                  {domainRole(customDomain)} · ownership{" "}
                  {customDomain.ownershipStatus} · SSL {customDomain.sslStatus}
                </p>
              </div>
              <StatusBadge value={customDomain.status} />
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
              Review these DNS records
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
                {domainDetails.dnsRecords.map((record: any, index: number) => (
                  <tr
                    key={`${record.type}-${record.name}-${index}`}
                    className="border-t border-slate-800"
                  >
                    <td className="p-2 font-black text-white">{record.type}</td>
                    <td className="font-mono text-slate-300">{record.name}</td>
                    <td className="break-all font-mono text-indigo-300">
                      {record.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {warningsRequireAcknowledgement ? (
          <div className="mt-4 rounded-2xl border border-amber-800 bg-amber-950/20 p-4">
            <p className="text-xs font-black text-amber-200">
              Quality passed with {latestQuality.warningCount} warning
              {latestQuality.warningCount === 1 ? "" : "s"}
            </p>
            <ul className="mt-2 space-y-1 text-xs text-amber-100">
              {qualityFindings
                .filter((finding) => finding.severity === "WARNING")
                .slice(0, 8)
                .map((finding) => (
                  <li key={finding.reference}>
                    {finding.title || finding.code || finding.message}
                  </li>
                ))}
            </ul>
            <label className="mt-3 flex items-start gap-2 text-xs text-amber-100">
              <input
                type="checkbox"
                checked={warningsAcknowledged}
                onChange={(event) =>
                  setWarningsAcknowledged(event.target.checked)
                }
              />
              I reviewed these digest-bound warnings and approve publication.
            </label>
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={
              !canPublish ||
              !publicationPolicy.canPublish ||
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
            {workspaceActive ? "Workspace active" : "Check and launch booking"}
          </button>
          {livePublication?.liveUrl ? (
            <a
              href={livePublication.liveUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-700 px-4 text-xs font-black text-emerald-200"
            >
              Open live site <ExternalLink className="h-4 w-4" />
            </a>
          ) : null}
        </div>
        {launchChecks.map((check: any) => (
          <p
            key={check.code}
            className={`mt-2 rounded-xl border p-3 text-xs ${check.passed ? statusTone("READY") : statusTone("BLOCKING")}`}
          >
            {check.area}: {check.message}
          </p>
        ))}
      </StageShell>
    );
  };

  if (loading)
    return (
      <div className="grid min-h-80 place-items-center rounded-3xl border border-slate-800 bg-slate-900">
        <p className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading launch journey…
        </p>
      </div>
    );
  if (!tenantId || !tenant || !context || !onboarding)
    return (
      <p
        role="alert"
        className="rounded-2xl border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200"
      >
        {error || "The client launch journey is unavailable."}
      </p>
    );

  return (
    <div className="space-y-6">
      <section
        className={`${surface} bg-gradient-to-br from-violet-950/80 via-slate-950 to-slate-900 p-6 sm:p-8`}
      >
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
              <StatusBadge value={tenant.lifecycleStatus} />
              <StatusBadge
                value={
                  run?.status || context.draft?.status || onboarding.status
                }
              />
            </div>
            <p className="mt-4 text-xs font-black uppercase tracking-[0.22em] text-violet-300">
              Client launch workspace
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">
              {tenant.name}
            </h1>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-400">
              <span className="font-mono text-indigo-300">
                {livePublication?.liveUrl || stagingHostname || "Managed hostname not activated"}
              </span>
              <span>
                {context.plan?.name || context.plan?.key || "Package assigned"}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {livePublication?.liveUrl && bookingReady ? (
              <a
                href={`${livePublication.liveUrl.replace(/\/$/, "")}/book`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 text-xs font-black text-slate-200"
              >
                Open booking page <ExternalLink className="h-4 w-4" />
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => setSelectedStageId(recommendedStage.id)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-500 px-5 text-xs font-black text-slate-950"
            >
              Continue setup <ArrowRight className="h-4 w-4" />
            </button>
          </div>
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Setup progress"
          value={`${progress}%`}
          detail={`Next: ${recommendedStage.title}`}
          icon={Sparkles}
        />
        <SummaryCard
          label="Package"
          value={context.plan?.name || context.plan?.key || "Assigned"}
          detail="Controls included client features"
          icon={Package}
        />
        <SummaryCard
          label="Booking"
          value={bookingReady ? "Ready" : "Needs setup"}
          detail={
            bookingReady
              ? "Services, staff and hours linked"
              : "Complete booking prerequisites"
          }
          icon={CalendarCheck2}
        />
        <SummaryCard
          label="Launch"
          value={goLiveReady ? "Live" : publications[0]?.status ? humanise(publications[0].status) : "Not yet"}
          detail={
            goLiveReady
              ? livePublication?.hostname
              : "Complete setup before launch"
          }
          icon={CreditCard}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <section className={`${surface} overflow-hidden`}>
          <div className="border-b border-slate-800 px-5 py-5 sm:px-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                  Launch journey
                </p>
                <h2 className="mt-2 text-lg font-black text-white">
                  Setup and onboarding
                </h2>
              </div>
              <span className="text-xs font-black text-slate-300">
                {progress}% complete
              </span>
            </div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-violet-500 transition-all"
                style={{ width: `${Math.max(progress, 2)}%` }}
              />
            </div>
          </div>
          <ol>
            {journey.map((stage) => {
              const Icon = stage.icon;
              const selected = activeStageId === stage.id;
              return (
                <li
                  key={stage.id}
                  className="border-b border-slate-800 last:border-b-0"
                >
                  <button
                    type="button"
                    onClick={() => setSelectedStageId(stage.id)}
                    className={`group flex w-full items-center gap-4 px-5 py-4 text-left transition sm:px-6 ${selected ? "bg-violet-950/35" : "hover:bg-slate-800/35"}`}
                  >
                    <span
                      className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border text-xs font-black ${stage.ready ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : selected ? "border-violet-500 bg-violet-500 text-white" : "border-slate-700 bg-slate-800 text-slate-400"}`}
                    >
                      {stage.ready ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        stage.id
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong className="block text-sm text-white">
                        {stage.title}
                      </strong>
                      <span className="mt-1 block text-xs text-slate-500">
                        {stage.detail}
                      </span>
                    </span>
                    <StatusBadge value={stage.status} />
                    <ChevronRight className="h-4 w-4 text-slate-600 transition group-hover:translate-x-1 group-hover:text-violet-300" />
                  </button>
                </li>
              );
            })}
          </ol>
        </section>

        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <section className={`${surface} p-5 sm:p-6`}>
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-violet-500/15 text-violet-200">
              <recommendedStage.icon className="h-5 w-5" />
            </div>
            <p className="mt-5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
              Recommended next action
            </p>
            <h2 className="mt-2 text-lg font-black text-white">
              {recommendedStage.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Open the next incomplete stage and keep the launch moving without
              scanning every control.
            </p>
            <button
              type="button"
              onClick={() => setSelectedStageId(recommendedStage.id)}
              className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-xs font-black text-white"
            >
              Open {recommendedStage.title.toLowerCase()}{" "}
              <ArrowRight className="h-4 w-4" />
            </button>
          </section>
          <section className={`${surface} p-5 sm:p-6`}>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
              Manage this client
            </p>
            <div className="mt-4 grid gap-2">
              <Link
                to={`/agency/fact-finding?tenant=${tenantId}&return=${encodeURIComponent(`/agency/provisioning?tenant=${tenantId}`)}`}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 px-3 text-xs font-black text-slate-200"
              >
                <ShieldCheck className="h-4 w-4" />
                Fact finding
              </Link>
              <button
                type="button"
                onClick={() => setSelectedStageId(3)}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 px-3 text-xs font-black text-slate-200"
              >
                <CalendarCheck2 className="h-4 w-4" />
                Booking setup
              </button>
              <button
                type="button"
                onClick={() => setSelectedStageId(4)}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 px-3 text-xs font-black text-slate-200"
              >
                <LayoutTemplate className="h-4 w-4" />
                Website design
              </button>
              {siteReference ? (
                <Link
                  to={`/agency/sites/${siteReference}/studio`}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 px-3 text-xs font-black text-slate-200"
                >
                  <Wrench className="h-4 w-4" />
                  Site Studio
                </Link>
              ) : null}
            </div>
          </section>
        </aside>
      </div>

      {renderStage()}

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          disabled={activeStageId <= 1}
          onClick={() => setSelectedStageId(Math.max(1, activeStageId - 1))}
          className="min-h-11 rounded-xl border border-slate-700 px-4 text-xs font-black text-slate-300 disabled:opacity-30"
        >
          Previous step
        </button>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          {journey.map((stage) =>
            stage.id === activeStageId ? (
              <Circle
                key={stage.id}
                className="h-3 w-3 fill-violet-400 text-violet-400"
              />
            ) : (
              <Circle key={stage.id} className="h-3 w-3 text-slate-700" />
            ),
          )}
        </div>
        <button
          type="button"
          disabled={activeStageId >= journey.length}
          onClick={() =>
            setSelectedStageId(Math.min(journey.length, activeStageId + 1))
          }
          className="min-h-11 rounded-xl border border-violet-700 px-4 text-xs font-black text-violet-200 disabled:opacity-30"
        >
          Next step
        </button>
      </div>
    </div>
  );
}

export default AgencyFocusedLaunchJourney;
