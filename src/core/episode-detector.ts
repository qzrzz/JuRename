const CHINESE_DIGITS: Record<string, number> = {
  零: 0, '〇': 0,
  一: 1, 壹: 1,
  二: 2, 两: 2, 贰: 2, 貳: 2,
  三: 3, 叁: 3, 參: 3,
  四: 4, 肆: 4,
  五: 5, 伍: 5,
  六: 6, 陆: 6, 陸: 6,
  七: 7, 柒: 7,
  八: 8, 捌: 8,
  九: 9, 玖: 9,
};

const SMALL_CHINESE_UNITS: Record<string, number> = {
  十: 10, 拾: 10,
  百: 100, 佰: 100,
  千: 1000, 仟: 1000,
};

const LARGE_CHINESE_UNITS: Record<string, number> = {
  万: 10_000, 萬: 10_000,
  亿: 100_000_000, 億: 100_000_000,
};

const CHINESE_NUMBER_RE = /[零〇一壹二两贰貳三叁參四肆五伍六陆陸七柒八捌九玖十拾百佰千仟万萬亿億]+/g;
const MAX_CONTINUITY_SCORE_LENGTH = 50;

/** Convert ordinary or financial Chinese numerals to a non-negative integer. */
export function chineseToNumber(input: string): number {
  const text = input.replace(/^第/, '');
  if (!text) return NaN;

  const hasUnit = [...text].some(char =>
    SMALL_CHINESE_UNITS[char] !== undefined || LARGE_CHINESE_UNITS[char] !== undefined
  );

  // A unit-less token such as 二〇二六 is a sequence of digits, not an addition.
  if (!hasUnit) {
    let digits = '';
    for (const char of text) {
      const digit = CHINESE_DIGITS[char];
      if (digit === undefined) return NaN;
      digits += String(digit);
    }
    return Number(digits);
  }

  let total = 0;
  let section = 0;
  let digit: number | undefined;

  for (const char of text) {
    const nextDigit = CHINESE_DIGITS[char];
    if (nextDigit !== undefined) {
      digit = nextDigit;
      continue;
    }

    const smallUnit = SMALL_CHINESE_UNITS[char];
    if (smallUnit !== undefined) {
      section += (digit ?? 1) * smallUnit;
      digit = undefined;
      continue;
    }

    const largeUnit = LARGE_CHINESE_UNITS[char];
    if (largeUnit !== undefined) {
      section += digit ?? 0;
      if (largeUnit === 10_000) total += section * largeUnit;
      else total = (total + section) * largeUnit;
      section = 0;
      digit = undefined;
      continue;
    }

    return NaN;
  }

  return total + section + (digit ?? 0);
}

export interface Candidate {
  value: number;
  raw: string;
  index: number;
  isFloat: boolean;
  intPart: number;
}

export interface FileItem {
  path: string;
  name: string;
  candidates: Candidate[];
  bestNumber: number;
  finalNumberStr: string;
}

interface SequenceInfo {
  start: number;
  end: number;
  length: number;
}

function withoutExtension(filename: string): string {
  const slash = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
  const dot = filename.lastIndexOf('.');
  if (dot <= slash + 1) return filename;

  const extension = filename.slice(dot + 1);
  // Keep a trailing numeric component: in "001.2" it is part of the name.
  return /^[a-z][a-z0-9]{0,9}$/i.test(extension) ? filename.slice(0, dot) : filename;
}

/** Extract every Arabic and Chinese number without relying on episode keywords. */
export function extractCandidates(filename: string): Candidate[] {
  const stem = withoutExtension(filename);
  const candidates: Candidate[] = [];
  const arabic: Array<{ raw: string; index: number; value: number }> = [];

  for (const match of stem.matchAll(/\d+/g)) {
    const raw = match[0];
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) continue;
    const entry = { raw, index: match.index, value };
    arabic.push(entry);
    candidates.push({ value, raw, index: match.index, isFloat: false, intPart: value });
  }

  // n.n is recorded as extra evidence. It is never selected as the base sequence.
  for (let index = 0; index + 1 < arabic.length; index += 1) {
    const left = arabic[index];
    const right = arabic[index + 1];
    const separator = stem.slice(left.index + left.raw.length, right.index);
    // A very large right-hand side is overwhelmingly likely to be a media
    // specification (01.1080p), not an episode sub-number.
    if (separator !== '.' || right.value >= 100) continue;

    const raw = `${left.raw}.${right.raw}`;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    candidates.push({ value, raw, index: left.index, isFloat: true, intPart: left.value });
  }

  for (const match of stem.matchAll(CHINESE_NUMBER_RE)) {
    const value = chineseToNumber(match[0]);
    if (!Number.isSafeInteger(value) || value < 0) continue;
    candidates.push({
      value,
      raw: match[0],
      index: match.index,
      isFloat: false,
      intPart: value,
    });
  }

  return candidates.sort((left, right) =>
    left.index - right.index || Number(left.isFloat) - Number(right.isFloat)
  );
}

function candidateStyle(candidate: Candidate): string {
  if (/^\d+$/.test(candidate.raw)) {
    const plain = String(candidate.value);
    return candidate.raw === plain ? 'arabic:plain' : `arabic:padded:${candidate.raw.length}`;
  }
  return 'chinese';
}

function buildSequences(values: Iterable<number>): Map<number, SequenceInfo> {
  const sorted = [...new Set(values)].sort((left, right) => left - right);
  const result = new Map<number, SequenceInfo>();

  for (let cursor = 0; cursor < sorted.length;) {
    let end = cursor;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end += 1;
    const sequence = {
      start: sorted[cursor],
      end: sorted[end],
      length: end - cursor + 1,
    };
    for (let index = cursor; index <= end; index += 1) result.set(sorted[index], sequence);
    cursor = end + 1;
  }

  return result;
}

/** Analyze all names together and select the most likely continuous number in each file. */
export function analyzeEpisodes(files: { name: string; path: string }[]): FileItem[] {
  if (files.length === 0) return [];

  const items: FileItem[] = files.map(file => ({
    ...file,
    candidates: extractCandidates(file.name),
    bestNumber: NaN,
    finalNumberStr: '',
  }));

  const styledValueFileCount = new Map<string, number>();
  for (const item of items) {
    const styledValues = new Set(
      item.candidates
        .filter(candidate => !candidate.isFloat)
        .map(candidate => `${candidate.value}:${candidateStyle(candidate)}`)
    );
    for (const key of styledValues) {
      styledValueFileCount.set(key, (styledValueFileCount.get(key) ?? 0) + 1);
    }
  }

  // Build continuity independently for each notation. A Chinese title number such as
  // "五百次回眸" must not borrow continuity from an Arabic 001..999 episode track.
  const valuesByStyle = new Map<string, Set<number>>();
  for (const item of items) {
    for (const candidate of item.candidates) {
      if (candidate.isFloat) continue;
      const style = candidateStyle(candidate);
      if (!valuesByStyle.has(style)) valuesByStyle.set(style, new Set());
      valuesByStyle.get(style)!.add(candidate.value);
    }
  }
  const sequencesByStyle = new Map<string, Map<number, SequenceInfo>>();
  for (const [style, values] of valuesByStyle) {
    sequencesByStyle.set(style, buildSequences(values));
  }

  for (const item of items) {
    const decimalTailIndexes = new Set(
      item.candidates
        .filter(candidate => candidate.isFloat)
        .map(candidate => candidate.index + candidate.raw.indexOf('.') + 1)
    );
    const integerCandidates = item.candidates.filter(candidate =>
      !candidate.isFloat && !decimalTailIndexes.has(candidate.index)
    );
    let winner: Candidate | undefined;
    let winnerScore = -Infinity;

    for (const candidate of integerCandidates) {
      const style = candidateStyle(candidate);
      const sequence = sequencesByStyle.get(style)!.get(candidate.value)!;
      const repetitionKey = `${candidate.value}:${style}`;
      const fileCount = styledValueFileCount.get(repetitionKey) ?? 1;
      const repeatRate = fileCount / items.length;

      // Continuity deliberately dominates, while repeated values continuously lose
      // confidence. This is important for embedded labels such as "mp3": even when
      // they occur in fewer than 30% of files, they must not beat a real padded track.
      // Once a track is already very long, extra length is no longer stronger evidence:
      // otherwise an unrelated 2,000-value track can overwhelm a valid 1,000-value one.
      const continuity = Math.min(sequence.length, MAX_CONTINUITY_SCORE_LENGTH);
      let score = continuity * 10_000;
      score += continuity * 100;
      score -= repeatRate * continuity * 20_000;

      // Prefer the earlier occurrence only after global evidence is exhausted.
      score -= candidate.index / Math.max(1, item.name.length);

      if (score > winnerScore) {
        winner = candidate;
        winnerScore = score;
      }
    }

    item.bestNumber = winner?.value ?? NaN;
  }

  resolveExplicitSubNumbers(items);
  return items;
}

function resolveExplicitSubNumbers(items: FileItem[]): void {
  const groups = new Map<number, FileItem[]>();
  for (const item of items) {
    if (!Number.isInteger(item.bestNumber)) continue;
    const group = groups.get(item.bestNumber) ?? [];
    group.push(item);
    groups.set(item.bestNumber, group);
  }

  for (const [base, group] of groups) {
    if (group.length < 2) continue;
    const assignments = group.map(item =>
      item.candidates.find(candidate => candidate.isFloat && candidate.intPart === base)
    );
    const counts = new Map<number, number>();
    for (const candidate of assignments) {
      if (candidate) counts.set(candidate.value, (counts.get(candidate.value) ?? 0) + 1);
    }

    // A plain 001 may coexist with 001.1. Only the latter is changed, because
    // the sub-number must be present in that file's original name.
    group.forEach((item, index) => {
      const candidate = assignments[index];
      if (candidate && counts.get(candidate.value) === 1) item.bestNumber = candidate.value;
    });
  }
}

export function formatEpisodeNumber(num: number, paddingWidth: number): string {
  if (!Number.isFinite(num)) return '';
  const [integer, decimal] = String(num).split('.');
  const padded = integer.padStart(paddingWidth, '0');
  return decimal === undefined ? padded : `${padded}.${decimal}`;
}
