"use client";

import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BedDouble,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  Hotel,
  Inbox,
  LayoutDashboard,
  LoaderCircle,
  Mail,
  Menu,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useMemo, useState, useEffect, useRef, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { UserButton, useOrganization } from "@clerk/nextjs";
import HotelOrganizationSwitcher from "@/components/hotel-organization-switcher";
import HotelPicker from "@/components/hotel-picker";

export type EnquirySummary = {
  id: number;
  status: string;
  email?: string | null;
  email_content?: string | null;
  created_at?: string | null;
};

type Reservation = {
  id: number;
  arrival_date: string | null;
  departure_date: string | null;
  num_rooms: number | null;
  num_adults: number | null;
  num_children: number | null;
  children_ages: number[];
  room_type: string | null;
};

type EnquiryDetail = {
  id: number;
  status: string;
  email?: string | null;
  email_content?: string | null;
  created_at?: string | null;
  reservations: Reservation[];
};

const ENQUIRIES_PER_PAGE = 10;

type View = "overview" | "inbox";
type Filter = "all" | "needs_review" | "approved";
type ReservationDraft = {
  arrival_date: string;
  departure_date: string;
  num_rooms: string;
  num_adults: string;
  num_children: string;
  children_ages: string;
  room_type: string;
};

const cls = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(" ");

const excerpt = (enquiry: EnquirySummary) =>
  (enquiry.email ?? enquiry.email_content ?? "No email content available")
    .replace(/\s+/g, " ")
    .trim();

const statusLabel = (status: string) =>
  status === "needs_review"
    ? "Needs review"
    : status === "approved"
      ? "Approved"
      : status.replaceAll("_", " ");

const prettyDate = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const stayDate = (value?: string | null) => {
  if (!value) return "Not specified";
  // Dates from FastAPI are YYYY-MM-DD. Keep them date-only (no TZ shift).
  return value;
};

const countLabel = (count: number) => count.toLocaleString();

// Date sent to FastAPI must be YYYY-MM-DD, based on the staff member's local day.
function todayLocalDate(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function StatusBadge({ status }: { status: string }) {
  const approved = status === "approved";
  return (
    <span
      className={cls(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        approved
          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
          : status === "needs_review"
            ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
            : "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
      )}
    >
      <span
        className={cls(
          "h-1.5 w-1.5 rounded-full",
          approved
            ? "bg-emerald-500"
            : status === "needs_review"
              ? "bg-amber-500"
              : "bg-slate-400",
        )}
      />
      {statusLabel(status)}
    </span>
  );
}

function toDraft(r: Reservation): ReservationDraft {
  return {
    arrival_date: r.arrival_date ?? "",
    departure_date: r.departure_date ?? "",
    num_rooms: r.num_rooms?.toString() ?? "",
    num_adults: r.num_adults?.toString() ?? "",
    num_children: r.num_children?.toString() ?? "",
    children_ages: (r.children_ages ?? []).join(", "),
    room_type: r.room_type ?? "",
  };
}

function errorText(result: unknown, fallback: string) {
  if (typeof result === "object" && result !== null && "detail" in result) {
    const detail = (result as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((item: { msg?: string }) => item?.msg ?? "Invalid field")
        .join("; ");
    }
  }
  return fallback;
}

export default function EnquiriesDashboard({
  enquiries,
}: {
  enquiries: EnquirySummary[];
}) {
  const router = useRouter();
  const [view, setView] = useState<View>("overview");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [mobileNav, setMobileNav] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newHotelId, setNewHotelId] = useState<number | null>(null);
  const [newDate, setNewDate] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<EnquiryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailActionLoading, setDetailActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<ReservationDraft | null>(null);

  // The dashboard data is fetched server-side for the active Clerk organization.
  // When an admin switches organizations, discard open dialogs and refetch it.
  const { organization, isLoaded: organizationLoaded } = useOrganization();
  const activeOrgId = organization?.id ?? null;
  const previousOrgId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!organizationLoaded) return;
    if (previousOrgId.current === undefined) {
      previousOrgId.current = activeOrgId;
      return;
    }
    if (previousOrgId.current !== activeOrgId) {
      previousOrgId.current = activeOrgId;
      setSelectedId(null);
      setShowNew(false);
      setNewHotelId(null);
      setPage(1);
      router.refresh();
    }
  }, [organizationLoaded, activeOrgId, router]);

  const total = enquiries.length;
  const pending = enquiries.filter((e) => e.status === "needs_review").length;
  const approved = enquiries.filter((e) => e.status === "approved").length;
  const approvalRate = total ? Math.round((approved / total) * 100) : 0;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return enquiries.filter((e) => {
      const byStatus = filter === "all" || e.status === filter;
      const byText =
        !needle || `${e.id} ${excerpt(e)}`.toLowerCase().includes(needle);
      return byStatus && byText;
    });
  }, [enquiries, filter, query]);

  // Paginate the shared inbox list after status and search filters are applied.
  const totalPages = Math.max(
    1,
    Math.ceil(filtered.length / ENQUIRIES_PER_PAGE),
  );
  const currentPage = Math.min(page, totalPages);
  const firstIndex = (currentPage - 1) * ENQUIRIES_PER_PAGE;
  const rows =
    view === "overview"
      ? filtered.slice(0, 6)
      : filtered.slice(firstIndex, firstIndex + ENQUIRIES_PER_PAGE);
  const firstShown = filtered.length === 0 ? 0 : firstIndex + 1;
  const lastShown = Math.min(firstIndex + ENQUIRIES_PER_PAGE, filtered.length);

  function openNewEnquiry() {
    setNewHotelId(null);
    setNewDate(todayLocalDate());
    setCreateError("");
    setShowNew(true);
  }

  const navigate = (nextView: View, nextFilter: Filter = "all") => {
    setView(nextView);
    setFilter(nextFilter);
    setQuery("");
    setPage(1);
    setMobileNav(false);
  };

  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    setDetail(null);
    setDetailError("");
    setActionError("");
    setConfirmDelete(false);
    setDetailLoading(true);
    setEditingId(null);
    fetch(`/backend/enquiries/${selectedId}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(`Couldn't open enquiry (${response.status})`);
        return (await response.json()) as EnquiryDetail;
      })
      .then(setDetail)
      .catch((err: unknown) => {
        if (!controller.signal.aborted)
          setDetailError(
            err instanceof Error ? err.message : "Couldn't load enquiry",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [selectedId]);

  async function reloadDetail(id: number) {
    const response = await fetch(`/backend/enquiries/${id}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Couldn't reload enquiry");
    setDetail((await response.json()) as EnquiryDetail);
    router.refresh();
  }

  async function submitNew(event: ChangeEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = newEmail.trim();
    if (!email || !newDate) {
      setCreateError("Please enter the guest email and received date.");
      return;
    }
    if (newHotelId === null) {
      setCreateError("Please select a hotel property.");
      return;
    }

    setCreating(true);
    setCreateError("");
    try {
      const response = await fetch("/backend/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          email_date: newDate,
          hotel_id: newHotelId,
        }),
      });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          errorText(result, `Couldn't create enquiry (${response.status})`),
        );
      }

      setShowNew(false);
      setNewEmail("");
      setNewDate("");
      setNewHotelId(null);
      setView("inbox");
      setFilter("all");
      setQuery("");
      setPage(1);
      router.refresh();
      // Our FastAPI create endpoint returns { id, status, reservations_count }.
      if (typeof result === "object" && result !== null && "id" in result) {
        const id = (result as { id: unknown }).id;
        if (typeof id === "number") setSelectedId(id);
      }
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Something went wrong",
      );
    } finally {
      setCreating(false);
    }
  }

  async function deleteEnquiry() {
    if (!detail || detail.status === "approved") return;
    setDetailActionLoading(true);
    setActionError("");
    try {
      const response = await fetch(`/backend/enquiries/${detail.id}`, {
        method: "DELETE",
      });
      // Successful DELETE returns 204 No Content, so don't call response.json().
      if (!response.ok) {
        const result: unknown = await response.json().catch(() => null);
        throw new Error(
          errorText(result, `Couldn't delete enquiry (${response.status})`),
        );
      }
      setConfirmDelete(false);
      setSelectedId(null);
      setDetail(null);
      router.refresh();
    } catch (err) {
      setConfirmDelete(false);
      setActionError(
        err instanceof Error ? err.message : "Couldn't delete enquiry",
      );
    } finally {
      setDetailActionLoading(false);
    }
  }

  async function approveEnquiry() {
    if (!detail) return;
    setDetailActionLoading(true);
    setActionError("");
    try {
      const response = await fetch(`/backend/enquiries/${detail.id}/approve`, {
        method: "POST",
      });
      const result: unknown = await response.json();
      if (!response.ok)
        throw new Error(errorText(result, "Couldn't approve enquiry"));
      await reloadDetail(detail.id);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Couldn't approve enquiry",
      );
    } finally {
      setDetailActionLoading(false);
    }
  }

  async function saveReservation(reservationId: number) {
    if (!draft || !detail) return;
    setDetailActionLoading(true);
    setActionError("");
    const intOrNull = (value: string) =>
      value.trim() === "" ? null : Number(value);
    const ages = draft.children_ages.trim()
      ? draft.children_ages.split(",").map((s) => Number(s.trim()))
      : [];
    if (ages.some((age) => !Number.isInteger(age) || age < 0)) {
      setActionError(
        "Children's ages must be non-negative whole numbers, separated by commas.",
      );
      setDetailActionLoading(false);
      return;
    }
    const body = {
      arrival_date: draft.arrival_date || null,
      departure_date: draft.departure_date || null,
      num_rooms: intOrNull(draft.num_rooms),
      num_adults: intOrNull(draft.num_adults),
      num_children: intOrNull(draft.num_children),
      children_ages: ages,
      room_type: draft.room_type.trim() || null,
    };
    try {
      const response = await fetch(`/backend/reservations/${reservationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result: unknown = await response.json();
      if (!response.ok)
        throw new Error(errorText(result, "Couldn't save changes"));
      setEditingId(null);
      setDraft(null);
      await reloadDetail(detail.id);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Couldn't save changes",
      );
    } finally {
      setDetailActionLoading(false);
    }
  }

  const sidebar = (
    <div className="flex h-full flex-col bg-[#121d35] text-white">
      <div className="flex items-center justify-between border-b border-white/10 px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#78e4d2] to-[#36abca] text-slate-950 shadow-lg shadow-cyan-500/10">
            <Hotel size={21} strokeWidth={2.3} />
          </div>
          <div>
            <div className="text-base font-extrabold tracking-tight">
              Hotel AI
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.19em] text-slate-400">
              Reservations
            </div>
          </div>
        </div>
        <button
          className="rounded-lg p-1 text-slate-400 hover:text-white lg:hidden"
          onClick={() => setMobileNav(false)}
          aria-label="Close menu"
        >
          <X size={19} />
        </button>
      </div>

      <div className="flex-1 space-y-7 px-3 py-7">
        <div>
          <p className="px-4 pb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
            Workspace
          </p>
          <nav className="space-y-1" aria-label="Main navigation">
            <SideButton
              icon={LayoutDashboard}
              title="Overview"
              active={view === "overview"}
              onClick={() => navigate("overview")}
            />
            <SideButton
              icon={Inbox}
              title="Enquiries"
              count={total}
              active={view === "inbox" && filter === "all"}
              onClick={() => navigate("inbox")}
            />
          </nav>
        </div>
        <div>
          <p className="px-4 pb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
            Review queue
          </p>
          <nav className="space-y-1" aria-label="Review queue">
            <SideButton
              icon={Clock3}
              title="Needs review"
              count={pending}
              active={view === "inbox" && filter === "needs_review"}
              onClick={() => navigate("inbox", "needs_review")}
            />
            <SideButton
              icon={CheckCircle2}
              title="Approved"
              count={approved}
              active={view === "inbox" && filter === "approved"}
              onClick={() => navigate("inbox", "approved")}
            />
          </nav>
        </div>
        <div>
          <p className="px-4 pb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
            Coming later
          </p>
          <div className="flex items-center justify-between px-4 py-3 text-sm text-slate-500">
            <span className="flex items-center gap-3">
              <Activity size={17} /> Analytics
            </span>
            <span className="text-[10px]">Soon</span>
          </div>
        </div>
      </div>
      <div className="mx-4 mb-5 rounded-2xl border border-cyan-300/15 bg-white/[0.05] p-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-cyan-200">
          <ShieldCheck size={15} /> Human-reviewed AI
        </div>
        <p className="text-xs leading-5 text-slate-400">
          AI extracts the details. Your team stays in control.
        </p>
      </div>
      <div className="border-t border-white/10 px-6 py-4 text-xs text-slate-500">
        Reservation workspace · MVP
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[250px] lg:block">
        {sidebar}
      </aside>
      {mobileNav && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            className="absolute inset-0 bg-slate-900/50"
            aria-label="Close menu"
            onClick={() => setMobileNav(false)}
          />
          <aside className="relative h-full w-[250px] shadow-2xl">
            {sidebar}
          </aside>
        </div>
      )}
      <div className="lg:pl-[250px]">
        <header className="sticky top-0 z-10 flex h-[76px] items-center justify-between border-b border-slate-200/80 bg-white/95 px-5 backdrop-blur md:px-9">
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
              onClick={() => setMobileNav(true)}
              aria-label="Open menu"
            >
              <Menu size={21} />
            </button>
            <div className="hidden text-sm text-slate-400 sm:block">
              Workspace <span className="mx-2 text-slate-300">/</span>
            </div>
            <span className="text-sm font-semibold text-slate-700">
              {view === "overview" ? "Overview" : "Enquiries"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{" "}
              AI-assisted workspace
            </span>
            <div className="flex items-center gap-2" aria-label="Account menu">
              <UserButton
                appearance={{
                  elements: {
                    avatarBox: "h-9 w-9",
                  },
                }}
              />
              <HotelOrganizationSwitcher />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1500px] space-y-7 px-5 py-8 md:px-9 lg:py-10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#2b9b96]">
                <Sparkles size={14} /> Reservations command center
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight text-[#17233b] md:text-4xl">
                {view === "overview" ? "Overview" : "Reservation inbox"}
              </h1>
              <p className="mt-2 text-sm text-slate-500">
                {view === "overview"
                  ? "A clear view of every enquiry that needs attention."
                  : "Review AI-extracted requests and keep the inbox moving."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => router.refresh()}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                title="Refresh enquiries"
              >
                <RefreshCw size={16} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
              <button
                onClick={openNewEnquiry}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#246d77] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1c5c65]"
              >
                <Plus size={17} /> New enquiry
              </button>
            </div>
          </div>

          {view === "overview" && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  label="Total enquiries"
                  value={countLabel(total)}
                  description="Saved in the inbox"
                  icon={Mail}
                  tone="blue"
                  onClick={() => navigate("inbox")}
                />
                <MetricCard
                  label="Needs review"
                  value={countLabel(pending)}
                  description="Waiting for your team"
                  icon={Clock3}
                  tone="amber"
                  onClick={() => navigate("inbox", "needs_review")}
                />
                <MetricCard
                  label="Approved"
                  value={countLabel(approved)}
                  description="Reviewed by your team"
                  icon={CheckCircle2}
                  tone="green"
                  onClick={() => navigate("inbox", "approved")}
                />
                <MetricCard
                  label="Approval rate"
                  value={`${approvalRate}%`}
                  description="Approved / all enquiries"
                  icon={Activity}
                  tone="violet"
                  onClick={() => navigate("inbox", "approved")}
                />
              </div>
              <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
                <div className="relative overflow-hidden rounded-[22px] bg-[#172d49] p-7 text-white shadow-sm">
                  <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-cyan-400/10 blur-2xl" />
                  <div className="absolute bottom-0 right-14 h-40 w-40 rounded-full bg-emerald-300/10 blur-xl" />
                  <div className="relative flex items-start justify-between gap-4">
                    <div className="max-w-md">
                      <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold text-cyan-100">
                        <Sparkles size={13} /> Review queue
                      </div>
                      <p className="text-3xl font-extrabold tracking-tight">
                        {pending === 0
                          ? "All caught up."
                          : `${pending} ${pending === 1 ? "enquiry" : "enquiries"} to review`}
                      </p>
                      <p className="mt-3 text-sm leading-6 text-slate-300">
                        Open an enquiry to compare the guest email with the
                        AI-extracted reservation details.
                      </p>
                      <button
                        onClick={() => navigate("inbox", "needs_review")}
                        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-[#172d49] transition hover:bg-cyan-50"
                      >
                        Open review queue <ArrowRight size={16} />
                      </button>
                    </div>
                    <div className="hidden h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/10 sm:flex">
                      <FileText className="text-cyan-200" size={29} />
                    </div>
                  </div>
                </div>
                <div className="rounded-[22px] border border-slate-200/80 bg-white p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-bold text-slate-800">
                      Review progress
                    </h2>
                    <span className="text-xs font-semibold text-slate-400">
                      All time
                    </span>
                  </div>
                  <div className="mt-6 flex items-end justify-between">
                    <div>
                      <span className="text-4xl font-extrabold tracking-tight text-slate-900">
                        {approvalRate}%
                      </span>
                      <span className="ml-2 text-sm text-slate-400">
                        approved
                      </span>
                    </div>
                    <CheckCircle2 size={26} className="text-emerald-500" />
                  </div>
                  <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#3a8e91] to-[#66c7b5] transition-all"
                      style={{ width: `${approvalRate}%` }}
                    />
                  </div>
                  <p className="mt-4 text-sm leading-6 text-slate-500">
                    {approved} approved · {pending} awaiting review
                    {total - approved - pending > 0
                      ? ` · ${total - approved - pending} other`
                      : ""}
                  </p>
                </div>
              </div>
            </>
          )}

          <section className="overflow-hidden rounded-[22px] border border-slate-200/80 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-5">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {view === "overview" ? "Recent enquiries" : "All enquiries"}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  {view === "overview"
                    ? "The latest requests in your inbox"
                    : `${filtered.length} matching ${filtered.length === 1 ? "enquiry" : "enquiries"}`}
                </p>
              </div>
              {view === "overview" && (
                <button
                  onClick={() => navigate("inbox")}
                  className="inline-flex items-center gap-1 text-sm font-bold text-[#246d77] hover:underline"
                >
                  View all <ArrowUpRight size={16} />
                </button>
              )}
            </div>

            <div className="flex flex-col gap-4 border-b border-slate-100 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap gap-2">
                {(["all", "needs_review", "approved"] as Filter[]).map(
                  (key) => (
                    <button
                      key={key}
                      onClick={() => {
                        setFilter(key);
                        setPage(1);
                        if (view === "overview") setView("inbox");
                      }}
                      className={cls(
                        "rounded-lg px-3.5 py-2 text-xs font-bold transition",
                        filter === key
                          ? "bg-[#e8f4f3] text-[#246d77]"
                          : "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
                      )}
                    >
                      {key === "all" ? "All" : statusLabel(key)}
                    </button>
                  ),
                )}
              </div>
              <div className="relative w-full lg:max-w-[320px]">
                <Search
                  size={17}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search emails or enquiry ID"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-[#fafbfd] pl-10 pr-4 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] border-collapse text-left">
                <thead>
                  <tr className="bg-[#fbfcfe] text-[11px] font-bold uppercase tracking-[0.13em] text-slate-400">
                    <th className="px-6 py-4">Enquiry</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Received</th>
                    <th className="w-20 px-6 py-4 text-right">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((enquiry) => (
                    <tr
                      key={enquiry.id}
                      className="group border-t border-slate-100 transition-colors hover:bg-[#f7fbfc]"
                    >
                      <td className="px-6 py-4">
                        <button
                          onClick={() => setSelectedId(enquiry.id)}
                          className="flex max-w-[520px] items-start gap-3 text-left"
                        >
                          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#edf6f7] text-[#358c94]">
                            <Mail size={18} />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-bold text-slate-800 group-hover:text-[#246d77]">
                              Enquiry #{enquiry.id}
                            </span>
                            <span className="mt-1 block truncate text-xs text-slate-500">
                              {excerpt(enquiry)}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={enquiry.status} />
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-500">
                        {prettyDate(enquiry.created_at)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => setSelectedId(enquiry.id)}
                          aria-label={`Open enquiry ${enquiry.id}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-teal-50 hover:text-[#246d77]"
                        >
                          <ChevronRight size={19} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && (
                <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
                  <Inbox size={30} className="text-slate-300" />
                  <p className="mt-2 text-sm font-bold text-slate-700">
                    No enquiries found
                  </p>
                  <p className="text-xs text-slate-500">
                    Try a different search or status filter.
                  </p>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-4 text-xs text-slate-500">
              <span>
                {view === "overview"
                  ? `Showing ${rows.length} of ${filtered.length} matching enquiries`
                  : `Showing ${firstShown}-${lastShown} of ${filtered.length} matching enquiries`}
              </span>
              {view === "overview" ? (
                <button
                  className="font-bold text-[#246d77]"
                  onClick={() => navigate("inbox")}
                >
                  Full inbox <ArrowRight size={13} className="ml-1 inline" />
                </button>
              ) : (
                <nav
                  className="flex items-center gap-3"
                  aria-label="Enquiry pages"
                >
                  <button
                    type="button"
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                    disabled={currentPage === 1}
                    className="rounded-lg border border-slate-200 px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span aria-live="polite">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setPage((value) => Math.min(totalPages, value + 1))
                    }
                    disabled={currentPage === totalPages}
                    className="rounded-lg border border-slate-200 px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next
                  </button>
                </nav>
              )}
            </div>
          </section>
          <p className="pb-2 text-center text-xs text-slate-400">
            Enquiries are AI-extracted requests, not confirmed hotel bookings.
          </p>
        </main>
      </div>

      {showNew && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f1d31]/60 p-4 backdrop-blur-[3px]"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !creating) setShowNew(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-enquiry-title"
            className="w-full max-w-xl rounded-[24px] bg-white p-6 shadow-2xl sm:p-8"
          >
            <div className="mb-6 flex items-start justify-between">
              <div>
                <span className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[#24817e]">
                  <Sparkles size={14} /> AI extraction
                </span>
                <h2
                  id="new-enquiry-title"
                  className="text-2xl font-extrabold tracking-tight text-slate-900"
                >
                  New enquiry
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  Paste a booking email to extract its reservation details.
                </p>
              </div>
              <button
                onClick={() => setShowNew(false)}
                disabled={creating}
                aria-label="Close"
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={submitNew} className="space-y-4">
              <HotelPicker
                value={newHotelId}
                onChange={setNewHotelId}
                disabled={creating}
              />
              <label className="block text-sm font-bold text-slate-700">
                Email received on
                <input
                  required
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="mt-2 block w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-normal outline-none focus:border-teal-500"
                />
              </label>
              <label className="block text-sm font-bold text-slate-700">
                Guest email
                <textarea
                  required
                  rows={7}
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="Hello, I would like to reserve two double rooms from…"
                  className="mt-2 block w-full resize-y rounded-xl border border-slate-200 px-4 py-3 text-sm font-normal leading-6 outline-none placeholder:text-slate-400 focus:border-teal-500"
                />
              </label>
              {createError && (
                <p
                  role="alert"
                  className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
                >
                  {createError}
                </p>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={creating}
                  onClick={() => setShowNew(false)}
                  className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#246d77] px-5 py-3 text-sm font-bold text-white hover:bg-[#1c5c65] disabled:opacity-60"
                >
                  {creating ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : (
                    <Sparkles size={16} />
                  )}
                  {creating ? "Extracting…" : "Extract & save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmDelete && detail && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4"
          role="presentation"
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-enquiry-title"
            aria-describedby="delete-enquiry-description"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
          >
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-red-50 text-red-700">
              <Trash2 size={22} />
            </div>
            <h2
              id="delete-enquiry-title"
              className="text-lg font-extrabold text-slate-900"
            >
              Delete enquiry #{detail.id}?
            </h2>
            <p
              id="delete-enquiry-description"
              className="mt-2 text-sm leading-6 text-slate-600"
            >
              This permanently deletes the enquiry, its reservations, and review
              history. You cannot undo this.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={detailActionLoading}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={deleteEnquiry}
                disabled={detailActionLoading}
                className="inline-flex items-center gap-2 rounded-xl bg-red-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-800 disabled:opacity-50"
              >
                {detailActionLoading ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : (
                  <Trash2 size={16} />
                )}{" "}
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedId !== null && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-[#0f1d31]/50"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !detailActionLoading)
              setSelectedId(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Enquiry ${selectedId} details`}
            className="flex h-full w-full max-w-[680px] flex-col bg-[#f8fafc] shadow-2xl"
          >
            <div className="flex items-start justify-between border-b border-slate-200 bg-white px-5 py-5 sm:px-8">
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#2b9b96]">
                  <FileText size={14} /> Enquiry details
                </div>
                <h2 className="text-2xl font-extrabold text-slate-900">
                  Enquiry #{selectedId}
                </h2>
              </div>
              <button
                onClick={() => setSelectedId(null)}
                className="rounded-xl border border-slate-200 p-2.5 text-slate-500 hover:bg-slate-50"
                aria-label="Close enquiry"
              >
                <X size={19} />
              </button>
            </div>
            {detailLoading ? (
              <div className="flex flex-1 items-center justify-center gap-2 text-sm text-slate-500">
                <LoaderCircle className="animate-spin" size={20} /> Loading
                enquiry…
              </div>
            ) : detailError ? (
              <div
                role="alert"
                className="m-6 rounded-xl bg-red-50 p-4 text-sm text-red-700"
              >
                {detailError}
              </div>
            ) : detail ? (
              <>
                <div className="flex-1 space-y-5 overflow-y-auto p-5 sm:p-8">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <StatusBadge status={detail.status} />
                    <p className="text-xs text-slate-500">
                      {prettyDate(detail.created_at)}
                    </p>
                  </div>
                  <section className="rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-800">
                      <Mail size={17} className="text-[#2b8a90]" /> Original
                      guest email
                    </h3>
                    <p className="whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 text-sm leading-7 text-slate-700">
                      {detail.email ??
                        detail.email_content ??
                        "Email content unavailable"}
                    </p>
                  </section>
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-bold text-slate-800">
                      Extracted reservations
                    </h3>
                    <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-[#246d77]">
                      {detail.reservations?.length ?? 0} records
                    </span>
                  </div>
                  {(detail.reservations ?? []).map((r, index) => (
                    <section
                      key={r.id}
                      className="rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm"
                    >
                      <div className="mb-4 flex items-center justify-between">
                        <h4 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                          <BedDouble size={18} className="text-[#2b8a90]" />{" "}
                          Reservation {index + 1}
                        </h4>
                        {detail.status !== "approved" && editingId !== r.id && (
                          <button
                            onClick={() => {
                              setEditingId(r.id);
                              setDraft(toDraft(r));
                              setActionError("");
                            }}
                            className="text-xs font-bold text-[#246d77] hover:underline"
                          >
                            Edit fields
                          </button>
                        )}
                      </div>
                      {editingId === r.id && draft ? (
                        <div className="space-y-4">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <EditField
                              label="Arrival"
                              type="date"
                              value={draft.arrival_date}
                              onChange={(v) =>
                                setDraft({ ...draft, arrival_date: v })
                              }
                            />
                            <EditField
                              label="Departure"
                              type="date"
                              value={draft.departure_date}
                              onChange={(v) =>
                                setDraft({ ...draft, departure_date: v })
                              }
                            />
                            <EditField
                              label="Rooms"
                              type="number"
                              value={draft.num_rooms}
                              onChange={(v) =>
                                setDraft({ ...draft, num_rooms: v })
                              }
                            />
                            <EditField
                              label="Adults"
                              type="number"
                              value={draft.num_adults}
                              onChange={(v) =>
                                setDraft({ ...draft, num_adults: v })
                              }
                            />
                            <EditField
                              label="Children"
                              type="number"
                              value={draft.num_children}
                              onChange={(v) =>
                                setDraft({ ...draft, num_children: v })
                              }
                            />
                            <EditField
                              label="Children ages (comma-separated)"
                              value={draft.children_ages}
                              onChange={(v) =>
                                setDraft({ ...draft, children_ages: v })
                              }
                            />
                            <div className="sm:col-span-2">
                              <EditField
                                label="Room type"
                                value={draft.room_type}
                                onChange={(v) =>
                                  setDraft({ ...draft, room_type: v })
                                }
                              />
                            </div>
                          </div>
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => {
                                setEditingId(null);
                                setDraft(null);
                                setActionError("");
                              }}
                              className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600"
                            >
                              Cancel
                            </button>
                            <button
                              disabled={detailActionLoading}
                              onClick={() => saveReservation(r.id)}
                              className="inline-flex items-center gap-2 rounded-lg bg-[#246d77] px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                            >
                              {detailActionLoading ? (
                                <LoaderCircle
                                  className="animate-spin"
                                  size={14}
                                />
                              ) : (
                                <Check size={14} />
                              )}{" "}
                              Save corrections
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="grid gap-4 sm:grid-cols-2">
                          <DetailItem
                            icon={CalendarDays}
                            label="Arrival"
                            value={stayDate(r.arrival_date)}
                          />
                          <DetailItem
                            icon={CalendarDays}
                            label="Departure"
                            value={stayDate(r.departure_date)}
                          />
                          <DetailItem
                            icon={BedDouble}
                            label="Rooms"
                            value={r.num_rooms?.toString() ?? "Unknown"}
                          />
                          <DetailItem
                            icon={Users}
                            label="Adults"
                            value={r.num_adults?.toString() ?? "Unknown"}
                          />
                          <DetailItem
                            icon={Users}
                            label="Children"
                            value={r.num_children?.toString() ?? "Unknown"}
                          />
                          <DetailItem
                            icon={Users}
                            label="Children's ages"
                            value={
                              r.children_ages?.length
                                ? r.children_ages.join(", ")
                                : "Not provided"
                            }
                          />
                          <div className="sm:col-span-2">
                            <DetailItem
                              icon={BedDouble}
                              label="Room type"
                              value={r.room_type ?? "Not specified"}
                            />
                          </div>
                        </div>
                      )}
                    </section>
                  ))}
                  {(detail.reservations ?? []).length === 0 && (
                    <p className="rounded-xl bg-white p-5 text-sm text-slate-500">
                      No reservation details were extracted.
                    </p>
                  )}
                  {actionError && (
                    <p
                      role="alert"
                      className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
                    >
                      {actionError}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-5 sm:px-8">
                  <p className="max-w-[245px] text-xs leading-5 text-slate-500">
                    Approval confirms staff review, not a booking in the hotel
                    PMS.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {detail.status !== "approved" && (
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(true)}
                        disabled={detailActionLoading || editingId !== null}
                        className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-4 py-3 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        <Trash2 size={16} /> Delete
                      </button>
                    )}
                    {detail.status === "approved" ? (
                      <span className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
                        <CheckCircle2 size={17} /> Approved
                      </span>
                    ) : (
                      <button
                        disabled={detailActionLoading || editingId !== null}
                        onClick={approveEnquiry}
                        className="inline-flex items-center gap-2 rounded-xl bg-[#246d77] px-5 py-3 text-sm font-bold text-white hover:bg-[#1c5c65] disabled:opacity-50"
                      >
                        {detailActionLoading ? (
                          <LoaderCircle className="animate-spin" size={16} />
                        ) : (
                          <CheckCircle2 size={17} />
                        )}{" "}
                        Approve extraction
                      </button>
                    )}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

type IconType = typeof Mail;

function SideButton({
  icon: Icon,
  title,
  active,
  onClick,
  count,
}: {
  icon: IconType;
  title: string;
  active: boolean;
  onClick: () => void;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cls(
        "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold transition",
        active
          ? "bg-white/12 text-white shadow-inner"
          : "text-slate-400 hover:bg-white/[0.06] hover:text-white",
      )}
    >
      <Icon
        size={18}
        className={active ? "text-[#7ee3d6]" : "text-slate-500"}
      />
      <span className="flex-1">{title}</span>
      {count !== undefined && (
        <span
          className={cls(
            "rounded-md px-1.5 py-0.5 text-[11px]",
            active
              ? "bg-white/15 text-white"
              : "bg-white/[0.06] text-slate-400",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function MetricCard({
  label,
  value,
  description,
  icon: Icon,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  description: string;
  icon: IconType;
  tone: "blue" | "amber" | "green" | "violet";
  onClick: () => void;
}) {
  const styles = {
    blue: "bg-[#e7f2fa] text-[#327fa9]",
    amber: "bg-[#fff3e2] text-[#c18430]",
    green: "bg-[#e8f8ef] text-[#35a16c]",
    violet: "bg-[#f1edff] text-[#7762be]",
  };
  return (
    <button
      onClick={onClick}
      className="group rounded-[20px] border border-slate-200/80 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-start justify-between">
        <div
          className={cls(
            "flex h-11 w-11 items-center justify-center rounded-xl",
            styles[tone],
          )}
        >
          <Icon size={21} />
        </div>
        <ArrowUpRight
          size={17}
          className="text-slate-300 transition group-hover:text-slate-600"
        />
      </div>
      <div className="mt-5 text-3xl font-extrabold tracking-tight text-slate-900">
        {value}
      </div>
      <div className="mt-1 text-sm font-bold text-slate-700">{label}</div>
      <div className="mt-2 text-xs text-slate-400">{description}</div>
    </button>
  );
}

function DetailItem({
  icon: Icon,
  label,
  value,
}: {
  icon: IconType;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon size={16} className="mt-0.5 shrink-0 text-slate-400" />
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          {label}
        </p>
        <p className="mt-1 break-words text-sm font-semibold text-slate-800">
          {value}
        </p>
      </div>
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="block text-xs font-bold text-slate-600">
      {label}
      <input
        type={type}
        min={type === "number" ? (label === "Rooms" ? 1 : 0) : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-normal text-slate-800 outline-none focus:border-teal-400"
      />
    </label>
  );
}
