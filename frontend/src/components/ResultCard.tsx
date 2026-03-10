import type { SearchResult } from '../types.ts';

interface Props {
  result: SearchResult;
  index: number;
}

export default function ResultCard({ result, index }: Props) {
  return (
    <article
      className="group rounded-xl border border-stone-200 bg-white p-5 shadow-sm
                 transition hover:border-amber-300 hover:shadow-md"
      style={{ animationDelay: `${index * 30}ms` }}
    >
      {/* Header */}
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

      {/* KWIC snippet */}
      <p
        className="font-serif text-[15px] leading-relaxed text-stone-700"
        dangerouslySetInnerHTML={{ __html: result.snippet }}
      />
    </article>
  );
}
