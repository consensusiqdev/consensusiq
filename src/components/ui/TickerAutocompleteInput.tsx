"use client";

import { useEffect, useRef, useState } from "react";

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

/**
 * Same suggestion dropdown as CompanySearch (fetches /api/companies once, ranks client-side), but
 * calls `onSelect` instead of navigating — for a form that adds the picked ticker rather than
 * jumping to its page. The caller still owns `value`/`onChange` and its own <form onSubmit>, so
 * submitting free text that matches nothing (e.g. a ticker not yet in /api/companies) keeps working
 * exactly as before — this only ever adds a dropdown on top, it never blocks typing.
 */
export default function TickerAutocompleteInput({
  value,
  onChange,
  onSelect,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onSelect: (ticker: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [companies, setCompanies] = useState<Company[]>([]);
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

  const q = value.trim().toLowerCase();
  const results =
    q.length === 0
      ? []
      : companies
          .filter((c) => matches(c, q))
          .sort((a, b) => rank(a, q) - rank(b, q))
          .slice(0, RESULT_LIMIT);

  function select(ticker: string) {
    setOpen(false);
    onSelect(ticker);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // No open dropdown (or nothing in it, e.g. an untracked ticker) — let the keystroke fall
    // through to the surrounding <form>'s own onSubmit instead of intercepting it.
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
    <div ref={containerRef} className="relative flex-1">
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onFocus={() => value && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label="Ticker oder Unternehmen"
        className={className}
      />

      {open && results.length > 0 && (
        <div className="absolute left-0 top-full z-40 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-bg-panel-2 shadow-lg">
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
