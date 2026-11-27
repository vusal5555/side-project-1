import { Suspense } from "react";
import { auth } from "@clerk/nextjs/server";
import { OrganizationSwitcher } from "@clerk/nextjs";
import { redirect } from "next/navigation";

import EnquiriesDashboard, {
  type EnquirySummary,
} from "@/components/enquiries-dashboard";

const API_URL = process.env.FASTAPI_URL ?? "http://127.0.0.1:8000";

async function DashboardContent() {
  const { userId, orgId, getToken } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  // Personal account: no hotel organization selected.
  if (!orgId) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <section className="w-full max-w-md rounded-xl bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-[#17233b]">
            Welcome to Hotel AI
          </h1>

          <p className="my-5 text-sm text-slate-600">
            Create a hotel organization or select an organization you've already
            joined.
          </p>

          <OrganizationSwitcher
            afterCreateOrganizationUrl="/"
            afterSelectOrganizationUrl="/"
          />
        </section>
      </main>
    );
  }

  // Only fetch organization enquiries when an org is active.
  const token = await getToken();

  const response = await fetch(`${API_URL}/api/v1/enquiries`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Couldn't load enquiries (${response.status})`);
  }

  const enquiries: EnquirySummary[] = await response.json();

  return <EnquiriesDashboard enquiries={enquiries} />;
}

export default function Home() {
  return (
    <Suspense fallback={<p>Loading workspace...</p>}>
      <DashboardContent />
    </Suspense>
  );
}
