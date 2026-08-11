import type { FileItem } from './episode-detector';

export type TestSample = [number | null, string];

/** Convert the current recognition results to the compact format used by tests. */
export function buildTestSamples(files: Pick<FileItem, 'bestNumber' | 'name'>[]): TestSample[] {
  return files.map(({ bestNumber, name }) => [
    Number.isFinite(bestNumber) ? bestNumber : null,
    name,
  ]);
}

export function buildTestSamplesFileName(folderName: string): string {
  const compactName = folderName.replace(/\s+/g, '');
  return `${compactName || 'jurename-test-samples'}.json`;
}
