import {
  chineseToNumber,
  extractCandidates,
  analyzeEpisodes,
  formatEpisodeNumber,
} from "../episode-detector";

describe("剧集智能识别核心算法测试", () => {
  test("中文数字转换为阿拉伯数字", () => {
    expect(chineseToNumber("三")).toBe(3);
    expect(chineseToNumber("十二")).toBe(12);
    expect(chineseToNumber("三十五")).toBe(35);
    expect(chineseToNumber("一百零五")).toBe(105);
    expect(chineseToNumber("第十四")).toBe(14);
    expect(chineseToNumber("九百九十九")).toBe(999);
    expect(chineseToNumber("贰仟零伍")).toBe(2005);
    expect(chineseToNumber("二〇二六")).toBe(2026);
    expect(chineseToNumber("一亿零二万")).toBe(100020000);
  });

  test("提取文件名中的整数和浮点候选", () => {
    const cands = extractCandidates("Show.01.2.mkv");
    const values = cands.map((c) => c.value);
    // 应包含整数 1, 2，以及浮点 1.2
    expect(values).toContain(1);
    expect(values).toContain(2);
    expect(values).toContain(1.2);
  });

  test("不把 1080p 之类的规格误判为浮点", () => {
    const cands = extractCandidates("Show.01.1080p.mkv");
    const values = cands.map((c) => c.value);
    // 应有整数 1 和 1080，但不应有 1.108 这种浮点
    expect(values).toContain(1);
    expect(values).toContain(1080);
    expect(values.some((v) => v > 1 && v < 2)).toBe(false);
  });

  test("智能排除年份与分辨率等干扰数字", () => {
    const files = [
      { name: "Show.2023.EP01.1080p.mp4", path: "/1" },
      { name: "Show.2023.EP02.1080p.mp4", path: "/2" },
      { name: "Show.2023.EP03.1080p.mp4", path: "/3" },
      { name: "Show.2023.EP04.1080p.mp4", path: "/4" },
    ];
    const results = analyzeEpisodes(files);

    // 2023 和 1080 在每个文件中都出现（100% 重复率），且无特征，应被排除
    expect(results[0].bestNumber).toBe(1);
    expect(results[1].bestNumber).toBe(2);
    expect(results[2].bestNumber).toBe(3);
    expect(results[3].bestNumber).toBe(4);
  });

  test("支持缺省/断开的集数识别", () => {
    const files = [
      { name: "Episode 01 [1080p].mkv", path: "/1" },
      { name: "Episode 02 [1080p].mkv", path: "/2" },
      { name: "Episode 05 [1080p].mkv", path: "/5" },
      { name: "Episode 06 [1080p].mkv", path: "/6" },
    ];
    const results = analyzeEpisodes(files);

    expect(results[0].bestNumber).toBe(1);
    expect(results[1].bestNumber).toBe(2);
    expect(results[2].bestNumber).toBe(5);
    expect(results[3].bestNumber).toBe(6);
  });

  test("支持识别原文件名中的 n.n 消歧规则", () => {
    const files = [
      { name: "动漫.S01E01.1.mp4", path: "/1" },
      { name: "动漫.S01E01.2.mp4", path: "/2" },
      { name: "动漫.S01E02.mp4", path: "/3" },
    ];
    const results = analyzeEpisodes(files);

    // 文件 1 和文件 2 都提取出整数序号 1，发生冲突
    // 回查原文件名发现 1.1 和 1.2 的浮点候选，消歧成功
    expect(results[0].bestNumber).toBe(1.1);
    expect(results[1].bestNumber).toBe(1.2);
    expect(results[2].bestNumber).toBe(2);
  });

  test("不强行给重复序号加 .n 后缀", () => {
    // 两个文件的序号确实相同，但原文件名中没有 n.n 模式
    const files = [
      { name: "动漫.EP01.A部分.mp4", path: "/1" },
      { name: "动漫.EP01.B部分.mp4", path: "/2" },
    ];
    const results = analyzeEpisodes(files);

    // 两个文件都应保持 bestNumber = 1，不被强行修改
    expect(results[0].bestNumber).toBe(1);
    expect(results[1].bestNumber).toBe(1);
  });

  test("原文件名中 001.1 可与 001 共存", () => {
    const results = analyzeEpisodes([
      { name: "demo-001.1.mkv", path: "/1.1" },
      { name: "demo-001.mkv", path: "/1" },
      { name: "demo-002.mkv", path: "/2" },
    ]);

    expect(results.map((item) => item.bestNumber)).toEqual([1.1, 1, 2]);
  });

  test("纯数字文件名能正确识别连续序号", () => {
    const files = Array.from({ length: 12 }, (_, i) => ({
      name: `[SubGroup] Anime - ${String(i + 1).padStart(2, "0")} [720p].mkv`,
      path: `/path/${i + 1}`,
    }));
    const results = analyzeEpisodes(files);

    for (let i = 0; i < 12; i++) {
      expect(results[i].bestNumber).toBe(i + 1);
    }
  });

  test("格式化集数序号补零", () => {
    expect(formatEpisodeNumber(5, 2)).toBe("05");
    expect(formatEpisodeNumber(12, 2)).toBe("12");
    expect(formatEpisodeNumber(5, 3)).toBe("005");
    expect(formatEpisodeNumber(1.2, 2)).toBe("01.2");
    expect(formatEpisodeNumber(12.5, 3)).toBe("012.5");
  });

  test("主人提供的真实用例：小说分享加更与月卡抽奖高干扰文件名识别", () => {
    const files = [
      { name: "【《洪荒二郎传》昨日分享破400，加更2集】太莽01柔情似水（上）.m4a", path: "/1" },
      { name: "【《洪荒二郎传》订阅八千，加更】太莽02上官灵烨，你也有今天.m4a", path: "/2" },
      { name: "【搜新书《洪荒二郎传》抽150张月卡】太莽03现在的年轻人（下）.m4a", path: "/3" },
      { name: "【搜新书《洪荒二郎传》抽150张月卡】太莽04这雪真大，咳——真白.m4a", path: "/4" },
      { name: "【搜新书《洪荒二郎传》抽150张月卡】太莽05我们怎么样了？.m4a", path: "/5" },
      { name: "【搜新书《洪荒二郎传》抽150张月卡}太莽06杯中酒要喝完.m4a", path: "/6" },
      { name: "【搜新书《洪荒二郎传》抽150张月卡】太莽07仇悠悠（上）.m4a", path: "/7" },
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

  test("大于最长连续序列最大值 10 倍的数字视为无效", () => {
    // 最长连续序列为 1..5，最大值 5；上限 50。999 / 1080 应被丢弃。
    const files = [
      { name: "Show.EP01.999.mp4", path: "/1" },
      { name: "Show.EP02.999.mp4", path: "/2" },
      { name: "Show.EP03.1080p.mp4", path: "/3" },
      { name: "Show.EP04.1080p.mp4", path: "/4" },
      { name: "Show.EP05.1080p.mp4", path: "/5" },
    ];
    const results = analyzeEpisodes(files);

    expect(results.map((item) => item.bestNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  test("等于最长连续序列最大值 10 倍的数字仍有效", () => {
    // 连续序列 1..3，上限 30；边界值 30 不应被剔除。
    const files = [
      { name: "Show.01.mp4", path: "/1" },
      { name: "Show.02.mp4", path: "/2" },
      { name: "Show.03.mp4", path: "/3" },
      { name: "Show.30.mp4", path: "/30" },
    ];
    const results = analyzeEpisodes(files);

    expect(results.map((item) => item.bestNumber)).toEqual([1, 2, 3, 30]);
  });

  test("中文章节号优先于标题里的单字中文数字噪声", () => {
    // 用一段连续中文章节号撑起有效上限，再混入标题噪声。
    // 五百xx章 应压过“（二）”“前两天”“一票”；带 章/集 的单字（第一章）仍可用。
    const continuous = [
      "五百三十八",
      "五百三十九",
      "五百四十",
      "五百四十一",
      "五百四十二",
      "五百四十三",
      "五百四十四",
      "五百四十五",
      "五百四十六",
      "五百四十七",
      "五百四十八",
      "五百四十九",
      "五百五十",
      "五百五十一",
    ];
    const files = [
      { name: "赘婿第一章：苏家赘婿.m4a", path: "/1" },
      { name: "赘婿第二章：诗与棋.m4a", path: "/2" },
      { name: "赘婿第三章上：群像.m4a", path: "/3" },
      ...continuous.map((chapter, index) => ({
        name: `赘婿${chapter}章：正文.m4a`,
        path: `/${538 + index}`,
      })),
      {
        name: "赘婿五百三十九章：战地情天 只如初见（前两天过生日，大家久等了）.m4a",
        path: "/539-noise",
      },
      {
        name: "赘婿五百四十五章：宗师之会 吕梁巅峰（二）.m4a",
        path: "/545-noise",
      },
      {
        name: "赘婿五百五十一章：作战名（主播评选活动，麻烦大家帮忙投一票）.m4a",
        path: "/551-noise",
      },
      { name: "赘婿八百五十集：秋风萧瑟 洪波涌起（一）.m4a", path: "/850" },
    ];
    const results = analyzeEpisodes(files);

    expect(results[0].bestNumber).toBe(1);
    expect(results[1].bestNumber).toBe(2);
    expect(results[2].bestNumber).toBe(3);
    expect(results.slice(3, 17).map((item) => item.bestNumber)).toEqual([
      538, 539, 540, 541, 542, 543, 544, 545, 546, 547, 548, 549, 550, 551,
    ]);
    expect(results[17].bestNumber).toBe(539);
    expect(results[18].bestNumber).toBe(545);
    expect(results[19].bestNumber).toBe(551);
    expect(results[20].bestNumber).toBe(850);
  });
});
