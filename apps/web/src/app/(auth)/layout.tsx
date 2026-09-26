import React from "react";
import Link from "next/link";
import { LogoMark } from "@/components/ui/LogoMark";
import { AppMockup } from "@/components/auth/AppMockup";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="sb-root flex h-screen w-full overflow-hidden bg-[hsl(240,10%,4%)]">
      {/* ── Left — App preview ── */}
      <div className="hidden lg:flex w-[54%] relative flex-col justify-between p-12 overflow-hidden border-r border-white/[0.05]">
        {/* Subtle gradient bg */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 30% 40%, rgba(99,102,241,0.07) 0%, transparent 70%)",
          }}
        />

        {/* Logo */}
        <Link
          href="/"
          className="relative z-10 flex items-center gap-2.5 text-white font-semibold text-lg tracking-tight hover:opacity-80 transition-opacity"
        >
          <LogoMark size={28} />
          Knowdex
        </Link>

        {/* App mockup */}
        <div
          className="relative z-10 w-full"
          style={{
            transform: "perspective(1200px) rotateX(2deg) rotateY(-2deg)",
            transformOrigin: "center center",
          }}
        >
          <AppMockup />
        </div>

        {/* What it does (real capabilities, no invented numbers) */}
        <div className="relative z-10">
          <p className="text-base font-medium leading-snug text-white">
            Notes that connect themselves.
          </p>
          <p className="mt-1.5 max-w-md text-sm leading-relaxed text-zinc-500">
            Write together in real time, see how ideas relate in a live graph,
            and ask questions that are answered from your own notes.
          </p>
          <ul className="mt-5 flex flex-wrap gap-2">
            {[
              "Live knowledge graph",
              "Ask with citations",
              "Databases & boards",
              "Works offline",
              "Import Notion & Obsidian",
            ].map((f) => (
              <li
                key={f}
                className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-400"
              >
                {f}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* ── Right — Form ── */}
      <div className="w-full lg:w-[46%] flex flex-col items-center justify-center px-10 py-8 relative overflow-hidden">
        {/* Mobile Logo */}
        <Link
          href="/"
          className="lg:hidden absolute top-10 flex items-center gap-2 text-white font-semibold text-lg tracking-tight hover:opacity-80 transition-opacity z-20"
        >
          <LogoMark size={26} />
          Knowdex
        </Link>

        <div className="w-full max-w-sm relative z-10 mt-12 lg:mt-0">
          {children}
        </div>
      </div>
    </div>
  );
}
