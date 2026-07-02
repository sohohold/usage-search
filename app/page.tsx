'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import SearchBox from '@/components/SearchBox';
import ResultList from '@/components/ResultList';
import { MIN_QUERY_LENGTH, PAGE_SIZE, type SearchResponse, type Stats } from '@/types';

const DEBOUNCE_MS = 400;

export default function Home() {
  const [query, setQuery] = useState('');
  const [data, setData] = useState<SearchResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch('/api/stats')
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  const fetchResults = useCallback(async (q: string, offset = 0, append = false) => {
    if (q.length < MIN_QUERY_LENGTH) return;

    // Cancel any in-flight request so a slow earlier query can't overwrite newer results.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    (append ? setIsLoadingMore : setIsLoading)(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(q)}&limit=${PAGE_SIZE}&offset=${offset}`,
        { signal: controller.signal }
      );
      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? '検索エラー');
        return;
      }

      setData((prev) =>
        append && prev ? { ...json, results: [...prev.results, ...json.results] } : json
      );
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError('サーバーに接続できませんでした');
      }
    } finally {
      // Only the still-current request may clear loading state; an aborted one
      // would otherwise hide the spinner of the request that superseded it.
      if (abortRef.current === controller) {
        abortRef.current = null;
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const q = query.trim();
    if (q.length < MIN_QUERY_LENGTH) {
      abortRef.current?.abort();
      setData(null);
      setError(null);
      return;
    }
    debounceTimer.current = setTimeout(() => fetchResults(q), DEBOUNCE_MS);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [query, fetchResults]);

  const handleSubmit = () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    fetchResults(query.trim());
  };

  const handleLoadMore = () => {
    // While a new search is in flight, data still holds the previous query's
    // results; paging it would abort the new request and append stale rows.
    if (!data || isLoading) return;
    fetchResults(data.query, data.results.length, true);
  };

  return (
    <div className="min-h-screen">
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

        {data && (
          <div className={`transition-opacity ${isLoading ? 'opacity-50' : ''}`}>
            <ResultList
              data={data}
              onLoadMore={handleLoadMore}
              isLoadingMore={isLoadingMore || isLoading}
            />
          </div>
        )}
      </main>
    </div>
  );
}
