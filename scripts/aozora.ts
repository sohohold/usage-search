/**
 * Aozora Bunko text parsing utilities
 *
 * Handles:
 * - Header/footer removal (works separated by "-------")
 * - Ruby annotation removal (漢字《かんじ》→ 漢字)
 * - Aozora markup tags removal ([#注釈])
 * - Special character markers (※[#...])
 * - Splitting into searchable paragraphs
 */

const RULE_RE = /^-{4,}[ \t]*\r?\n/m;
const LEGEND_HEADING = '【テキスト中に現れる記号について】';

/**
 * Remove the Aozora Bunko header (title, author, and the notation legend).
 *
 * The standard layout puts a legend block between two rules:
 *
 *     こころ / 夏目漱石
 *     -------------------
 *     【テキスト中に現れる記号について】  ← must not be indexed as body text
 *     -------------------
 *     （本文）
 *
 * so when a legend is present the header runs to the *second* rule. Works
 * without a legend have a single rule, and some have none at all.
 */
function stripHeader(text: string): string {
  const first = text.match(RULE_RE);
  if (first?.index === undefined) return text;

  const afterFirst = text.slice(first.index + first[0].length);
  const second = afterFirst.match(RULE_RE);
  if (second?.index !== undefined && afterFirst.slice(0, second.index).includes(LEGEND_HEADING)) {
    return afterFirst.slice(second.index + second[0].length);
  }
  return afterFirst;
}

/** Remove Aozora Bunko footer (bibliographic info after the body) */
function stripFooter(text: string): string {
  // Footer starts at 底本：or 入力：
  const footerRe = /\n底本[：:]/;
  const match = text.match(footerRe);
  if (match?.index !== undefined) {
    return text.slice(0, match.index);
  }
  return text;
}

/** Remove ruby annotations: 漢字《かんじ》→ 漢字, ｜単語《たんご》→ 単語 */
function stripRuby(text: string): string {
  // ｜word《reading》 → word
  text = text.replace(/[｜|]([^｜|《\n]+)《[^》]*》/g, '$1');
  // word《reading》 → word (without vertical bar)
  text = text.replace(/《[^》\n]*》/g, '');
  return text;
}

/**
 * Remove Aozora markup tags like ［＃「○」に傍点］ and gaiji markers like
 * ※［＃「てへん＋劣」、第3水準1-84-77］.
 *
 * Real Aozora texts write these with full-width brackets; the half-width form
 * is handled too so older or hand-edited sources stay covered. The optional
 * leading ※ is part of the match so no stray marker is left behind.
 */
function stripMarkup(text: string): string {
  text = text.replace(/※?［＃[^］]*］/g, '');
  text = text.replace(/※?\[#[^\]]*\]/g, '');
  return text;
}

/** Joins the lines inside one paragraph so a chunk always renders as a single line. */
export const LINE_JOINER = ' / ';
/** Blank lines survive as paragraph breaks, since a paragraph is one indexed chunk. */
const PARAGRAPH_SEPARATOR = '\n\n';
/** One or more blank lines, allowing lines that hold only spaces. */
const BLANK_LINE_RUN = /\n(?:[ \t　]*\n)+/;

/**
 * Reduce the text to paragraphs separated by a blank line, each paragraph on a
 * single line with its internal breaks shown as `LINE_JOINER`.
 */
function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split(BLANK_LINE_RUN)
    .map((paragraph) =>
      paragraph
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join(LINE_JOINER)
    )
    .filter(Boolean)
    .join(PARAGRAPH_SEPARATOR);
}

/** Full pipeline: raw Aozora text → cleaned body text */
export function cleanAozoraText(raw: string): string {
  let text = raw;
  text = stripHeader(text);
  text = stripFooter(text);
  text = stripRuby(text);
  text = stripMarkup(text);
  text = normalizeWhitespace(text);
  return text;
}

/** Paragraphs shorter than this carry no useful context, so they are not indexed. */
export const MIN_CHUNK_LENGTH = 15;
/** A chunk is one result card, so it must stay short enough to display. */
export const MAX_CHUNK_LENGTH = 400;

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * Cut a run of text into pieces no longer than MAX_CHUNK_LENGTH.
 *
 * The cut never lands inside a surrogate pair: a supplementary character such
 * as 𠮟 spans two UTF-16 units, and splitting it would leave a lone surrogate
 * in each piece, which turns into a replacement character on the way into
 * SQLite. Pulling the boundary back one unit keeps the pair whole and still
 * respects the limit.
 */
function splitAtMaxLength(part: string): string[] {
  if (part.length <= MAX_CHUNK_LENGTH) return [part];

  const pieces: string[] = [];
  for (let start = 0; start < part.length; ) {
    let end = Math.min(start + MAX_CHUNK_LENGTH, part.length);
    if (
      end < part.length &&
      isHighSurrogate(part.charCodeAt(end - 1)) &&
      isLowSurrogate(part.charCodeAt(end))
    ) {
      end--;
    }
    pieces.push(part.slice(start, end));
    start = end;
  }
  return pieces;
}

/**
 * Split cleaned text into paragraph chunks suitable for FTS indexing.
 * Splits at paragraph breaks (blank lines), further splits long paragraphs
 * at sentence-ending punctuation.
 */
export function splitIntoChunks(text: string): string[] {
  const chunks: string[] = [];

  for (const para of text.split(/\n\n+/)) {
    const trimmed = para.trim();
    if (trimmed.length < MIN_CHUNK_LENGTH) continue;

    if (trimmed.length <= MAX_CHUNK_LENGTH) {
      chunks.push(trimmed);
      continue;
    }

    // Split long paragraphs at sentence boundaries. A single sentence can still
    // exceed the limit (or the paragraph may have no sentence breaks at all), so
    // oversized pieces are cut at the limit before accumulating.
    let current = '';
    for (const part of trimmed.split(/(?<=[。！？」』])/).flatMap(splitAtMaxLength)) {
      if (current.length + part.length > MAX_CHUNK_LENGTH && current.length >= MIN_CHUNK_LENGTH) {
        chunks.push(current.trim());
        current = part;
      } else {
        current += part;
      }
    }
    if (current.trim().length >= MIN_CHUNK_LENGTH) {
      chunks.push(current.trim());
    }
  }

  return chunks;
}
