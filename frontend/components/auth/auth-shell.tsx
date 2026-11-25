import Link from "next/link";
import { CheckCircle2, Hotel, ShieldCheck, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

export default function AuthShell({
  children,
  heading,
  description,
}: {
  children: ReactNode;
  heading: string;
  description: string;
}) {
  return (
    <div className="grid min-h-screen bg-[#f5f7fb] text-slate-900 lg:grid-cols-2">
      <aside className="relative hidden min-h-screen flex-col justify-between overflow-hidden bg-[#121d35] px-10 py-10 text-white lg:flex xl:px-16 xl:py-14">
        <div className="pointer-events-none absolute -left-28 top-1/4 h-72 w-72 rounded-full bg-[#226b76]/20 blur-3xl" />
        <div className="pointer-events-none absolute -right-20 bottom-16 h-80 w-80 rounded-full bg-[#2a9f96]/15 blur-3xl" />

        <Link
          href="/"
          className="relative inline-flex w-fit items-center gap-3"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#78e4d2] to-[#36abca] text-slate-900">
            <Hotel size={24} strokeWidth={2.2} />
          </span>
          <span>
            <span className="block text-lg font-extrabold tracking-tight">
              Hotel AI
            </span>
            <span className="block text-[10px] font-bold uppercase tracking-[0.20em] text-slate-400">
              Reservations
            </span>
          </span>
        </Link>

        <div className="relative max-w-xl py-14">
          <span className="inline-flex items-center gap-2 rounded-full border border-cyan-200/15 bg-white/[0.06] px-4 py-2 text-xs font-semibold text-cyan-100">
            <Sparkles size={14} /> Built for hotel teams
          </span>

          <h1 className="mt-6 max-w-lg text-4xl font-extrabold leading-[1.16] tracking-tight xl:text-5xl">
            More time for guests. Less time processing emails.
          </h1>

          <p className="mt-5 max-w-md text-base leading-8 text-slate-300">
            Review enquiries and approve AI-extracted reservation details in one
            organized workspace.
          </p>

          <div className="mt-11 rounded-[22px] border border-white/10 bg-white/[0.075] p-6 shadow-xl backdrop-blur-sm">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center gap-2 text-sm font-bold">
                <Hotel size={16} className="text-[#78e4d2]" />
                Reservation inbox
              </div>
              <span className="rounded-full bg-cyan-300/10 px-2.5 py-1 text-[11px] font-bold text-cyan-200">
                AI-assisted
              </span>
            </div>

            <div className="space-y-4 pt-5">
              <div className="flex items-start gap-3 rounded-xl bg-white/[0.055] p-4">
                <CheckCircle2 size={20} className="shrink-0 text-cyan-200" />
                <div>
                  <div className="text-sm font-semibold">
                    Reservation details extracted
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    Dates, rooms, guests — ready for review
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-xl bg-white/[0.055] p-4">
                <ShieldCheck size={20} className="shrink-0 text-emerald-200" />
                <div>
                  <div className="text-sm font-semibold">
                    Your team stays in control
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    Correct and approve before taking action
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <p className="relative text-xs text-slate-400">
          Hotel AI · Human-reviewed reservations
        </p>
      </aside>

      <main className="flex min-h-screen flex-col">
        <div className="flex items-center justify-between px-6 py-7 sm:px-10 lg:justify-end">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-extrabold text-slate-800 lg:hidden"
          >
            <Hotel size={22} className="text-[#246d77]" />
            Hotel AI
          </Link>

          <span className="text-xs font-semibold text-slate-400">
            Secure staff access
          </span>
        </div>

        <div className="flex flex-1 items-center justify-center px-4 pb-14 sm:px-8">
          <div className="w-full max-w-[440px]">
            <div className="mb-7 px-1 text-center lg:text-left">
              <h2 className="text-3xl font-extrabold tracking-tight text-[#17233b]">
                {heading}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                {description}
              </p>
            </div>

            <div className="flex justify-center lg:justify-start">
              {children}
            </div>

            <p className="mt-7 text-center text-xs leading-5 text-slate-400">
              Authorized hotel staff only. Keep guest information confidential.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
