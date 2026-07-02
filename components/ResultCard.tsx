'use client';

import { useState } from 'react';
import type { SearchResult } from '@/types';

interface Props {
  result: SearchResult;
}

export default function ResultCard({ result }: Props) {
  const [expanded, setExpanded] = useState(false);

  const handleToggle = (e: React.MouseEvent) => {
    // Don't hijack link clicks or text selection inside the card.
    if ((e.target as HTMLElement).closest('a')) return;
    if (window.getSelection()?.toString()) return;
    setExpanded((v) => !v);
  };

  return (
    <article
      onClick={handleToggle}
      className="group cursor-pointer rounded-xl border border-stone-200 bg-white p-5 shadow-sm
                 transition hover:border-amber-300 hover:shadow-md"
    >
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <a
            href={result.card_url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-serif text-base font-semibold text-stone-800 hover:text-amber-700
                       hover:underline truncate block"
            title={result.title}
          >
            {result.title}
          </a>
          <span className="text-sm text-stone-500">{result.author}</span>
        </div>
        <a
          href={result.card_url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-md border border-stone-200 px-2 py-1 text-xs text-stone-400
                     transition hover:border-amber-300 hover:text-amber-600"
        >
          図書カード →
        </a>
      </div>

      <p
        className="font-serif text-[15px] leading-relaxed text-stone-700"
        // Fall back to the short snippet for responses cached before `context` existed.
        dangerouslySetInnerHTML={{ __html: (expanded && result.context) || result.snippet }}
      />

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((v) => !v);
        }}
        aria-expanded={expanded}
        className="mt-3 text-xs text-stone-400 transition group-hover:text-amber-600"
      >
        {expanded ? '− 文脈を閉じる' : '＋ 前後の文脈を表示'}
      </button>
    </article>
  );
}
