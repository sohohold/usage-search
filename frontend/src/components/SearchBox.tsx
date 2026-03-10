import React, { useEffect, useRef } from 'react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

export default function SearchBox({ value, onChange, onSubmit, isLoading }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onSubmit();
  };

  return (
    <div className="relative flex items-center gap-2">
      <div className="relative flex-1">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="検索するワードを入力（例：月が綺麗、桜散る）"
          className="w-full rounded-xl border-2 border-stone-200 bg-white px-5 py-3.5
                     text-lg shadow-sm transition focus:border-amber-400 focus:outline-none
                     focus:ring-4 focus:ring-amber-100 placeholder:text-stone-300"
        />
        {isLoading && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-amber-500" />
          </div>
        )}
      </div>
      <button
        onClick={onSubmit}
        disabled={isLoading || value.trim().length < 2}
        className="rounded-xl bg-amber-500 px-6 py-3.5 font-medium text-white shadow-sm
                   transition hover:bg-amber-600 active:scale-95
                   disabled:cursor-not-allowed disabled:opacity-40"
      >
        検索
      </button>
    </div>
  );
}
