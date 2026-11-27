// The browser calls Next.js /backend/*, never FastAPI directly.
// Your authenticated Next.js route forwards the Clerk session token.

export type Hotel = { id: number; name: string };
export type StaffHotelAccess = { clerk_user_id: string; hotel_ids: number[] };

export class HotelApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "HotelApiError";
  }
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    cache: "no-store",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  // Read as text first: a failed server response is not always valid JSON.
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // We'll use the raw text for an error message instead.
    }
  }

  if (!response.ok) {
    const detail =
      data && typeof data === "object" && "detail" in data
        ? (data as { detail: unknown }).detail
        : null;
    const message =
      typeof detail === "string"
        ? detail
        : text || `Request failed (${response.status})`;
    throw new HotelApiError(message, response.status);
  }

  return data as T;
}

export function listHotels(): Promise<Hotel[]> {
  return apiRequest<Hotel[]>("/backend/hotels");
}

export function createHotel(name: string): Promise<Hotel> {
  return apiRequest<Hotel>("/backend/hotels", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

/** Create 1-500 hotels in one atomic database transaction. */
export function createHotelsBulk(names: string[]): Promise<Hotel[]> {
  return apiRequest<Hotel[]>("/backend/hotels/bulk", {
    method: "POST",
    body: JSON.stringify({ names }),
  });
}

export function getStaffHotelAccess(userId: string): Promise<StaffHotelAccess> {
  return apiRequest<StaffHotelAccess>(
    `/backend/hotel-access?clerk_user_id=${encodeURIComponent(userId)}`,
  );
}

export function saveStaffHotelAccess(
  userId: string,
  hotelIds: number[],
): Promise<StaffHotelAccess> {
  return apiRequest<StaffHotelAccess>(
    `/backend/staff/${encodeURIComponent(userId)}/hotels`,
    { method: "PUT", body: JSON.stringify({ hotel_ids: hotelIds }) },
  );
}

/** Delete an empty hotel belonging to the active organization (admin only). */
export function deleteHotel(hotelId: number): Promise<void> {
  return apiRequest<void>(`/backend/hotels/${hotelId}`, { method: "DELETE" });
}
