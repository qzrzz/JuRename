import { analyzeEpisodes, FileItem } from './episode-detector';

/**
 * 判断直属的一层子文件夹和文件数量是否满足批量文件夹分析的功能判定
 * 规则：如果发现子文件全是文件夹（即 0 个文件，至少 1 个文件夹）或者 3 个以上文件夹、3 个以下文件（即文件夹数量 >= 3 且文件数量 < 3）
 * @param subDirsCount 直属子文件夹数量
 * @param subFilesCount 直属子文件数量
 * @returns 是否被判定为批量文件夹分析功能
 */
export function isBatchDirectory(subDirsCount: number, subFilesCount: number): boolean {
  if (subDirsCount > 0 && subFilesCount === 0) {
    return true;
  }
  if (subDirsCount >= 3 && subFilesCount < 3) {
    return true;
  }
  return false;
}

export interface BatchFolderDisplayFile extends FileItem {
  checked: boolean;
}

export interface BatchFolderResult {
  /** 文件夹唯一标识（绝对路径） */
  id: string;
  /** 文件夹显示名称 */
  folderName: string;
  /** 文件夹绝对路径 */
  folderPath: string;
  /** 子文件夹直属一层的分析文件列表 */
  files: BatchFolderDisplayFile[];
  /** 总文件数 */
  totalCount: number;
  /** 已识别序号数 */
  detectedCount: number;
  /** 连续序号区间 */
  continuousSegments: { start: number; end: number }[];
  /** 缺省序号区间 */
  missingSegments: { start: number; end: number }[];
  /** 缺失序号总数 */
  missingCount: number;
  /** 准备重命名的有效文件数 */
  renameableCount: number;
}

/**
 * 计算分析后的文件列表中连续与缺省序号区间
 * @param files 已分析的文件列表
 */
export function computeEpisodeSegments(files: BatchFolderDisplayFile[]) {
  const sortedFiles = [...files].sort((a, b) => {
    if (isNaN(a.bestNumber) && isNaN(b.bestNumber)) return a.name.localeCompare(b.name);
    if (isNaN(a.bestNumber)) return 1;
    if (isNaN(b.bestNumber)) return -1;
    return a.bestNumber - b.bestNumber;
  });

  const ints = Array.from(
    new Set(sortedFiles.map((f) => Math.floor(f.bestNumber)).filter((n) => !isNaN(n))),
  ).sort((a, b) => a - b);

  const continuous: { start: number; end: number }[] = [];
  if (ints.length > 0) {
    let start = ints[0];
    let end = ints[0];
    for (let idx = 1; idx < ints.length; idx++) {
      if (ints[idx] === end + 1) {
        end = ints[idx];
      } else {
        continuous.push({ start, end });
        start = ints[idx];
        end = ints[idx];
      }
    }
    continuous.push({ start, end });
  }

  const missing: { start: number; end: number }[] = [];
  for (let idx = 0; idx < continuous.length - 1; idx++) {
    const prevEnd = continuous[idx].end;
    const nextStart = continuous[idx + 1].start;
    if (nextStart - prevEnd > 1) {
      missing.push({
        start: prevEnd + 1,
        end: nextStart - 1,
      });
    }
  }

  const missingCount = missing.reduce(
    (total, segment) => total + segment.end - segment.start + 1,
    0,
  );

  return {
    continuousSegments: continuous,
    missingSegments: missing,
    missingCount,
  };
}

/**
 * 分析单个子文件夹中的文件列表并生成批量展示结果
 * @param folderPath 文件夹绝对路径
 * @param folderName 文件夹显示名称
 * @param rawFiles 文件夹直属一层文件列表
 */
export function analyzeBatchFolder(
  folderPath: string,
  folderName: string,
  rawFiles: { name: string; path: string }[],
): BatchFolderResult {
  const analyzed = analyzeEpisodes(rawFiles);
  const displayFiles: BatchFolderDisplayFile[] = analyzed.map((item) => ({
    ...item,
    checked: true,
  }));

  const detectedCount = displayFiles.filter((f) => Number.isFinite(f.bestNumber)).length;
  const renameableCount = displayFiles.filter((f) => f.checked && Number.isFinite(f.bestNumber)).length;
  const { continuousSegments, missingSegments, missingCount } = computeEpisodeSegments(displayFiles);

  return {
    id: folderPath,
    folderName,
    folderPath,
    files: displayFiles,
    totalCount: displayFiles.length,
    detectedCount,
    continuousSegments,
    missingSegments,
    missingCount,
    renameableCount,
  };
}
