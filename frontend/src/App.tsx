import { useState, useEffect, useCallback, useRef } from 'react';
import SearchBox from './components/SearchBox.tsx';
import ResultList from './components/ResultList.tsx';
import type { SearchResponse, Stats } from './types.ts';

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 400;
const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

export default function App() {
  const [query, setQuery] = useState('');
  const [committedQuery, setCommittedQuery] = useState('');
  const [data, setData] = useState<SearchResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [shownCount, setShownCount] = useState(PAGE_SIZE);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch stats on mount
  useEffect(() => {
    fetch(`${API_BASE}/stats`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  const fetchResults = useCallback(async (q: string, offset = 0, append = false) => {
    if (q.trim().length < 2) return;
    const loading = append ? setIsLoadingMore : setIsLoading;
    loading(true);
    setError(null);

    try {
      const res = await fetch(
        `${API_BASE}/search?q=${encodeURIComponent(q)}&limit=${PAGE_SIZE}&offset=${offset}`
      );
      const json: SearchResponse = await res.json();

      if (!res.ok) {
        setError((json as any).error ?? '検索エラー');
        return;
      }

      if (append && data) {
        setData({ ...json, results: [...data.results, ...json.results] });
      } else {
        setData(json);
        setShownCount(json.results.length);
      }
    } catch {
      setError('サーバーに接続できませんでした');
    } finally {
      loading(false);
    }
  }, [data]);

  // Auto-search with debounce
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (query.trim().length < 2) {
      setData(null);
      setError(null);
      return;
    }
    debounceTimer.current = setTimeout(() => {
      setCommittedQuery(query.trim());
      fetchResults(query.trim());
    }, DEBOUNCE_MS);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const q = query.trim();
    if (q.length < 2) return;
    setCommittedQuery(q);
    fetchResults(q);
  };

  const handleLoadMore = () => {
    const offset = data?.results.length ?? 0;
    setShownCount((n) => n + PAGE_SIZE);
    fetchResults(committedQuery, offset, true);
  };

  return (
    <div className="min-h-screen">
      {/* Sticky header */}
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/90 backdrop-blur-md">
        <div className="mx-auto max-w-3xl px-4 py-4">
          <div className="mb-3 flex items-baseline gap-3">
            <h1 className="font-serif text-2xl font-bold text-stone-800">青空用例検索</h1>
            {stats && (
              <span className="text-xs text-stone-400">
                {stats.works.toLocaleString()} 作品 /{' '}
                {stats.chunks.toLocaleString()} 段落インデックス済み
              </span>
            )}
          </div>
          <SearchBox
            value={query}
            onChange={setQuery}
            onSubmit={handleSubmit}
            isLoading={isLoading}
          />
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-3xl px-4 py-6">
        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {!data && !isLoading && (
          <div className="mt-20 text-center">
            <p className="font-serif text-3xl text-stone-300">青空文庫全文用例検索</p>
            <p className="mt-3 text-sm text-stone-400">
              青空文庫に収録された作品から、言葉の使われ方・用例を検索できます
            </p>
            {stats && (
              <p className="mt-2 text-xs text-stone-300">
                {stats.works.toLocaleString()} 作品 · {stats.chunks.toLocaleString()} 段落
              </p>
            )}
          </div>
        )}

        {data && !isLoading && (
          <ResultList
            data={data}
            onLoadMore={handleLoadMore}
            isLoadingMore={isLoadingMore}
            shownCount={shownCount}
          />
        )}
      </main>
    </div>
  );
}
