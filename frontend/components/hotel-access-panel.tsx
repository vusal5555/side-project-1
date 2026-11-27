"use client";

import { useOrganization } from "@clerk/nextjs";
import {
  AlertCircle,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  createHotel,
  createHotelsBulk,
  deleteHotel,
  getStaffHotelAccess,
  listHotels,
  saveStaffHotelAccess,
  type Hotel,
} from "@/lib/hotel-api";

type Tab = "properties" | "access";

function isAdminRole(role: string | undefined | null) {
  return role === "org:admin" || role === "admin";
}

function displayError(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please retry.";
}

// Clerk may return an API error (with an `errors` array) or a regular Error.
// Reading the response safely makes the actual failure visible in the UI.
function membershipErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    if ("errors" in error && Array.isArray(error.errors)) {
      const first = error.errors[0];
      if (
        first &&
        typeof first === "object" &&
        "message" in first &&
        typeof first.message === "string"
      ) {
        return first.message;
      }
    }
    if ("message" in error && typeof error.message === "string") {
      return error.message;
    }
  }
  return "Unable to load organization members.";
}

function ButtonSpinner() {
  return <LoaderCircle size={16} className="animate-spin" aria-hidden />;
}

/** Loaded only for the selected employee, not all 500+ members at once. */
function MemberAssignments({
  organizationId,
  employeeId,
  employeeName,
  employeeIsAdmin,
  hotels,
}: {
  organizationId: string;
  employeeId: string;
  employeeName: string;
  employeeIsAdmin: boolean;
  hotels: Hotel[];
}) {
  const [saved, setSaved] = useState<number[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setSaved([]);
    setSelected([]);
    getStaffHotelAccess(employeeId)
      .then((data) => {
        if (!active) return;
        setSaved(data.hotel_ids);
        setSelected(data.hotel_ids);
      })
      .catch((err: unknown) => {
        if (active) setError(displayError(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [organizationId, employeeId]);

  const visibleHotels = useMemo(() => {
    const needle = search.toLowerCase().trim();
    return hotels.filter((hotel) => hotel.name.toLowerCase().includes(needle));
  }, [hotels, search]);

  const savedKey = [...saved].sort((a, b) => a - b).join(",");
  const selectedKey = [...selected].sort((a, b) => a - b).join(",");
  const dirty = savedKey !== selectedKey;

  function toggle(hotelId: number) {
    setSuccess("");
    setSelected((current) =>
      current.includes(hotelId)
        ? current.filter((id) => id !== hotelId)
        : [...current, hotelId],
    );
  }

  async function save() {
    if (employeeIsAdmin || loading || saving || !dirty) return;
    if (selected.length === 0 && saved.length > 0) {
      if (!window.confirm(`Remove access to all hotels for ${employeeName}?`))
        return;
    }

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      // ONE atomic backend request, rather than a POST per checkbox.
      const result = await saveStaffHotelAccess(employeeId, selected);
      setSaved(result.hotel_ids);
      setSelected(result.hotel_ids);
      setSuccess("Property access saved successfully.");
    } catch (err: unknown) {
      setError(displayError(err));
    } finally {
      setSaving(false);
    }
  }

  if (employeeIsAdmin) {
    return (
      <div className="rounded-2xl border border-teal-100 bg-teal-50 p-5 text-sm text-teal-900">
        <div className="mb-2 flex items-center gap-2 font-bold">
          <ShieldCheck size={18} /> Organization admin
        </div>
        <p>
          {employeeName} already has access to every hotel in this organization.
          Assignments are not required.
        </p>
      </div>
    );
  }

  return (
    <section className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Hotel permissions
          </p>
          <h3 className="text-base font-extrabold text-slate-900">
            {employeeName}
          </h3>
        </div>
        <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-teal-700">
          {selected.length} assigned
        </span>
      </div>

      {loading ? (
        <p className="flex items-center gap-2 py-5 text-sm text-slate-500">
          <ButtonSpinner /> Loading assignments…
        </p>
      ) : (
        <>
          <label className="relative block">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-3 text-slate-400"
            />
            <input
              aria-label="Search properties"
              placeholder="Search properties…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-teal-500"
            />
          </label>
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-slate-500">
              {visibleHotels.length} matching properties
            </span>
            <div className="flex gap-3">
              <button
                type="button"
                disabled={saving || visibleHotels.length === 0}
                className="font-semibold text-teal-700 disabled:opacity-40"
                onClick={() => {
                  setSuccess("");
                  setSelected((previous) =>
                    Array.from(
                      new Set([...previous, ...visibleHotels.map((h) => h.id)]),
                    ),
                  );
                }}
              >
                Select matching
              </button>
              <button
                type="button"
                disabled={saving || visibleHotels.length === 0}
                className="font-semibold text-slate-500 disabled:opacity-40"
                onClick={() => {
                  const visibleIds = new Set(visibleHotels.map((h) => h.id));
                  setSuccess("");
                  setSelected((previous) =>
                    previous.filter((id) => !visibleIds.has(id)),
                  );
                }}
              >
                Clear matching
              </button>
            </div>
          </div>

          <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
            {visibleHotels.map((hotel) => (
              <label
                key={hotel.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(hotel.id)}
                  disabled={saving}
                  onChange={() => toggle(hotel.id)}
                  className="h-4 w-4 accent-teal-700"
                />
                <Building2 size={16} className="shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700">
                  {hotel.name}
                </span>
                {saved.includes(hotel.id) && (
                  <Check
                    size={14}
                    className="text-teal-600"
                    aria-label="Previously saved"
                  />
                )}
              </label>
            ))}
            {visibleHotels.length === 0 && (
              <p className="p-4 text-center text-sm text-slate-500">
                No matching hotels.
              </p>
            )}
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
            >
              {error}
            </p>
          )}
          {success && (
            <p
              role="status"
              className="flex items-center gap-2 text-sm text-teal-700"
            >
              <CheckCircle2 size={16} /> {success}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
            <span className="text-xs text-slate-500">
              {dirty ? "Unsaved changes" : "All changes saved"}
            </span>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !dirty}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#246d77] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#1a5961] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? <ButtonSpinner /> : <Check size={16} />}
              {saving ? "Saving…" : "Save assignments"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export default function HotelAccessPanel() {
  const [memberQuery, setMemberQuery] = useState("");
  const { isLoaded, organization, membership, memberships } = useOrganization({
    memberships: {
      infinite: true,
      pageSize: 25,
      // Do not send `query: ""` to Clerk. Include it only when searching.
      ...(memberQuery.trim() ? { query: memberQuery.trim() } : {}),
    },
  });
  const organizationId = organization?.id ?? null;
  const isAdmin = isAdminRole(membership?.role);

  const [tab, setTab] = useState<Tab>("properties");
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [hotelsLoading, setHotelsLoading] = useState(true);
  const [hotelsError, setHotelsError] = useState("");
  const [hotelQuery, setHotelQuery] = useState("");
  const [newHotelName, setNewHotelName] = useState("");
  const [creationMode, setCreationMode] = useState<"single" | "bulk">("single");
  const [bulkHotelNames, setBulkHotelNames] = useState("");
  const [creating, setCreating] = useState(false);
  const [createMessage, setCreateMessage] = useState("");
  const [hotelToDelete, setHotelToDelete] = useState<Hotel | null>(null);
  const [deletingHotel, setDeletingHotel] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(
    null,
  );
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    // Organization changes invalidate any old member selection and hotel list.
    let active = true;
    setHotels([]);
    setHotelsError("");
    setCreateMessage("");
    setBulkHotelNames("");
    setNewHotelName("");
    setHotelToDelete(null);
    setDeleteMessage("");
    setHotelsLoading(Boolean(organizationId));

    if (organizationId) {
      listHotels()
        .then((items) => {
          if (active) setHotels(items);
        })
        .catch((err: unknown) => {
          if (active) setHotelsError(displayError(err));
        })
        .finally(() => {
          if (active) setHotelsLoading(false);
        });
    }
    return () => {
      active = false;
    };
  }, [organizationId, reloadKey]);

  useEffect(() => {
    setSelectedEmployeeId(null);
    setTab("properties");
  }, [organizationId]);

  const visibleHotels = hotels.filter((hotel) =>
    hotel.name.toLowerCase().includes(hotelQuery.trim().toLowerCase()),
  );

  const employees = (memberships?.data ?? [])
    .map((entry) => {
      const person = entry.publicUserData;
      const id = person?.userId;
      if (!id) return null;
      return {
        id,
        name:
          [person.firstName, person.lastName].filter(Boolean).join(" ") ||
          person.identifier ||
          "Unnamed employee",
        identifier: person.identifier ?? "",
        role: entry.role,
      };
    })
    .filter((member): member is NonNullable<typeof member> => member !== null);

  const chosenEmployee = employees.find(
    (employee) => employee.id === selectedEmployeeId,
  );

  async function submitHotel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newHotelName.trim();
    if (!name || creating) return;
    setCreating(true);
    setCreateMessage("");
    try {
      const hotel = await createHotel(name);
      setHotels((previous) =>
        [...previous, hotel].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setNewHotelName("");
      setCreateMessage(`${hotel.name} added successfully.`);
    } catch (err: unknown) {
      setCreateMessage(displayError(err));
    } finally {
      setCreating(false);
    }
  }

  // Each non-empty line is one hotel. Keep the order and send only actual names.
  const parsedBulkNames = bulkHotelNames
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);

  async function submitBulkHotels(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;

    if (parsedBulkNames.length === 0) {
      setCreateMessage("Enter at least one hotel name, one per line.");
      return;
    }
    if (parsedBulkNames.length > 500) {
      setCreateMessage("Add up to 500 hotels in one batch.");
      return;
    }
    if (parsedBulkNames.some((name) => name.length > 255)) {
      setCreateMessage("Hotel names must be 255 characters or fewer.");
      return;
    }
    if (
      new Set(parsedBulkNames.map((name) => name.toLocaleLowerCase())).size !==
      parsedBulkNames.length
    ) {
      setCreateMessage(
        "Remove repeated hotel names from the list before saving.",
      );
      return;
    }

    setCreating(true);
    setCreateMessage("");
    try {
      // One request; server checks the organization and saves all hotels atomically.
      const added = await createHotelsBulk(parsedBulkNames);
      setHotels((previous) =>
        [...previous, ...added].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setBulkHotelNames("");
      setCreateMessage(
        `${added.length} ${added.length === 1 ? "hotel" : "hotels"} created successfully.`,
      );
    } catch (error: unknown) {
      setCreateMessage(displayError(error));
    } finally {
      setCreating(false);
    }
  }

  async function removeHotel() {
    if (!isAdmin || !hotelToDelete || deletingHotel) return;
    setDeletingHotel(true);
    setDeleteMessage("");
    try {
      await deleteHotel(hotelToDelete.id);
      setHotels((previous) =>
        previous.filter((hotel) => hotel.id !== hotelToDelete.id),
      );
      setHotelToDelete(null);
      setDeleteMessage("Hotel removed successfully.");
    } catch (error: unknown) {
      // A 409 means the property already has enquiries and cannot be deleted safely.
      setDeleteMessage(displayError(error));
    } finally {
      setDeletingHotel(false);
    }
  }

  if (!isLoaded) {
    return (
      <div className="p-6 text-sm text-slate-500">Loading organization…</div>
    );
  }
  if (!organizationId) {
    return (
      <div className="p-6 text-sm text-slate-600">
        Select an organization to manage hotels.
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-5 bg-[#f8fafc] p-4 text-slate-900 sm:p-6">
      <header className="rounded-2xl border border-teal-100 bg-gradient-to-r from-[#e9f8f5] to-white p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-teal-700">
              Property management
            </p>
            <h2 className="mt-1 text-xl font-extrabold tracking-tight text-slate-900">
              Hotels & Access
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {organization?.name} · Manage hotels and staff permissions.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-teal-700 shadow-sm">
            <Building2 size={14} /> {hotels.length} hotels
          </span>
        </div>
      </header>

      <div
        role="tablist"
        aria-label="Hotel administration"
        className="flex gap-2 border-b border-slate-200 pb-2"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "properties"}
          onClick={() => setTab("properties")}
          className={`rounded-lg px-4 py-2 text-sm font-bold ${tab === "properties" ? "bg-[#246d77] text-white" : "text-slate-500 hover:bg-slate-100"}`}
        >
          Hotels
        </button>
        {isAdmin && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === "access"}
            onClick={() => setTab("access")}
            className={`rounded-lg px-4 py-2 text-sm font-bold ${tab === "access" ? "bg-[#246d77] text-white" : "text-slate-500 hover:bg-slate-100"}`}
          >
            <span className="inline-flex items-center gap-1.5">
              <Users size={15} /> Staff access
            </span>
          </button>
        )}
      </div>

      {tab === "properties" || !isAdmin ? (
        <div className="space-y-4">
          {isAdmin && (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">
                    Add properties
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Create one hotel, or paste several names at once.
                  </p>
                </div>
                <div
                  className="flex rounded-xl bg-slate-100 p-1"
                  role="group"
                  aria-label="Property creation mode"
                >
                  <button
                    type="button"
                    disabled={creating}
                    aria-pressed={creationMode === "single"}
                    onClick={() => {
                      setCreationMode("single");
                      setCreateMessage("");
                    }}
                    className={`rounded-lg px-3 py-2 text-xs font-bold ${creationMode === "single" ? "bg-white text-teal-800 shadow-sm" : "text-slate-500"}`}
                  >
                    One hotel
                  </button>
                  <button
                    type="button"
                    disabled={creating}
                    aria-pressed={creationMode === "bulk"}
                    onClick={() => {
                      setCreationMode("bulk");
                      setCreateMessage("");
                    }}
                    className={`rounded-lg px-3 py-2 text-xs font-bold ${creationMode === "bulk" ? "bg-white text-teal-800 shadow-sm" : "text-slate-500"}`}
                  >
                    Multiple hotels
                  </button>
                </div>
              </div>
              {creationMode === "single" ? (
                <form onSubmit={(event) => void submitHotel(event)}>
                  <label
                    htmlFor="create-hotel-name"
                    className="mb-2 block text-sm font-bold text-slate-800"
                  >
                    Hotel name
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      id="create-hotel-name"
                      type="text"
                      maxLength={255}
                      required
                      value={newHotelName}
                      onChange={(event) => setNewHotelName(event.target.value)}
                      placeholder="e.g. Hotel Batumi"
                      className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-teal-500"
                    />
                    <button
                      type="submit"
                      disabled={creating || !newHotelName.trim()}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#246d77] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#1a5961] disabled:opacity-40"
                    >
                      {creating ? <ButtonSpinner /> : <Plus size={16} />} Add
                      hotel
                    </button>
                  </div>
                </form>
              ) : (
                <form
                  onSubmit={(event) => void submitBulkHotels(event)}
                  className="space-y-3"
                >
                  <label
                    htmlFor="bulk-hotel-names"
                    className="block text-sm font-bold text-slate-800"
                  >
                    Hotel names{" "}
                    <span className="font-normal text-slate-500">
                      (one per line)
                    </span>
                  </label>
                  <textarea
                    id="bulk-hotel-names"
                    value={bulkHotelNames}
                    onChange={(event) => {
                      setBulkHotelNames(event.target.value);
                      setCreateMessage("");
                    }}
                    rows={6}
                    placeholder={"Hotel Tbilisi\nHotel Batumi\nHotel Kutaisi"}
                    className="w-full resize-y rounded-xl border border-slate-200 px-3 py-3 text-sm leading-6 outline-none focus:border-teal-500"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-slate-500">
                      {parsedBulkNames.length} hotel
                      {parsedBulkNames.length === 1 ? "" : "s"} entered · max
                      500 per batch
                    </span>
                    <button
                      type="submit"
                      disabled={
                        creating ||
                        parsedBulkNames.length === 0 ||
                        parsedBulkNames.length > 500
                      }
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#246d77] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#1a5961] disabled:opacity-40"
                    >
                      {creating ? <ButtonSpinner /> : <Plus size={16} />}
                      {creating
                        ? "Creating…"
                        : `Create ${parsedBulkNames.length} hotel${parsedBulkNames.length === 1 ? "" : "s"}`}
                    </button>
                  </div>
                  <p className="text-xs leading-5 text-slate-500">
                    Existing hotels stay unchanged. If a hotel name is invalid
                    or already exists, none of this batch is created.
                  </p>
                </form>
              )}
              {createMessage && (
                <p
                  role="status"
                  className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-700"
                >
                  {createMessage}
                </p>
              )}
            </section>
          )}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-extrabold text-slate-900">
                  {isAdmin ? "Your properties" : "Your assigned hotels"}
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {isAdmin
                    ? "All hotels in this organization"
                    : "Hotels you are authorized to access"}
                </p>
              </div>
              <button
                type="button"
                aria-label="Reload hotels"
                onClick={() => setReloadKey((previous) => previous + 1)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              >
                <RefreshCw size={17} />
              </button>
            </div>
            <label className="relative mb-3 block">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-3 text-slate-400"
              />
              <input
                aria-label="Search hotels"
                value={hotelQuery}
                onChange={(event) => setHotelQuery(event.target.value)}
                placeholder="Search your hotels…"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-teal-500"
              />
            </label>
            {hotelsLoading ? (
              <p className="flex items-center gap-2 py-3 text-sm text-slate-500">
                <ButtonSpinner /> Loading hotels…
              </p>
            ) : hotelsError ? (
              <p
                role="alert"
                className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
              >
                <AlertCircle size={14} className="mr-1 inline" />
                {hotelsError}
              </p>
            ) : visibleHotels.length === 0 ? (
              <p className="py-5 text-center text-sm text-slate-500">
                No hotels found.
              </p>
            ) : (
              <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-100">
                {visibleHotels.map((hotel) => (
                  <div
                    key={hotel.id}
                    className="flex items-center gap-3 px-3 py-3"
                  >
                    <span className="rounded-xl bg-teal-50 p-2 text-teal-700">
                      <Building2 size={17} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-800">
                      {hotel.name}
                    </span>
                    <span className="text-xs text-slate-400">#{hotel.id}</span>
                    {isAdmin && (
                      <button
                        type="button"
                        disabled={deletingHotel}
                        onClick={() => {
                          setDeleteMessage("");
                          setHotelToDelete(hotel);
                        }}
                        aria-label={`Delete ${hotel.name}`}
                        title={`Delete ${hotel.name}`}
                        className="rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {isAdmin && hotelToDelete && (
              <div
                role="alertdialog"
                aria-label={`Confirm deletion of ${hotelToDelete.name}`}
                className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4"
              >
                <p className="text-sm font-bold text-red-800">
                  Delete {hotelToDelete.name}?
                </p>
                <p className="mt-1 text-xs leading-5 text-red-700">
                  This removes the property and its staff assignments. Hotels
                  with existing enquiries cannot be deleted.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={deletingHotel}
                    onClick={() => {
                      setHotelToDelete(null);
                      setDeleteMessage("");
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={deletingHotel}
                    onClick={() => void removeHotel()}
                    className="inline-flex items-center gap-2 rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white hover:bg-red-800 disabled:opacity-50"
                  >
                    {deletingHotel ? <ButtonSpinner /> : <Trash2 size={14} />}
                    {deletingHotel ? "Deleting…" : "Delete hotel"}
                  </button>
                </div>
              </div>
            )}
            {isAdmin && deleteMessage && (
              <p
                role="status"
                className={`mt-3 rounded-lg p-3 text-xs ${hotelToDelete ? "bg-red-50 text-red-700" : "bg-teal-50 text-teal-800"}`}
              >
                {deleteMessage}
              </p>
            )}
          </section>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-600">
            Invite people in Clerk's <strong>Members</strong> tab first. Once
            they join, select an employee here to assign hotels.
          </div>
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <h3 className="text-sm font-extrabold text-slate-900">
              Select an employee
            </h3>
            <label className="relative block">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-3 text-slate-400"
              />
              <input
                aria-label="Search organization members"
                placeholder="Search members by name or email…"
                value={memberQuery}
                onChange={(event) => setMemberQuery(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-teal-500"
              />
            </label>
            {memberships?.isError && (
              <div
                role="alert"
                className="rounded-xl bg-red-50 p-3 text-sm text-red-700"
              >
                <p>{membershipErrorMessage(memberships.error)}</p>
                <button
                  type="button"
                  onClick={() => void memberships.revalidate()}
                  className="mt-2 font-semibold underline underline-offset-2"
                >
                  Retry loading members
                </button>
              </div>
            )}
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {employees.map((employee) => (
                <button
                  key={employee.id}
                  type="button"
                  onClick={() => setSelectedEmployeeId(employee.id)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ${selectedEmployeeId === employee.id ? "bg-teal-50 ring-1 ring-teal-200" : "hover:bg-slate-50"}`}
                >
                  <span className="rounded-full bg-slate-100 p-2 text-slate-500">
                    <UserRound size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900">
                      {employee.name}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {employee.identifier}
                    </span>
                  </span>
                  {isAdminRole(employee.role) && (
                    <span className="text-[10px] font-bold text-teal-700">
                      Admin
                    </span>
                  )}
                  <ChevronRight size={15} className="text-slate-400" />
                </button>
              ))}
              {memberships?.isLoading && (
                <p className="px-3 py-3 text-sm text-slate-500">
                  Loading members…
                </p>
              )}
              {!memberships?.isLoading && employees.length === 0 && (
                <p className="px-3 py-3 text-sm text-slate-500">
                  No matching members.
                </p>
              )}
            </div>
            {memberships?.hasNextPage && (
              <button
                type="button"
                disabled={memberships.isFetching}
                onClick={() => memberships.fetchNext()}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                {memberships.isFetching ? "Loading…" : "Load more members"}
              </button>
            )}
          </section>
          {chosenEmployee ? (
            <MemberAssignments
              key={`${organizationId}:${chosenEmployee.id}`}
              organizationId={organizationId}
              employeeId={chosenEmployee.id}
              employeeName={chosenEmployee.name}
              employeeIsAdmin={isAdminRole(chosenEmployee.role)}
              hotels={hotels}
            />
          ) : selectedEmployeeId ? (
            <p className="text-xs text-slate-500">
              Employee is outside the current search. Clear the search to edit
              their assignments.
            </p>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-9 text-center">
              <Users size={24} className="mx-auto mb-2 text-slate-300" />
              <p className="text-sm font-semibold text-slate-700">
                Choose a member to manage their hotel access.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
