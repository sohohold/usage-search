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

/** Remove Aozora Bunko header (metadata before the horizontal rule) */
function stripHeader(text: string): string {
  // Header ends at the first line of dashes (--------)
  const match = text.match(/^-{4,}\r?\n/m);
  if (match?.index !== undefined) {
    return text.slice(match.index + match[0].length);
  }
  return text;
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

/** Remove Aozora markup tags like [#「○」入力者注 …] */
function stripMarkup(text: string): string {
  // ※[#...] markers
  text = text.replace(/※\[#[^\]]*\]/g, '');
  // [#...] tags
  text = text.replace(/\[#[^\]]*\]/g, '');
  return text;
}

/** Normalize whitespace */
function normalizeWhitespace(text: string): string {
  // Normalize line endings
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // Collapse 3+ blank lines to 2
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
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

const MIN_CHUNK_LENGTH = 15;
const MAX_CHUNK_LENGTH = 400;

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

    // Split long paragraphs at sentence boundaries
    let current = '';
    for (const part of trimmed.split(/(?<=[。！？」』])/)) {
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
