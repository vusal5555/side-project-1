"use client";

import { useOrganization } from "@clerk/nextjs";
import { Building2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { listHotels, type Hotel } from "@/lib/hotel-api";

type HotelPickerProps = {
  value: number | null;
  onChange: (hotelId: number | null) => void;
  disabled?: boolean;
};

// For the existing New Enquiry form. No org_id or user_id is sent by the browser.
// FastAPI decides which hotels are allowed and validates the chosen hotel_id.
export default function HotelPicker({ value, onChange, disabled = false }: HotelPickerProps) {
  const { organization } = useOrganization();
  const orgId = organization?.id ?? null;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    onChangeRef.current(null); // Do not carry a hotel selection across organizations.
    setHotels([]);
    setError("");
    setLoading(Boolean(orgId));

    if (orgId) {
      // listHotels uses the gateway and returns only authorized hotels.
      listHotels()
        .then((result) => {
          if (controller.signal.aborted) return;
          setHotels(result);
          // When an employee has one hotel, select it automatically.
          if (result.length === 1) onChangeRef.current(result[0].id);
        })
        .catch((err: unknown) => {
          if (!controller.signal.aborted) {
            setError(err instanceof Error ? err.message : "Unable to load hotels");
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }

    return () => controller.abort();
  }, [orgId]);

  return (
    <label className="block space-y-2 text-sm font-semibold text-slate-700">
      <span className="flex items-center gap-2">
        <Building2 size={16} className="text-teal-700" /> Hotel property
      </span>
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
        disabled={disabled || loading || !orgId || hotels.length === 0}
        required
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-normal text-slate-900 outline-none focus:border-teal-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value="">
          {!orgId
            ? "Select an organization first"
            : loading
              ? "Loading hotels…"
              : hotels.length === 0
                ? "No hotels assigned"
                : "Select a hotel…"}
        </option>
        {hotels.map((hotel) => (
          <option key={hotel.id} value={hotel.id}>
            {hotel.name}
          </option>
        ))}
      </select>
      {error && <span role="alert" className="block text-xs font-normal text-red-600">{error}</span>}
    </label>
  );
}
