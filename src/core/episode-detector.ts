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
const ARABIC_INTEGER_RE = /^\d+$/;
const PADDED_ARABIC_RE = /^0\d+$/;
const LONG_ARABIC_RE = /^\d{3,}$/;
const MAX_CONTINUITY_SCORE_LENGTH = 50;
const MAX_INCREMENTAL_ANCHOR_REPEAT_RATE = 0.1;
const ANCHOR_MIN_LENGTH = 3;
/** Numbers larger than (longest continuous sequence max) × this ratio are invalid. */
const MAX_VALUE_TO_SEQUENCE_END_RATIO = 10;

/** Convert ordinary or financial Chinese numerals to a non-negative integer. */
export function chineseToNumber(input: string): number {
  const text = input.replace(/^第/, '');
  if (!text) return NaN;

  const hasUnit = [...text].some(
    (char) =>
      SMALL_CHINESE_UNITS[char] !== undefined ||
      LARGE_CHINESE_UNITS[char] !== undefined,
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

type NumberUnit = 'episode' | 'chapter';

/** Per-candidate features computed once and reused during indexing and scoring. */
interface CandidateView {
  candidate: Candidate;
  style: string;
  unit: NumberUnit | undefined;
  isArabic: boolean;
  isPadded: boolean;
  isLongArabic: boolean;
  anchors: string[];
}

interface FileView {
  item: FileItem;
  stem: string;
  views: CandidateView[];
}

interface AnalysisIndex {
  styledValueFileCount: Map<string, number>;
  labeledValueFileCount: Map<string, number>;
  sequencesByStyle: Map<string, Map<number, SequenceInfo>>;
  paddedArabicSequences: Map<number, SequenceInfo>;
  longArabicSequences: Map<number, SequenceInfo>;
  anchorSequences: Map<string, Map<number, SequenceInfo>>;
  anchorFileIndexes: Map<string, Set<number>>;
  /**
   * Upper bound for valid integer candidates: end of the longest continuous
   * sequence × MAX_VALUE_TO_SEQUENCE_END_RATIO. `Infinity` when no real
   * continuity exists (all runs have length 1).
   */
  maxValidValue: number;
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

  return candidates.sort(
    (left, right) =>
      left.index - right.index || Number(left.isFloat) - Number(right.isFloat),
  );
}

function candidateStyle(candidate: Candidate): string {
  if (ARABIC_INTEGER_RE.test(candidate.raw)) {
    const plain = String(candidate.value);
    return candidate.raw === plain ? 'arabic:plain' : `arabic:padded:${candidate.raw.length}`;
  }
  return 'chinese';
}

function buildSequences(values: Iterable<number>): Map<number, SequenceInfo> {
  const sorted = [...new Set(values)].sort((left, right) => left - right);
  const result = new Map<number, SequenceInfo>();

  for (let cursor = 0; cursor < sorted.length; ) {
    let end = cursor;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end += 1;
    const sequence: SequenceInfo = {
      start: sorted[cursor],
      end: sorted[end],
      length: end - cursor + 1,
    };
    for (let index = cursor; index <= end; index += 1) result.set(sorted[index], sequence);
    cursor = end + 1;
  }

  return result;
}

/** Unique sequence objects from a value→sequence map (shared refs for the same run). */
function uniqueSequences(sequenceMap: Map<number, SequenceInfo>): SequenceInfo[] {
  const seen = new Set<SequenceInfo>();
  const sequences: SequenceInfo[] = [];
  for (const sequence of sequenceMap.values()) {
    if (seen.has(sequence)) continue;
    seen.add(sequence);
    sequences.push(sequence);
  }
  return sequences;
}

/**
 * End value of the longest continuous run across the given tracks.
 * When several runs share the max length, the largest end wins (higher ceiling).
 * Returns `undefined` when there is no run of length ≥ 2.
 */
function longestSequenceEnd(
  sequenceMaps: Iterable<Map<number, SequenceInfo>>,
): number | undefined {
  let bestLength = 0;
  let bestEnd = -Infinity;

  for (const sequenceMap of sequenceMaps) {
    for (const sequence of uniqueSequences(sequenceMap)) {
      if (
        sequence.length > bestLength ||
        (sequence.length === bestLength && sequence.end > bestEnd)
      ) {
        bestLength = sequence.length;
        bestEnd = sequence.end;
      }
    }
  }

  return bestLength >= 2 ? bestEnd : undefined;
}

function getNumberUnit(stem: string, candidate: Candidate): NumberUnit | undefined {
  const marker = stem.slice(candidate.index + candidate.raw.length).match(/^\s*([集章])/u)?.[1];
  if (marker === '集') return 'episode';
  if (marker === '章') return 'chapter';
  return undefined;
}

function getNumberAnchors(stem: string, candidate: Candidate): string[] {
  const letters = stem
    .slice(0, candidate.index)
    .replace(/\s+$/u, '')
    .match(/[\p{L}]+$/u)?.[0];
  if (!letters) return [];

  const characters = [...letters];
  const startCount = characters.length - ANCHOR_MIN_LENGTH + 1;
  if (startCount <= 0) return [];

  const anchors: string[] = [];
  for (let start = 0; start < startCount; start += 1) {
    anchors.push(characters.slice(start).join(''));
  }
  return anchors;
}

function buildCandidateView(stem: string, candidate: Candidate): CandidateView {
  const isArabic = !candidate.isFloat && ARABIC_INTEGER_RE.test(candidate.raw);
  return {
    candidate,
    style: candidateStyle(candidate),
    unit: getNumberUnit(stem, candidate),
    isArabic,
    isPadded: isArabic && PADDED_ARABIC_RE.test(candidate.raw),
    isLongArabic: isArabic && LONG_ARABIC_RE.test(candidate.raw),
    anchors: isArabic ? getNumberAnchors(stem, candidate) : [],
  };
}

function buildFileViews(items: FileItem[]): FileView[] {
  return items.map((item) => {
    const stem = withoutExtension(item.name);
    return {
      item,
      stem,
      views: item.candidates.map((candidate) => buildCandidateView(stem, candidate)),
    };
  });
}

function incrementCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function addToSetMap<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  const set = map.get(key) ?? new Set<V>();
  set.add(value);
  map.set(key, set);
}

function addToNestedSetMap<K1, K2, V>(
  map: Map<K1, Map<K2, Set<V>>>,
  key1: K1,
  key2: K2,
  value: V,
): void {
  const inner = map.get(key1) ?? new Map<K2, Set<V>>();
  const set = inner.get(key2) ?? new Set<V>();
  set.add(value);
  inner.set(key2, set);
  map.set(key1, inner);
}

/**
 * Single pass over every file/candidate: frequency tables, style tracks,
 * padded/long Arabic tracks, and incremental-anchor tracks.
 */
function buildAnalysisIndex(fileViews: FileView[]): AnalysisIndex {
  const styledValueFileCount = new Map<string, number>();
  const labeledValueFileCount = new Map<string, number>();
  const valuesByStyle = new Map<string, Set<number>>();
  const paddedArabicValues = new Set<number>();
  const longArabicValues = new Set<number>();
  const anchorValueFileIndexes = new Map<string, Map<number, Set<number>>>();
  const anchorFileIndexes = new Map<string, Set<number>>();

  for (const [fileIndex, { views }] of fileViews.entries()) {
    const styledKeys = new Set<string>();
    const labeledKeys = new Set<string>();

    for (const view of views) {
      const { candidate, style, unit, isPadded, isLongArabic, anchors } = view;

      if (!candidate.isFloat) {
        styledKeys.add(`${candidate.value}:${style}`);
        addToSetMap(valuesByStyle, style, candidate.value);
        if (isPadded) paddedArabicValues.add(candidate.value);
        if (isLongArabic) longArabicValues.add(candidate.value);
      }

      if (unit) labeledKeys.add(`${candidate.value}:${unit}`);

      // A repeated title alone is not useful evidence: "斗罗大陆3" repeats the
      // same title number in every file. The useful signal is that numbers after
      // the same anchor form a sequence, such as "极品吹牛系统811/812/813".
      for (const anchor of anchors) {
        addToNestedSetMap(anchorValueFileIndexes, anchor, candidate.value, fileIndex);
        addToSetMap(anchorFileIndexes, anchor, fileIndex);
      }
    }

    for (const key of styledKeys) incrementCount(styledValueFileCount, key);
    for (const key of labeledKeys) incrementCount(labeledValueFileCount, key);
  }

  // Build continuity independently for each notation. A Chinese title number such as
  // "五百次回眸" must not borrow continuity from an Arabic 001..999 episode track.
  const sequencesByStyle = new Map<string, Map<number, SequenceInfo>>();
  for (const [style, values] of valuesByStyle) {
    sequencesByStyle.set(style, buildSequences(values));
  }

  const anchorSequences = new Map<string, Map<number, SequenceInfo>>();
  for (const [anchor, valueFiles] of anchorValueFileIndexes) {
    anchorSequences.set(anchor, buildSequences(valueFiles.keys()));
  }

  // Long Arabic numbers with different padding are still one episode track:
  // 001, 0002, 003, ..., 138 must be able to reinforce one another. Short
  // numbers are excluded because they are much more likely to be labels or
  // title numbers (for example, "加更10" or "斗罗大陆3").
  const paddedArabicSequences = buildSequences(paddedArabicValues);
  const longArabicSequences = buildSequences(longArabicValues);

  // Numbers above (longest continuous sequence max) × 10 are treated as noise
  // (years, bitrates, promo copy, etc.) once a real track exists.
  const sequenceEnd = longestSequenceEnd([
    ...sequencesByStyle.values(),
    paddedArabicSequences,
    longArabicSequences,
  ]);
  const maxValidValue =
    sequenceEnd === undefined
      ? Infinity
      : sequenceEnd * MAX_VALUE_TO_SEQUENCE_END_RATIO;

  return {
    styledValueFileCount,
    labeledValueFileCount,
    sequencesByStyle,
    paddedArabicSequences,
    longArabicSequences,
    anchorSequences,
    anchorFileIndexes,
    maxValidValue,
  };
}

interface AnchorSupport {
  sequenceLength: number;
  fileSupport: number;
}

function bestAnchorSupport(
  view: CandidateView,
  index: AnalysisIndex,
): AnchorSupport {
  let sequenceLength = 0;
  let fileSupport = 0;

  for (const anchor of view.anchors) {
    const sequence = index.anchorSequences.get(anchor)?.get(view.candidate.value);
    const support = index.anchorFileIndexes.get(anchor)?.size ?? 0;
    if (
      sequence &&
      (sequence.length > sequenceLength ||
        (sequence.length === sequenceLength && support > fileSupport))
    ) {
      sequenceLength = sequence.length;
      fileSupport = support;
    }
  }

  return { sequenceLength, fileSupport };
}

/**
 * Continuity dominates; repeated values continuously lose confidence.
 * This keeps embedded labels like "mp3" from beating a real padded track,
 * even when they appear in fewer than 30% of files.
 */
function scoreIntegerCandidate(
  view: CandidateView,
  index: AnalysisIndex,
  fileCount: number,
  totalFiles: number,
  longestArabicRawLength: number,
  hasExplicitUnitCandidate: boolean,
  nameLength: number,
): number {
  const { candidate, style, unit, isArabic, isPadded, isLongArabic } = view;

  const styleSequence = index.sequencesByStyle.get(style)?.get(candidate.value);
  const paddedSequence = isPadded
    ? index.paddedArabicSequences.get(candidate.value)
    : undefined;
  const longSequence = isLongArabic
    ? index.longArabicSequences.get(candidate.value)
    : undefined;

  // Once a track is already very long, extra length is no longer stronger evidence:
  // otherwise an unrelated 2,000-value track can overwhelm a valid 1,000-value one.
  // Different zero-padding widths still belong to the same numeric track:
  // 0001, 0026 and 026 are presentation variants of episode numbers.
  const continuity = Math.min(
    Math.max(
      styleSequence?.length ?? 0,
      paddedSequence?.length ?? 0,
      longSequence?.length ?? 0,
    ),
    MAX_CONTINUITY_SCORE_LENGTH,
  );

  const repeatRate = fileCount / totalFiles;
  let score = continuity * 10_000;
  score += continuity * 100;
  score -= repeatRate * continuity * 20_000;

  const isRepeatedShortCandidate =
    isArabic && candidate.raw.length < longestArabicRawLength && fileCount > 1;
  if (isRepeatedShortCandidate) {
    score -= Math.min(fileCount - 1, 20) * 10_000;
  }

  // A repeated incremental anchor is only an auxiliary signal. A repeated
  // value such as "斗罗大陆3" has no incremental anchor sequence and gets
  // no bonus, while "极品吹牛系统811/812/813" does.
  const { sequenceLength: anchorSequenceLength, fileSupport: anchorFileSupport } =
    bestAnchorSupport(view, index);
  const isExplicitUnitCandidate = unit !== undefined;
  if (
    isArabic &&
    anchorSequenceLength >= 2 &&
    anchorFileSupport > 1 &&
    repeatRate < MAX_INCREMENTAL_ANCHOR_REPEAT_RATE &&
    (!hasExplicitUnitCandidate || isExplicitUnitCandidate)
  ) {
    score += Math.min(anchorSequenceLength, MAX_CONTINUITY_SCORE_LENGTH) * 10_000;
  }

  // Prefer the earlier occurrence only after global evidence is exhausted.
  score -= candidate.index / Math.max(1, nameLength);

  // Single-character Chinese numerals without 第…/…章/…集 are usually
  // title noise (“前两天”, “（二）”, “一票”), not episode markers.
  if (
    style === 'chinese' &&
    unit === undefined &&
    [...candidate.raw].length === 1
  ) {
    score -= MAX_CONTINUITY_SCORE_LENGTH * 2_000;
  }

  return score;
}

function selectBestNumber(
  fileView: FileView,
  index: AnalysisIndex,
  totalFiles: number,
): number {
  const { item, views } = fileView;

  const decimalTailIndexes = new Set(
    views
      .filter((view) => view.candidate.isFloat)
      .map((view) => view.candidate.index + view.candidate.raw.indexOf('.') + 1),
  );

  const integerViews = views.filter(
    (view) => !view.candidate.isFloat && !decimalTailIndexes.has(view.candidate.index),
  );

  const longestArabicRawLength = Math.max(
    0,
    ...integerViews
      .filter((view) => view.isArabic)
      .map((view) => view.candidate.raw.length),
  );
  const hasExplicitUnitCandidate = integerViews.some((view) => view.unit !== undefined);

  let winner: Candidate | undefined;
  let winnerScore = -Infinity;

  for (const view of integerViews) {
    const { candidate, style, unit } = view;
    // Reject outliers far above the main continuous track (e.g. 1080 / 2023
    // when the episode run tops out near 10–100).
    if (candidate.value > index.maxValidValue) continue;

    const fileCount = unit
      ? (index.labeledValueFileCount.get(`${candidate.value}:${unit}`) ?? 1)
      : (index.styledValueFileCount.get(`${candidate.value}:${style}`) ?? 1);

    const score = scoreIntegerCandidate(
      view,
      index,
      fileCount,
      totalFiles,
      longestArabicRawLength,
      hasExplicitUnitCandidate,
      item.name.length,
    );

    if (score > winnerScore) {
      winner = candidate;
      winnerScore = score;
    }
  }

  return winner?.value ?? NaN;
}

interface LabeledCandidates {
  episode: Candidate[];
  chapter: Candidate[];
}

function getLabeledCandidates(fileView: FileView): LabeledCandidates {
  const labeled: LabeledCandidates = { episode: [], chapter: [] };
  for (const view of fileView.views) {
    if (view.unit) labeled[view.unit].push(view.candidate);
  }
  return labeled;
}

/**
 * Resolve names containing both “n集” and “m章” after the normal analysis.
 * The more common unit selected by the first analysis is the preferred track.
 */
function resolveRepeatedEpisodeChapterNumbers(fileViews: FileView[]): void {
  const labeledItems = fileViews.map((fileView) => ({
    item: fileView.item,
    labeled: getLabeledCandidates(fileView),
  }));
  const hasMixedUnits = labeledItems.some(
    ({ labeled }) => labeled.episode.length > 0 && labeled.chapter.length > 0,
  );
  if (!hasMixedUnits) return;

  let episodeCount = 0;
  let chapterCount = 0;
  for (const { item, labeled } of labeledItems) {
    const selectedUnits = new Set<NumberUnit>();
    if (labeled.episode.some((candidate) => candidate.value === item.bestNumber)) {
      selectedUnits.add('episode');
    }
    if (labeled.chapter.some((candidate) => candidate.value === item.bestNumber)) {
      selectedUnits.add('chapter');
    }
    if (selectedUnits.size !== 1) continue;
    if (selectedUnits.has('episode')) episodeCount += 1;
    else chapterCount += 1;
  }

  const preferredUnit: NumberUnit | undefined =
    episodeCount > chapterCount
      ? 'episode'
      : chapterCount > episodeCount
        ? 'chapter'
        : undefined;
  if (!preferredUnit) return;

  for (const { item, labeled } of labeledItems) {
    if (labeled.episode.length === 0 || labeled.chapter.length === 0) continue;

    const candidates = labeled[preferredUnit];
    const preferredCandidate =
      candidates.find((candidate) => candidate.value === item.bestNumber) ?? candidates[0];
    if (preferredCandidate) item.bestNumber = preferredCandidate.value;
  }
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
    const assignments = group.map((item) =>
      item.candidates.find((candidate) => candidate.isFloat && candidate.intPart === base),
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

/** Analyze all names together and select the most likely continuous number in each file. */
export function analyzeEpisodes(files: { name: string; path: string }[]): FileItem[] {
  if (files.length === 0) return [];

  const items: FileItem[] = files.map((file) => ({
    ...file,
    candidates: extractCandidates(file.name),
    bestNumber: NaN,
    finalNumberStr: '',
  }));

  const fileViews = buildFileViews(items);
  const index = buildAnalysisIndex(fileViews);

  for (const fileView of fileViews) {
    fileView.item.bestNumber = selectBestNumber(fileView, index, items.length);
  }

  resolveExplicitSubNumbers(items);
  resolveRepeatedEpisodeChapterNumbers(fileViews);
  return items;
}

export function formatEpisodeNumber(num: number, paddingWidth: number): string {
  if (!Number.isFinite(num)) return '';
  const [integer, decimal] = String(num).split('.');
  const padded = integer.padStart(paddingWidth, '0');
  return decimal === undefined ? padded : `${padded}.${decimal}`;
}
