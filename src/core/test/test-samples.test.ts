import { buildTestSamples, buildTestSamplesFileName } from '../test-samples';

describe('buildTestSamples', () => {
  it('uses null for files without a recognized episode number', () => {
    expect(buildTestSamples([
      { bestNumber: 1, name: 'file1' },
      { bestNumber: 2, name: 'file2' },
      { bestNumber: Number.NaN, name: 'noIndexFile' },
    ])).toEqual([
      [1, 'file1'],
      [2, 'file2'],
      [null, 'noIndexFile'],
    ]);
  });

  it('removes whitespace from the folder name used for the export file', () => {
    expect(buildTestSamplesFileName('My Folder 01')).toBe('MyFolder01.json');
  });
});
