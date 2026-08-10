"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Company = { ticker: string; companyName: string };

function matches(c: Company, q: string): boolean {
  return c.ticker.toLowerCase().includes(q) || c.companyName.toLowerCase().includes(q);
}

/** Lower rank = better match — same ranking as CompanySearch. */
function rank(c: Company, q: string): number {
  const ticker = c.ticker.toLowerCase();
  const name = c.companyName.toLowerCase();
  if (ticker === q) return 0;
  if (ticker.startsWith(q)) return 1;
  if (name.startsWith(q)) return 2;
  return 3;
}

const RESULT_LIMIT = 8;

function TickerField({
  label,
  value,
  onChange,
  companies,
}: {
  label: string;
  value: string;
  onChange: (ticker: string) => void;
  companies: Company[];
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keeps the visible text in sync when the parent swaps A/B or a URL param seeds an initial value.
  useEffect(() => setQuery(value), [value]);

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
    setQuery(ticker);
    setOpen(false);
    onChange(ticker);
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
      if (results[activeIndex]) select(results[activeIndex].ticker);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative min-w-[160px] flex-1">
      <label className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-text-faint">{label}</label>
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value.trim().toUpperCase());
          setOpen(true);
          setActiveIndex(0);
        }}
        onFocus={() => query && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Ticker oder Unternehmen…"
        aria-label={label}
        className="w-full rounded-md border border-border bg-bg-panel-2 px-2.5 py-2 font-mono text-[12.5px] text-text outline-none placeholder:text-text-faint focus:border-accent"
      />

      {open && results.length > 0 && (
        <div className="absolute left-0 top-full z-40 mt-1 max-h-72 w-full min-w-[240px] overflow-y-auto rounded-md border border-border bg-bg-panel-2 shadow-lg">
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
    </div>
  );
}

/**
 * Two-ticker picker for the /compare feature. Duplicates CompanySearch's autocomplete matching/
 * ranking rather than reusing it directly — CompanySearch is wired to a single field that
 * navigates immediately on selection, whereas this needs two independent fields plus a manual
 * submit once both are filled. Navigates to /compare/[a]/[b] on submit.
 */
export default function ComparePicker({
  initialTickerA,
  initialTickerB,
}: {
  initialTickerA?: string;
  initialTickerB?: string;
}) {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [tickerA, setTickerA] = useState(initialTickerA ?? "");
  const [tickerB, setTickerB] = useState(initialTickerB ?? "");

  useEffect(() => {
    fetch("/api/companies")
      .then((res) => res.json())
      .then((body) => setCompanies(body.companies ?? []))
      .catch(() => {});
  }, []);

  const canCompare =
    tickerA.trim().length > 0 && tickerB.trim().length > 0 && tickerA.trim() !== tickerB.trim();

  function submit() {
    if (!canCompare) return;
    router.push(`/compare/${tickerA.trim()}/${tickerB.trim()}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <TickerField label="Ticker A" value={tickerA} onChange={setTickerA} companies={companies} />
      <button
        type="button"
        onClick={() => {
          setTickerA(tickerB);
          setTickerB(tickerA);
        }}
        title="Tauschen"
        aria-label="Ticker tauschen"
        className="rounded-md border border-border px-2.5 py-2 font-mono text-[13px] text-text-dim hover:border-accent hover:text-text"
      >
        ⇄
      </button>
      <TickerField label="Ticker B" value={tickerB} onChange={setTickerB} companies={companies} />
      <button
        type="button"
        onClick={submit}
        disabled={!canCompare}
        className="rounded-md bg-accent px-3.5 py-2 font-mono text-[12.5px] font-medium text-[#14100a] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Vergleichen
      </button>
    </div>
  );
}
