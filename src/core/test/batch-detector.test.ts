import { isBatchDirectory, analyzeBatchFolder, computeEpisodeSegments } from '../batch-detector';

describe('批量文件夹分析逻辑测试', () => {
  test('判断直属一层子文件与文件夹是否判定为批量分析', () => {
    // 只有文件夹，无文件：判定为批量
    expect(isBatchDirectory(1, 0)).toBe(true);
    expect(isBatchDirectory(5, 0)).toBe(true);

    // 3个以上文件夹，3个以下文件 (即 >= 3 且 < 3)：判定为批量
    expect(isBatchDirectory(3, 0)).toBe(true);
    expect(isBatchDirectory(3, 1)).toBe(true);
    expect(isBatchDirectory(3, 2)).toBe(true);
    expect(isBatchDirectory(5, 2)).toBe(true);

    // 不满足条件的普通单剧集文件夹：不判定为批量
    expect(isBatchDirectory(2, 5)).toBe(false);
    expect(isBatchDirectory(0, 10)).toBe(false);
    expect(isBatchDirectory(3, 3)).toBe(false);
  });

  test('分析单个子文件夹并计算连续与缺省序号段', () => {
    const files = [
      { name: 'Show.EP01.mp4', path: '/folder/Show.EP01.mp4' },
      { name: 'Show.EP02.mp4', path: '/folder/Show.EP02.mp4' },
      { name: 'Show.EP05.mp4', path: '/folder/Show.EP05.mp4' },
    ];

    const result = analyzeBatchFolder('/folder', 'Show S01', files);

    expect(result.folderName).toBe('Show S01');
    expect(result.totalCount).toBe(3);
    expect(result.detectedCount).toBe(3);
    expect(result.continuousSegments).toEqual([
      { start: 1, end: 2 },
      { start: 5, end: 5 },
    ]);
    expect(result.missingSegments).toEqual([{ start: 3, end: 4 }]);
    expect(result.missingCount).toBe(2);
  });
});
