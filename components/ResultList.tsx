import type { SearchResponse } from '@/types';
import ResultCard from './ResultCard';

interface Props {
  data: SearchResponse;
  onLoadMore: () => void;
  isLoadingMore: boolean;
  shownCount: number;
}

export default function ResultList({ data, onLoadMore, isLoadingMore, shownCount }: Props) {
  const { query, over_limit, results } = data;

  const countLabel = over_limit
    ? `${results.length}件以上`
    : `${results.length}件`;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-stone-500">
          <span className="font-medium text-stone-700">「{query}」</span> の用例 —{' '}
          <span className="font-semibold text-amber-600">{countLabel}</span>
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {results.map((r, i) => (
          <ResultCard key={`${r.title}-${i}`} result={r} index={i} />
        ))}
      </div>

      {over_limit && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="rounded-xl border-2 border-stone-200 bg-white px-8 py-3 font-medium
                       text-stone-600 shadow-sm transition hover:border-amber-300
                       hover:text-amber-700 disabled:opacity-40"
          >
            {isLoadingMore ? '読み込み中…' : 'もっと見る'}
          </button>
        </div>
      )}

      {results.length === 0 && (
        <div className="rounded-xl border border-stone-200 bg-white p-10 text-center text-stone-400">
          用例が見つかりませんでした
        </div>
      )}
    </div>
  );
}
