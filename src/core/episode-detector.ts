/**
 * 将中文数字转换为阿拉伯数字
 * 支持“零”到“千”，以及“第一十二”等格式
 */
export function chineseToNumber(chnStr: string): number {
  const chnNumChar: { [key: string]: number } = {
    零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
    壹: 1, 贰: 2, 叁: 3, 肆: 4, 伍: 5, 陆: 6, 柒: 7, 捌: 8, 玖: 9
  };
  const chnNameValue: { [key: string]: { value: number, secUnit: boolean } } = {
    十: { value: 10, secUnit: false },
    拾: { value: 10, secUnit: false },
    百: { value: 100, secUnit: false },
    佰: { value: 100, secUnit: false },
    千: { value: 1000, secUnit: false },
    仟: { value: 1000, secUnit: false },
  };

  // 去除前缀，如“第”
  let processedStr = chnStr.replace(/^第/, '');

  if (processedStr.startsWith('十') || processedStr.startsWith('拾')) {
    processedStr = '一' + processedStr;
  }

  let rtn = 0;
  let section = 0;
  let number = 0;
  let secUnit = false;

  for (let i = 0; i < processedStr.length; i++) {
    const char = processedStr[i];
    const num = chnNumChar[char];
    if (typeof num !== 'undefined') {
      number = num;
      if (i === processedStr.length - 1) {
        section += number;
      }
    } else {
      const unit = chnNameValue[char];
      if (typeof unit === 'undefined') {
        continue;
      }
      secUnit = unit.secUnit;
      if (secUnit) {
        section = (section + number) * unit.value;
        rtn += section;
        section = 0;
      } else {
        section += number * unit.value;
      }
      number = 0;
    }
  }
  return rtn + section;
}

export interface Candidate {
  /** 数值 */
  value: number;
  /** 原始匹配文本 */
  raw: string;
  /** 在文件名中的起始位置 */
  index: number;
  /** 是否为由点号连接的浮点数（如 1.5） */
  isFloat: boolean;
  /** 浮点数的整数部分（仅 isFloat 为 true 时有效） */
  intPart: number;
}

export interface FileItem {
  path: string;
  name: string;
  candidates: Candidate[];
  bestNumber: number;
  finalNumberStr: string;
}

/**
 * 从文件名中提取所有可能的数字候选（阿拉伯数字和中文数字）
 * 在剥离扩展名后的文件名上进行提取
 */
export function extractCandidates(filename: string): Candidate[] {
  const candidates: Candidate[] = [];

  // 去掉文件扩展名，避免扩展名中的数字污染候选池
  const dotIdx = filename.lastIndexOf('.');
  const nameWithoutExt = dotIdx > 0 ? filename.substring(0, dotIdx) : filename;

  // 1. 提取所有独立整数段
  const numRegex = /\d+/g;
  const intMatches: { str: string; index: number }[] = [];
  let match;
  while ((match = numRegex.exec(nameWithoutExt)) !== null) {
    intMatches.push({ str: match[0], index: match.index });
  }

  // 先将所有整数作为候选加入
  for (const m of intMatches) {
    candidates.push({
      value: parseInt(m.str, 10),
      raw: m.str,
      index: m.index,
      isFloat: false,
      intPart: parseInt(m.str, 10),
    });
  }

  // 2. 检查相邻整数间是否被单个点号相连，构成 n.n 浮点候选
  for (let k = 0; k < intMatches.length - 1; k++) {
    const curr = intMatches[k];
    const next = intMatches[k + 1];
    const gapStart = curr.index + curr.str.length;
    const gapEnd = next.index;
    const gap = nameWithoutExt.substring(gapStart, gapEnd);

    if (gap !== '.') continue;

    // 排除后面紧跟规格单位的情况（如 1080p, 10bit, 24fps, 48khz）
    const afterNext = nameWithoutExt.substring(next.index + next.str.length, next.index + next.str.length + 4).toLowerCase();
    if (/^(p\b|bit|fps|hz|k\b|x\d)/.test(afterNext)) continue;

    // 排除小数部分过大的（>=100），这通常是分辨率 1920.1080
    const subVal = parseInt(next.str, 10);
    if (subVal >= 100) continue;

    const combinedRaw = `${curr.str}.${next.str}`;
    candidates.push({
      value: parseFloat(combinedRaw),
      raw: combinedRaw,
      index: curr.index,
      isFloat: true,
      intPart: parseInt(curr.str, 10),
    });
  }

  // 3. 提取中文数字
  const chineseRegex = /第?[一二三四五六七八九十百零壹贰叁肆伍陆柒捌玖拾佰千仟]+[集话期页回]?/g;
  while ((match = chineseRegex.exec(nameWithoutExt)) !== null) {
    const pureChn = match[0].replace(/^第/, '').replace(/[集话期页回]$/, '');
    if (pureChn.length > 0) {
      try {
        const val = chineseToNumber(pureChn);
        if (val > 0) {
          candidates.push({
            value: val,
            raw: match[0],
            index: match.index,
            isFloat: false,
            intPart: val,
          });
        }
      } catch {
        // 忽略
      }
    }
  }

  // 按在文件名中的位置排序
  candidates.sort((a, b) => a.index - b.index);
  return candidates;
}

/**
 * 分析文件列表，并为每个文件确定最优的集数序号
 */
export function analyzeEpisodes(files: { name: string; path: string }[]): FileItem[] {
  const N = files.length;
  if (N === 0) return [];

  // 1. 提取各文件候选
  const fileItems: FileItem[] = files.map(file => ({
    path: file.path,
    name: file.name,
    candidates: extractCandidates(file.name),
    bestNumber: NaN,
    finalNumberStr: '',
  }));

  // 2. 统计每个整数值在所有文件中的出现频次（重复率）
  const valueFileCount = new Map<number, number>();
  for (const item of fileItems) {
    const seen = new Set<number>();
    for (const c of item.candidates) {
      if (!c.isFloat) {
        seen.add(c.value);
      }
    }
    for (const v of seen) {
      valueFileCount.set(v, (valueFileCount.get(v) || 0) + 1);
    }
  }

  // 3. 构建连续整数序列，记录各整数所在序列长度
  const allIntSet = new Set<number>();
  for (const item of fileItems) {
    for (const c of item.candidates) {
      if (!c.isFloat && Number.isInteger(c.value)) {
        allIntSet.add(c.value);
      }
    }
  }

  const sortedInts = Array.from(allIntSet).sort((a, b) => a - b);
  const seqLenOf = new Map<number, number>();
  let i = 0;
  while (i < sortedInts.length) {
    let j = i;
    while (j + 1 < sortedInts.length && sortedInts[j + 1] === sortedInts[j] + 1) {
      j++;
    }
    const len = j - i + 1;
    for (let k = i; k <= j; k++) {
      seqLenOf.set(sortedInts[k], len);
    }
    i = j + 1;
  }

  // 4. 对每个文件的整数候选分别计算置信度，取最高分者为 bestNumber
  for (const item of fileItems) {
    const intCandidates = item.candidates.filter(c => !c.isFloat);
    if (intCandidates.length === 0) {
      item.bestNumber = NaN;
      continue;
    }

    // 剥离扩展名
    const dotIdx = item.name.lastIndexOf('.');
    const nameWithoutExt = dotIdx > 0 ? item.name.substring(0, dotIdx) : item.name;

    let maxConf = -Infinity;
    let selected = NaN;
    let selectedIndex = Infinity;

    for (const cand of intCandidates) {
      let conf = 100; // 基础分数

      // (A) 重复率惩罚：出现率 >= 30% 时触发
      const count = valueFileCount.get(cand.value) || 0;
      const repeatRate = count / N;
      if (repeatRate >= 0.3) {
        conf -= repeatRate * 120;
      }

      // (B) 连续性奖励
      const seqLen = seqLenOf.get(cand.value) || 0;
      if (seqLen >= 2) {
        conf += seqLen * 50;
      }

      // (C) 特征词奖励
      const prefix = nameWithoutExt.substring(0, cand.index);
      const suffix = nameWithoutExt.substring(cand.index + cand.raw.length);

      let hasFeature = false;
      // 前缀匹配 E, EP, SP, CH, CAP, X 等
      if (/(\b|[^a-zA-Z])(ep|e|sp|x|ch|cap)\.?$/i.test(prefix)) {
        conf += 50;
        hasFeature = true;
      }
      // 前缀匹配 “第”
      if (/第$/i.test(prefix)) {
        conf += 50;
        hasFeature = true;
      }
      // 后缀匹配 “集”、“话”、“期”、“页”、“回”、“v” 等
      if (/^(集|话|期|页|回|v|ep|episode|chapter)/i.test(suffix)) {
        conf += 50;
        hasFeature = true;
      }
      // 包裹检查 [] () 【】
      if (
        (/\[$/i.test(prefix) && /^\]/i.test(suffix)) ||
        (/\($/i.test(prefix) && /^\)/i.test(suffix)) ||
        (/【$/i.test(prefix) && /^】/i.test(suffix))
      ) {
        conf += 30;
        hasFeature = true;
      }

      // 如果没有任何集数特征词，且它是高频重复的年份或分辨率，进行强力扣分
      if (!hasFeature && (cand.value >= 1900 || cand.value === 1080 || cand.value === 720 || cand.value === 2160)) {
        conf -= 150;
      }

      // 择优选择 (置信度大优先，置信度相同位置早优先)
      if (conf > maxConf || (conf === maxConf && cand.index < selectedIndex)) {
        maxConf = conf;
        selected = cand.value;
        selectedIndex = cand.index;
      }
    }

    item.bestNumber = selected;
  }

  // 5. 冲突消歧 (处理多个文件同序号的情况，回查 n.n)
  const groups = new Map<number, FileItem[]>();
  for (const item of fileItems) {
    if (isNaN(item.bestNumber)) continue;
    const key = item.bestNumber;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  for (const [baseNum, group] of groups) {
    if (group.length <= 1) continue;

    let allResolved = true;
    const floatAssignments = new Map<FileItem, number>();

    for (const item of group) {
      // 查找整数部分为 baseNum 的浮点数候选
      const floatCands = item.candidates.filter(
        c => c.isFloat && c.intPart === baseNum
      );
      if (floatCands.length > 0) {
        floatAssignments.set(item, floatCands[0].value);
      } else {
        allResolved = false;
      }
    }

    if (allResolved) {
      const floatValues = new Set(floatAssignments.values());
      if (floatValues.size === group.length) {
        for (const [item, fv] of floatAssignments) {
          item.bestNumber = fv;
        }
      }
    }
  }

  return fileItems;
}

/**
 * 格式化序号，根据指定的补零位数进行补全
 */
export function formatEpisodeNumber(num: number, paddingWidth: number): string {
  if (isNaN(num)) return '';

  const isFloat = num % 1 !== 0;
  if (!isFloat) {
    return num.toString().padStart(paddingWidth, '0');
  } else {
    const parts = num.toString().split('.');
    const integerPart = parts[0].padStart(paddingWidth, '0');
    const decimalPart = parts[1];
    return `${integerPart}.${decimalPart}`;
  }
}
