"use client";

import { UserButton } from "@clerk/nextjs";
import { Building2, MailCheck } from "lucide-react";

/** Show this instead of fetching enquiries when Clerk has no active organization. */
export default function AwaitingOrganization() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f7fb] px-5 py-12 text-slate-900">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
            <Building2 size={24} />
          </span>
          <UserButton />
        </div>
        <h1 className="mt-6 text-2xl font-extrabold">Join your hotel group</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          You're signed in, but your account isn't connected to a hotel organization yet.
          Ask your organization's administrator to invite your email address from the
          Members tab, then open the invitation email to accept.
        </p>
        <div className="mt-5 flex items-start gap-3 rounded-xl bg-teal-50 p-4 text-sm text-teal-800">
          <MailCheck size={20} className="mt-0.5 shrink-0" />
          <p>You don't need to create your own organization to join a hotel's team.</p>
        </div>
        <p className="mt-5 text-xs leading-5 text-slate-500">
          Already accepted an invite? Refresh this page after choosing the organization.
        </p>
      </section>
    </main>
  );
}
