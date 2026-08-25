import type { estypes } from '@elastic/elasticsearch';
import type { SearchResult } from '@/types';

/** 索引に入れているドキュメント（`scripts/es-load.ts` が投入する形）。 */
export interface ChunkSource {
  work_id: string;
  title: string;
  author: string;
  author_url: string | null;
  card_url: string;
  seq: number;
  text: string;
}

/** スニペットに残す、一致箇所の前後の文字数。 */
export const SNIPPET_RADIUS = 24;

/**
 * クエリ長で使うフィールドを選ぶ。
 * 1文字はユニグラム、2文字以上はバイグラムのフィールドを `match_phrase` で引く。
 * 重なり n-gram のフレーズ一致は部分文字列一致と等価なので、取りこぼしも偽陽性も出ない。
 */
export function queryField(query: string): 'text' | 'text.uni' {
  return Array.from(query).length === 1 ? 'text.uni' : 'text';
}

export type EsSearchBody = Required<
  Pick<estypes.SearchRequest, 'from' | 'size' | 'track_total_hits' | '_source' | 'query' | 'sort' | 'highlight'>
>;

export function buildSearchBody(query: string, limit: number, offset: number): EsSearchBody {
  const field = queryField(query);
  return {
    from: offset,
    // limit+1 件目の有無で over_limit を判定する（総件数は数えない）。
    size: limit + 1,
    track_total_hits: false,
    _source: ['title', 'author', 'author_url', 'card_url', 'text'],
    query: { match_phrase: { [field]: query } },
    // スコアだけだと同点が大量に出てページングが揺れるため、作品IDと段落番号で決定的にする。
    sort: ['_score', { work_id: 'asc' }, { seq: 'asc' }],
    highlight: {
      pre_tags: ['<mark>'],
      post_tags: ['</mark>'],
      // 本文中の `<` や `&` をエスケープさせる。描画は dangerouslySetInnerHTML なので必須。
      encoder: 'html',
      // 0 = 断片に切らず、段落全体をハイライト付きで返す（1チャンクは最大400文字）。
      number_of_fragments: 0,
      fields: { [field]: {} },
    },
  };
}

/** ハイライト済み HTML を「表示上の1文字」単位に分解した結果。 */
interface Units {
  /** 各要素が表示上の1文字（`&amp;` のような実体参照も1文字として1要素）。 */
  chars: string[];
  /** 同じ添字の文字が `<mark>` の内側かどうか。 */
  marked: boolean[];
}

const TOKEN = /<mark>|<\/mark>|&[a-zA-Z]+;|&#\d+;|[\s\S]/g;

export function parseHighlight(html: string): Units {
  const chars: string[] = [];
  const marked: boolean[] = [];
  let inMark = false;
  for (const [token] of html.matchAll(TOKEN)) {
    if (token === '<mark>') inMark = true;
    else if (token === '</mark>') inMark = false;
    else {
      chars.push(token);
      marked.push(inMark);
    }
  }
  return { chars, marked };
}

function render({ chars, marked }: Units, start: number, end: number): string {
  let out = '';
  let open = false;
  for (let i = start; i < end; i++) {
    if (marked[i] && !open) { out += '<mark>'; open = true; }
    else if (!marked[i] && open) { out += '</mark>'; open = false; }
    out += chars[i];
  }
  if (open) out += '</mark>';
  return out;
}

/**
 * 段落全体のハイライトから、最初の一致の前後だけを切り出す。
 * 実体参照やタグを壊さないよう、切る位置は「表示上の文字」の境界に限る。
 */
export function narrowHighlight(html: string, radius = SNIPPET_RADIUS): string {
  const units = parseHighlight(html);
  const first = units.marked.indexOf(true);
  if (first === -1) return html;
  const last = units.marked.lastIndexOf(true);

  const start = Math.max(0, first - radius);
  const end = Math.min(units.chars.length, last + 1 + radius);
  const body = render(units, start, end);
  return `${start > 0 ? '…' : ''}${body}${end < units.chars.length ? '…' : ''}`;
}

/** `SearchHit<ChunkSource>` もそのまま渡せる、必要な項目だけの形。 */
export interface EsHitLike {
  _source?: Partial<ChunkSource>;
  highlight?: Record<string, string[]>;
}

export function toSearchResult(hit: EsHitLike, field: string): SearchResult {
  const src = hit._source ?? {};
  // ハイライトが返らないのは、一致がフィールド外（起こらないはず）のときだけ。本文で代替する。
  const context = hit.highlight?.[field]?.[0] ?? src.text ?? '';
  return {
    title: src.title ?? '',
    author: src.author ?? '',
    author_url: src.author_url ?? null,
    card_url: src.card_url ?? '',
    snippet: narrowHighlight(context),
    context,
  };
}
