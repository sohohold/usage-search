'use client';

import { useState } from 'react';
import type { SearchResult } from '@/types';

interface Props {
  result: SearchResult;
}

export default function ResultCard({ result }: Props) {
  const [expanded, setExpanded] = useState(false);

  // Nothing to expand into when the chunk is short enough that the wider excerpt
  // repeats the snippet, or when the response was cached before `context` existed.
  const hasContext = Boolean(result.context) && result.context !== result.snippet;

  const handleToggle = (e: React.MouseEvent) => {
    if (!hasContext) return;
    // Don't hijack link clicks or text selection inside the card.
    if ((e.target as HTMLElement).closest('a')) return;
    if (window.getSelection()?.toString()) return;
    setExpanded((v) => !v);
  };

  return (
    <article
      onClick={handleToggle}
      className={`group rounded-xl border border-stone-200 bg-white p-5 shadow-sm
                  transition hover:border-amber-300 hover:shadow-md
                  ${hasContext ? 'cursor-pointer' : 'cursor-default'}`}
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
          {result.author_url ? (
            <a
              href={result.author_url}
              target="_blank"
              rel="noopener noreferrer"
              className="cursor-pointer text-sm text-stone-500 transition hover:text-amber-700
                         hover:underline"
              title={`${result.author}の作家別作品リスト`}
            >
              {result.author}
            </a>
          ) : (
            <span className="text-sm text-stone-500">{result.author}</span>
          )}
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

      {hasContext && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          aria-expanded={expanded}
          className="mt-3 cursor-pointer text-xs text-stone-400 transition group-hover:text-amber-600"
        >
          {expanded ? '− 文脈を閉じる' : '＋ 前後の文脈を表示'}
        </button>
      )}
    </article>
  );
}
