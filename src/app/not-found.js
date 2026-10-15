"use client";
import Link from "next/link";
import { useApp } from "@/lib/store";
import { tx } from "@/lib/i18n";

// Global 404 — unknown routes, plus role-gated pages (e.g. /org for
// ministry) that call notFound() render here instead of redirecting.
export default function NotFound() {
  const { lang = "en" } = useApp() || {};
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center px-3 py-6 text-center">
      <div className="text-6xl font-black text-slate-200">404</div>
      <h1 className="mt-2 text-xl font-black text-slate-800">
        {tx("पृष्ठ भेटिएन", "Page not found", lang)}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        {tx(
          "यो ठेगाना अवस्थित छैन वा तपाईंको भूमिकालाई पहुँच छैन।",
          "This address does not exist or your role has no access to it.",
          lang
        )}
      </p>
      <Link
        href="/"
        className="mt-4 rounded-lg bg-nepal-blue px-4 py-2 text-sm font-bold text-white"
      >
        ← {tx("ड्यासबोर्ड", "Dashboard", lang)}
      </Link>
    </div>
  );
}
