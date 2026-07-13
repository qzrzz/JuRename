import { chineseToNumber, extractCandidates, analyzeEpisodes, formatEpisodeNumber } from '../episode-detector';

describe('剧集智能识别核心算法测试', () => {

  test('中文数字转换为阿拉伯数字', () => {
    expect(chineseToNumber('三')).toBe(3);
    expect(chineseToNumber('十二')).toBe(12);
    expect(chineseToNumber('三十五')).toBe(35);
    expect(chineseToNumber('一百零五')).toBe(105);
    expect(chineseToNumber('第十四')).toBe(14);
    expect(chineseToNumber('九百九十九')).toBe(999);
  });

  test('提取文件名中的整数和浮点候选', () => {
    const cands = extractCandidates('Show.01.2.mkv');
    const values = cands.map(c => c.value);
    // 应包含整数 1, 2，以及浮点 1.2
    expect(values).toContain(1);
    expect(values).toContain(2);
    expect(values).toContain(1.2);
  });

  test('不把 1080p 之类的规格误判为浮点', () => {
    const cands = extractCandidates('Show.01.1080p.mkv');
    const values = cands.map(c => c.value);
    // 应有整数 1 和 1080，但不应有 1.108 这种浮点
    expect(values).toContain(1);
    expect(values).toContain(1080);
    expect(values.some(v => v > 1 && v < 2)).toBe(false);
  });

  test('智能排除年份与分辨率等干扰数字', () => {
    const files = [
      { name: 'Show.2023.EP01.1080p.mp4', path: '/1' },
      { name: 'Show.2023.EP02.1080p.mp4', path: '/2' },
      { name: 'Show.2023.EP03.1080p.mp4', path: '/3' },
      { name: 'Show.2023.EP04.1080p.mp4', path: '/4' },
    ];
    const results = analyzeEpisodes(files);

    // 2023 和 1080 在每个文件中都出现（100% 重复率），且无特征，应被排除
    expect(results[0].bestNumber).toBe(1);
    expect(results[1].bestNumber).toBe(2);
    expect(results[2].bestNumber).toBe(3);
    expect(results[3].bestNumber).toBe(4);
  });

  test('支持缺省/断开的集数识别', () => {
    const files = [
      { name: 'Episode 01 [1080p].mkv', path: '/1' },
      { name: 'Episode 02 [1080p].mkv', path: '/2' },
      { name: 'Episode 05 [1080p].mkv', path: '/5' },
      { name: 'Episode 06 [1080p].mkv', path: '/6' },
    ];
    const results = analyzeEpisodes(files);

    expect(results[0].bestNumber).toBe(1);
    expect(results[1].bestNumber).toBe(2);
    expect(results[2].bestNumber).toBe(5);
    expect(results[3].bestNumber).toBe(6);
  });

  test('支持识别原文件名中的 n.n 消歧规则', () => {
    const files = [
      { name: '动漫.S01E01.1.mp4', path: '/1' },
      { name: '动漫.S01E01.2.mp4', path: '/2' },
      { name: '动漫.S01E02.mp4', path: '/3' },
    ];
    const results = analyzeEpisodes(files);

    // 文件 1 和文件 2 都提取出整数序号 1，发生冲突
    // 回查原文件名发现 1.1 和 1.2 的浮点候选，消歧成功
    expect(results[0].bestNumber).toBe(1.1);
    expect(results[1].bestNumber).toBe(1.2);
    expect(results[2].bestNumber).toBe(2);
  });

  test('不强行给重复序号加 .n 后缀', () => {
    // 两个文件的序号确实相同，但原文件名中没有 n.n 模式
    const files = [
      { name: '动漫.EP01.A部分.mp4', path: '/1' },
      { name: '动漫.EP01.B部分.mp4', path: '/2' },
    ];
    const results = analyzeEpisodes(files);

    // 两个文件都应保持 bestNumber = 1，不被强行修改
    expect(results[0].bestNumber).toBe(1);
    expect(results[1].bestNumber).toBe(1);
  });

  test('纯数字文件名能正确识别连续序号', () => {
    const files = Array.from({ length: 12 }, (_, i) => ({
      name: `[SubGroup] Anime - ${String(i + 1).padStart(2, '0')} [720p].mkv`,
      path: `/path/${i + 1}`,
    }));
    const results = analyzeEpisodes(files);

    for (let i = 0; i < 12; i++) {
      expect(results[i].bestNumber).toBe(i + 1);
    }
  });

  test('格式化集数序号补零', () => {
    expect(formatEpisodeNumber(5, 2)).toBe('05');
    expect(formatEpisodeNumber(12, 2)).toBe('12');
    expect(formatEpisodeNumber(5, 3)).toBe('005');
    expect(formatEpisodeNumber(1.2, 2)).toBe('01.2');
    expect(formatEpisodeNumber(12.5, 3)).toBe('012.5');
  });

  test('主人提供的真实用例：小说分享加更与月卡抽奖高干扰文件名识别', () => {
    const files = [
      { name: '【《洪荒二郎传》昨日分享破400，加更2集】太莽01柔情似水（上）.m4a', path: '/1' },
      { name: '【《洪荒二郎传》订阅八千，加更】太莽02上官灵烨，你也有今天.m4a', path: '/2' },
      { name: '【搜新书《洪荒二郎传》抽150张月卡】太莽03现在的年轻人（下）.m4a', path: '/3' },
      { name: '【搜新书《洪荒二郎传》抽150张月卡】太莽04这雪真大，咳——真白.m4a', path: '/4' },
      { name: '【搜新书《洪荒二郎传》抽150张月卡】太莽05我们怎么样了？.m4a', path: '/5' },
      { name: '【搜新书《洪荒二郎传》抽150张月卡}太莽06杯中酒要喝完.m4a', path: '/6' },
      { name: '【搜新书《洪荒二郎传》抽150张月卡】太莽07仇悠悠（上）.m4a', path: '/7' }
    ];
    const results = analyzeEpisodes(files);

    expect(results[0].bestNumber).toBe(1);
    expect(results[1].bestNumber).toBe(2);
    expect(results[2].bestNumber).toBe(3);
    expect(results[3].bestNumber).toBe(4);
    expect(results[4].bestNumber).toBe(5);
    expect(results[5].bestNumber).toBe(6);
    expect(results[6].bestNumber).toBe(7);
  });

});
