"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Company = { ticker: string; companyName: string };

function matches(c: Company, q: string): boolean {
  return c.ticker.toLowerCase().includes(q) || c.companyName.toLowerCase().includes(q);
}

/** Lower rank = better match — exact ticker first, then ticker-prefix, then name-prefix, then any substring hit. */
function rank(c: Company, q: string): number {
  const ticker = c.ticker.toLowerCase();
  const name = c.companyName.toLowerCase();
  if (ticker === q) return 0;
  if (ticker.startsWith(q)) return 1;
  if (name.startsWith(q)) return 2;
  return 3;
}

const RESULT_LIMIT = 8;

/** Company/ticker search box, fetches the full ticker→name list once on mount (small enough to
 * filter client-side, see /api/companies) and navigates to /company/[ticker] on selection. */
export default function CompanySearch() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/companies")
      .then((res) => res.json())
      .then((body) => setCompanies(body.companies ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const q = query.trim().toLowerCase();
  const results =
    q.length === 0
      ? []
      : companies
          .filter((c) => matches(c, q))
          .sort((a, b) => rank(a, q) - rank(b, q))
          .slice(0, RESULT_LIMIT);

  function select(ticker: string) {
    setQuery("");
    setOpen(false);
    router.push(`/company/${ticker}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(results[activeIndex].ticker);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onFocus={() => query && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Ticker oder Unternehmen…"
        aria-label="Unternehmen suchen"
        className="w-40 rounded-md border border-border bg-bg-panel-2 px-2.5 py-2 font-mono text-[12.5px] text-text outline-none placeholder:text-text-faint focus:border-accent sm:w-56"
      />

      {open && results.length > 0 && (
        <div className="absolute right-0 top-full z-40 mt-1 max-h-72 w-72 overflow-y-auto rounded-md border border-border bg-bg-panel-2 shadow-lg">
          {results.map((c, i) => (
            <button
              key={c.ticker}
              type="button"
              onClick={() => select(c.ticker)}
              onMouseEnter={() => setActiveIndex(i)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-[12px] ${
                i === activeIndex ? "bg-bg-hover" : ""
              }`}
            >
              <span className="text-accent">{c.ticker}</span>
              <span className="truncate text-text-dim">{c.companyName}</span>
            </button>
          ))}
        </div>
      )}

      {open && q.length > 0 && results.length === 0 && (
        <div className="absolute right-0 top-full z-40 mt-1 w-72 rounded-md border border-border bg-bg-panel-2 px-3 py-2 font-mono text-[12px] text-text-faint shadow-lg">
          Kein Treffer.
        </div>
      )}
    </div>
  );
}
