import { Suspense } from "react";
import { auth } from "@clerk/nextjs/server";
import EnquiriesDashboard, {
  type EnquirySummary,
} from "@/components/enquiries-dashboard";

const API_URL = process.env.FASTAPI_URL ?? "http://127.0.0.1:8000";

async function ProtectedDashboard() {
  const { getToken } = await auth.protect();
  const token = await getToken();

  const response = await fetch(`${API_URL}/api/v1/enquiries`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Couldn't load enquiries (${response.status})`);
  }

  const enquiries: EnquirySummary[] = await response.json();

  return <EnquiriesDashboard enquiries={enquiries} />;
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#f5f7fb] text-sm font-medium text-slate-500">
          Loading reservation workspace...
        </div>
      }
    >
      <ProtectedDashboard />
    </Suspense>
  );
}
