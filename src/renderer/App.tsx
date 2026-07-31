/// <reference path="../renderer.d.ts" />
import React, { useState, useEffect, useMemo, useRef } from "react";
import { analyzeEpisodes, formatEpisodeNumber, FileItem } from "../core/episode-detector";
import {
  isBatchDirectory,
  analyzeBatchFolder,
  computeEpisodeSegments,
  BatchFolderResult,
  BatchFolderDisplayFile,
} from "../core/batch-detector";
import { VirtualList } from "./components/VirtualList";
import appIconUrl from "../../icon.png";

type IconName = "spark" | "file" | "folder" | "search" | "trash" | "up" | "down" | "arrow" | "back";

const Icon: React.FC<{ name: IconName; size?: number }> = ({ name, size = 16 }) => {
  const paths: Record<IconName, React.ReactNode> = {
    spark: (
      <>
        <path d="m12 2 1.1 3.9L17 7l-3.9 1.1L12 12l-1.1-3.9L7 7l3.9-1.1L12 2Z" />
        <path d="m5 12 .8 2.2L8 15l-2.2.8L5 18l-.8-2.2L2 15l2.2-.8L5 12Z" />
        <path d="m17.5 13 .7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z" />
      </>
    ),
    file: (
      <>
        <path d="M6 2.75h7l4 4v10.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4.75a2 2 0 0 1 2-2Z" />
        <path d="M13 2.75v4h4M7.5 11h6M7.5 14.5h5" />
      </>
    ),
    folder: (
      <>
        <path d="M2.75 6.5h16.5v9.75a2 2 0 0 1-2 2H4.75a2 2 0 0 1-2-2V6.5Z" />
        <path d="M2.75 7V5.25a2 2 0 0 1 2-2h4l2 2h6.5a2 2 0 0 1 2 2" />
      </>
    ),
    search: (
      <>
        <circle cx="9.5" cy="9.5" r="5.75" />
        <path d="m14 14 4 4" />
      </>
    ),
    trash: (
      <>
        <path d="M4.5 6.5h11M8 3.5h4M6 6.5l.75 11h6.5l.75-11M9 9.5v5M12 9.5v5" />
      </>
    ),
    up: <path d="m6 13 5-5 5 5" />,
    down: <path d="m6 8 5 5 5-5" />,
    arrow: (
      <>
        <path d="M4 11h13M12 6l5 5-5 5" />
      </>
    ),
    back: <path d="M19 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H19v-2z" fill="currentColor" />,
  };

  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 22 22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
};

// 混合列表中可能是文件项，也可能是缺失序号提示占位项
type MixListItem =
  | { isMissingPlaceholder: false; file: BatchFolderDisplayFile }
  | { isMissingPlaceholder: true; start: number; end: number; length: number };

type RenamePhase = "idle" | "running" | "completed";

interface RenameResultItem {
  oldPath: string;
  newPath: string;
  oldName: string;
  newName: string;
  status: "success" | "failed";
  error?: string;
}

type ViewMode = "single" | "batch-list" | "batch-detail";

const SEPARATOR_OPTIONS = [
  { value: "-", label: "短横线", preview: "-" },
  { value: "·", label: "间隔点", preview: "·" },
  { value: "_", label: "下划线", preview: "_" },
  { value: "—", label: "长横线", preview: "—" },
  { value: ".", label: "英文句点", preview: "." },
  { value: " ", label: "空格", preview: "Space" },
];

export const App: React.FC = () => {
  const supportsPathDrop = window.electronAPI.supportsPathDrop !== false;

  // 视图模式与批量分析状态
  const [viewMode, setViewMode] = useState<ViewMode>("single");
  const [batchFolders, setBatchFolders] = useState<BatchFolderResult[]>([]);
  const [activeBatchFolderId, setActiveBatchFolderId] = useState<string | null>(null);

  // 单文件夹 / 当前详细查看文件夹的文件列表
  const [files, setFiles] = useState<BatchFolderDisplayFile[]>([]);
  const [separator, setSeparator] = useState<string>("-");
  const [keyword, setKeyword] = useState<string>("");

  // 搜索与定位状态
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [currentSearchIndex, setCurrentSearchIndex] = useState<number>(-1);
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [renamePhase, setRenamePhase] = useState<RenamePhase>("idle");
  const [renameTotal, setRenameTotal] = useState(0);
  const [renameResults, setRenameResults] = useState<RenameResultItem[]>([]);
  const [currentRenameName, setCurrentRenameName] = useState("");
  const [separatorMenuOpen, setSeparatorMenuOpen] = useState(false);

  const scrollToIndexRef = useRef<((index: number) => void) | null>(null);
  const separatorControlRef = useRef<HTMLDivElement>(null);

  // 计算当前查看文件的补零宽度，最小 2 位
  const paddingWidth = useMemo(() => {
    if (files.length === 0) return 2;
    let maxVal = 0;
    for (const f of files) {
      if (!isNaN(f.bestNumber)) {
        const intPart = Math.floor(f.bestNumber);
        if (intPart > maxVal) maxVal = intPart;
      }
    }
    return Math.max(2, maxVal.toString().length);
  }, [files]);

  useEffect(() => {
    const closeSeparatorMenu = (event: MouseEvent) => {
      if (!separatorControlRef.current?.contains(event.target as Node)) {
        setSeparatorMenuOpen(false);
      }
    };
    const closeSeparatorMenuWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSeparatorMenuOpen(false);
    };
    document.addEventListener("mousedown", closeSeparatorMenu);
    document.addEventListener("keydown", closeSeparatorMenuWithKeyboard);
    return () => {
      document.removeEventListener("mousedown", closeSeparatorMenu);
      document.removeEventListener("keydown", closeSeparatorMenuWithKeyboard);
    };
  }, []);

  // 从绝对路径中截取文件名与目录
  const splitPath = (fullPath: string) => {
    const lastSlash = Math.max(fullPath.lastIndexOf("/"), fullPath.lastIndexOf("\\"));
    const dir = fullPath.substring(0, lastSlash + 1);
    const name = fullPath.substring(lastSlash + 1);
    return { dir, name };
  };

  // 重新对文件集合进行智能序号检测
  const reAnalyzeFiles = (currentFiles: { name: string; path: string; checked?: boolean }[]) => {
    const analyzed = analyzeEpisodes(currentFiles);
    return analyzed.map((item, idx) => {
      const prevChecked = currentFiles[idx]?.checked !== false;
      return {
        ...item,
        checked: prevChecked,
      };
    });
  };

  // 当在 batch-detail 试图下同步更新当前文件夹的修改回 batchFolders
  const syncCurrentFilesToBatch = (updatedFiles: BatchFolderDisplayFile[]) => {
    if (!activeBatchFolderId) return;
    setBatchFolders((prev) =>
      prev.map((folder) => {
        if (folder.id === activeBatchFolderId) {
          const detectedCount = updatedFiles.filter((f) => Number.isFinite(f.bestNumber)).length;
          const renameableCount = updatedFiles.filter((f) => f.checked && Number.isFinite(f.bestNumber)).length;
          const { continuousSegments, missingSegments, missingCount } = computeEpisodeSegments(updatedFiles);
          return {
            ...folder,
            files: updatedFiles,
            totalCount: updatedFiles.length,
            detectedCount,
            renameableCount,
            continuousSegments,
            missingSegments,
            missingCount,
          };
        }
        return folder;
      })
    );
  };

  // 扫描与判定逻辑：入口
  const processSelectedPaths = async (paths: string[]) => {
    if (paths.length === 0 || renamePhase === "running") return;

    try {
      // 1. 如果只传入了 1 个路径且是文件夹，先检查直属一层项
      if (paths.length === 1) {
        const inspect = await window.electronAPI.inspectDirectory(paths[0]);
        if (inspect) {
          const { subDirs, subFiles } = inspect;
          // 判定规则：子文件全是文件夹（subDirs > 0 且 subFiles == 0）或 3个以上文件夹、3个以下文件
          if (isBatchDirectory(subDirs.length, subFiles.length)) {
            await loadBatchFolders(subDirs);
            return;
          }
        }
      } else if (paths.length > 1) {
        // 如果同时拖入了多个路径，检查其中是否主要是文件夹，若全为/多数为文件夹则走批量
        const subDirs: { name: string; path: string }[] = [];
        for (const p of paths) {
          const { name } = splitPath(p);
          subDirs.push({ name, path: p });
        }
        await loadBatchFolders(subDirs);
        return;
      }

      // 2. 传统单文件夹模式
      setViewMode("single");
      setBatchFolders([]);
      setActiveBatchFolderId(null);
      await openPathsAsSingleTask(paths);
    } catch (err) {
      console.error("处理选择路径出错:", err);
      // 降级为单文件夹尝试
      setViewMode("single");
      await openPathsAsSingleTask(paths);
    }
  };

  // 加载并分析批量子文件夹（仅一层，无递归嵌套）
  const loadBatchFolders = async (subDirs: { name: string; path: string }[]) => {
    const results: BatchFolderResult[] = [];
    for (const dir of subDirs) {
      try {
        const rawPaths = await window.electronAPI.readDirectoryFlat(dir.path);
        const rawFiles = rawPaths.map((p) => ({
          name: splitPath(p).name,
          path: p,
        }));
        const folderResult = analyzeBatchFolder(dir.path, dir.name, rawFiles);
        results.push(folderResult);
      } catch (err) {
        console.error(`读取子文件夹 ${dir.name} 失败:`, err);
      }
    }

    setBatchFolders(results);
    setActiveBatchFolderId(null);
    setViewMode("batch-list");
    setFiles([]);
    setKeyword("");
    setSearchResults([]);
    setCurrentSearchIndex(-1);
    setRenamePhase("idle");
    setRenameTotal(0);
    setRenameResults([]);
    setCurrentRenameName("");
  };

  // 作为传统单任务打开
  const openPathsAsSingleTask = async (paths: string[]) => {
    const expandedPaths = await window.electronAPI.scanPaths(paths);
    const newBaseFiles = expandedPaths.map((p: string) => {
      const { name } = splitPath(p);
      return { name, path: p, checked: true };
    });
    const uniqueMap = new Map<string, (typeof newBaseFiles)[0]>();
    newBaseFiles.forEach((file) => uniqueMap.set(file.path, file));

    setFiles(reAnalyzeFiles(Array.from(uniqueMap.values())));
    setKeyword("");
    setSearchResults([]);
    setCurrentSearchIndex(-1);
    setRenamePhase("idle");
    setRenameTotal(0);
    setRenameResults([]);
    setCurrentRenameName("");
  };

  // 点击“打开文件夹”
  const handleOpenDirectory = async () => {
    if (renamePhase === "running") return;
    try {
      const dir = await window.electronAPI.selectDirectory();
      if (dir) {
        await processSelectedPaths([dir]);
      }
    } catch (error) {
      console.error("打开文件夹失败:", error);
    }
  };

  // 进入某个子文件夹的详细分析页面
  const enterBatchDetail = (folder: BatchFolderResult) => {
    setActiveBatchFolderId(folder.id);
    setFiles(folder.files);
    setViewMode("batch-detail");
    setKeyword("");
    setSearchResults([]);
    setCurrentSearchIndex(-1);
  };

  // 从详细分析页面返回到批量文件夹列表
  const backToBatchList = () => {
    setViewMode("batch-list");
    setActiveBatchFolderId(null);
    setFiles([]);
  };

  // 改变文件勾选状态
  const toggleFileChecked = (index: number) => {
    setFiles((prev) => {
      const next = [...prev];
      if (next[index]) {
        next[index].checked = !next[index].checked;
      }
      if (viewMode === "batch-detail") {
        syncCurrentFilesToBatch(next);
      }
      return next;
    });
  };

  // 全选 / 取消全选
  const isAllChecked = files.length > 0 && files.every((f) => f.checked);
  const toggleAllChecked = () => {
    setFiles((prev) => {
      const target = !isAllChecked;
      const next = prev.map((f) => ({ ...f, checked: target }));
      if (viewMode === "batch-detail") {
        syncCurrentFilesToBatch(next);
      }
      return next;
    });
  };

  // 清空列表
  const clearList = () => {
    if (renamePhase !== "idle") return;
    setFiles([]);
    setBatchFolders([]);
    setActiveBatchFolderId(null);
    setViewMode("single");
    setKeyword("");
    setSearchResults([]);
    setCurrentSearchIndex(-1);
    setRenameResults([]);
    setRenameTotal(0);
  };

  const returnToStart = () => {
    if (renamePhase !== "completed") return;
    setFiles([]);
    setBatchFolders([]);
    setActiveBatchFolderId(null);
    setViewMode("single");
    setKeyword("");
    setSearchResults([]);
    setCurrentSearchIndex(-1);
    setRenamePhase("idle");
    setRenameTotal(0);
    setRenameResults([]);
    setCurrentRenameName("");
  };

  // 排序文件列表：按提取出的序号升序
  const sortedFiles = useMemo(() => {
    return [...files].sort((a, b) => {
      if (isNaN(a.bestNumber) && isNaN(b.bestNumber)) return a.name.localeCompare(b.name);
      if (isNaN(a.bestNumber)) return 1;
      if (isNaN(b.bestNumber)) return -1;
      return a.bestNumber - b.bestNumber;
    });
  }, [files]);

  // 生成包含缺失序号指示行的 mixList
  const mixList = useMemo(() => {
    const list: MixListItem[] = [];
    if (sortedFiles.length === 0) return list;

    let prevInt = NaN;
    sortedFiles.forEach((file) => {
      const currentInt = Math.floor(file.bestNumber);
      if (!isNaN(currentInt)) {
        if (!isNaN(prevInt) && currentInt - prevInt > 1) {
          list.push({
            isMissingPlaceholder: true,
            start: prevInt + 1,
            end: currentInt - 1,
            length: currentInt - prevInt - 1,
          });
        }
        prevInt = currentInt;
      }
      list.push({
        isMissingPlaceholder: false,
        file,
      });
    });

    return list;
  }, [sortedFiles]);

  // 计算当前查看文件的连续与缺省段
  const { continuousSegments, missingSegments } = useMemo(() => {
    return computeEpisodeSegments(files);
  }, [files]);

  // 全局拖放支持
  useEffect(() => {
    if (!supportsPathDrop) return;

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (renamePhase === "running") return;
      setDragActive(true);
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.clientX === 0 && e.clientY === 0) {
        setDragActive(false);
      }
    };

    const handleDropEvent = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      if (renamePhase === "running") return;

      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const paths: string[] = [];
        for (let i = 0; i < e.dataTransfer.files.length; i++) {
          const file = e.dataTransfer.files[i];
          const fPath = window.electronAPI.getFilePath(file);
          if (fPath) paths.push(fPath);
        }
        await processSelectedPaths(paths);
      }
    };

    window.addEventListener("dragover", handleDragOver, false);
    window.addEventListener("dragleave", handleDragLeave, false);
    window.addEventListener("drop", handleDropEvent, false);

    return () => {
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDropEvent);
    };
  }, [renamePhase, supportsPathDrop]);

  // 搜索过滤
  useEffect(() => {
    if (!keyword) {
      setSearchResults([]);
      setCurrentSearchIndex(-1);
      return;
    }

    const results: number[] = [];
    const lowerKeyword = keyword.toLowerCase();

    mixList.forEach((item, idx) => {
      if (!item.isMissingPlaceholder) {
        const formattedNum = formatEpisodeNumber(item.file.bestNumber, paddingWidth);
        const newName = `${formattedNum}${separator}${item.file.name}`;
        if (
          item.file.name.toLowerCase().includes(lowerKeyword) ||
          newName.toLowerCase().includes(lowerKeyword)
        ) {
          results.push(idx);
        }
      }
    });

    setSearchResults(results);
    setCurrentSearchIndex(results.length > 0 ? 0 : -1);
  }, [keyword, mixList, paddingWidth, separator]);

  const handleSearchNext = () => {
    if (searchResults.length === 0) return;
    setCurrentSearchIndex((prev) => (prev + 1) % searchResults.length);
  };

  const handleSearchPrev = () => {
    if (searchResults.length === 0) return;
    setCurrentSearchIndex((prev) => (prev - 1 + searchResults.length) % searchResults.length);
  };

  const scrollToSegment = (startVal: number, isMissing: boolean) => {
    if (!scrollToIndexRef.current) return;
    const targetIdx = mixList.findIndex((item) => {
      if (isMissing) {
        return item.isMissingPlaceholder && item.start === startVal;
      } else {
        return !item.isMissingPlaceholder && Math.floor(item.file.bestNumber) === startVal;
      }
    });
    if (targetIdx !== -1) {
      scrollToIndexRef.current(targetIdx);
    }
  };

  // 执行单文件夹或当前视图下的物理重命名
  const handleRename = async () => {
    const renames = files
      .filter((f) => f.checked && !isNaN(f.bestNumber))
      .map((f) => {
        const { dir } = splitPath(f.path);
        const formattedNum = formatEpisodeNumber(f.bestNumber, paddingWidth);
        const newName = `${formattedNum}${separator}${f.name}`;
        return {
          oldPath: f.path,
          newPath: `${dir}${newName}`,
          oldName: f.name,
          newName,
        };
      });

    if (renames.length === 0 || renamePhase !== "idle") return;

    const confirmText = `确定要批量重命名这 ${renames.length} 个文件吗？此操作无法撤销。`;
    if (!confirm(confirmText)) return;

    setRenameTotal(renames.length);
    setRenameResults([]);
    setRenamePhase("running");

    for (const rename of renames) {
      setCurrentRenameName(rename.newName);
      let resultItem: RenameResultItem;
      try {
        const result = await window.electronAPI.renameFile({
          oldPath: rename.oldPath,
          newPath: rename.newPath,
        });
        resultItem = {
          ...rename,
          status: result.success ? "success" : "failed",
          error: result.error,
        };
      } catch (error) {
        resultItem = {
          ...rename,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
      }
      setRenameResults((previous) => [...previous, resultItem]);
    }

    setCurrentRenameName("");
    setRenamePhase("completed");
  };

  // 在批量列表模式下，一键重命名所有已分析子文件夹中勾选的文件
  const handleBatchRenameAll = async () => {
    if (batchFolders.length === 0 || renamePhase !== "running" && renamePhase === "completed") return;

    const allRenames: { oldPath: string; newPath: string; oldName: string; newName: string }[] = [];
    batchFolders.forEach((folder) => {
      // 算出该文件夹的补零宽度
      let maxVal = 0;
      folder.files.forEach((f) => {
        if (!isNaN(f.bestNumber)) {
          const intPart = Math.floor(f.bestNumber);
          if (intPart > maxVal) maxVal = intPart;
        }
      });
      const folderPadding = Math.max(2, maxVal.toString().length);

      folder.files.forEach((f) => {
        if (f.checked && !isNaN(f.bestNumber)) {
          const { dir } = splitPath(f.path);
          const formattedNum = formatEpisodeNumber(f.bestNumber, folderPadding);
          const newName = `${formattedNum}${separator}${f.name}`;
          allRenames.push({
            oldPath: f.path,
            newPath: `${dir}${newName}`,
            oldName: f.name,
            newName,
          });
        }
      });
    });

    if (allRenames.length === 0) return;

    const confirmText = `确定要一键重命名所有 ${batchFolders.length} 个子文件夹中的 ${allRenames.length} 个文件吗？此操作无法撤销。`;
    if (!confirm(confirmText)) return;

    setRenameTotal(allRenames.length);
    setRenameResults([]);
    setRenamePhase("running");

    for (const rename of allRenames) {
      setCurrentRenameName(rename.newName);
      let resultItem: RenameResultItem;
      try {
        const result = await window.electronAPI.renameFile({
          oldPath: rename.oldPath,
          newPath: rename.newPath,
        });
        resultItem = {
          ...rename,
          status: result.success ? "success" : "failed",
          error: result.error,
        };
      } catch (error) {
        resultItem = {
          ...rename,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
      }
      setRenameResults((prev) => [...prev, resultItem]);
    }

    setCurrentRenameName("");
    setRenamePhase("completed");
  };

  const renderListItem = (item: MixListItem, index: number) => {
    if (item.isMissingPlaceholder) {
      return (
        <div className="missing-item" id={`item-${index}`}>
          <span className="missing-text">
            ⚠️ 缺少序号 {item.start} - {item.end} ({item.length}集)
          </span>
        </div>
      );
    }

    const { file } = item;
    const rawIndex = files.findIndex((f) => f.path === file.path);
    const formattedNum = formatEpisodeNumber(file.bestNumber, paddingWidth);

    return (
      <div className="file-item" id={`item-${index}`}>
        <button
          className={`checkbox-custom ${file.checked ? "checked" : ""}`}
          onClick={() => toggleFileChecked(rawIndex)}
          id={`chk-${index}`}
          aria-label={file.checked ? `取消选择 ${file.name}` : `选择 ${file.name}`}
        />
        <div
          className="file-name-text preview-name"
          title={`${formattedNum}${separator}${file.name}`}
        >
          {Number.isFinite(file.bestNumber) ? (
            <span className="episode-highlight">
              {formattedNum}
              {separator}
            </span>
          ) : (
            <span className="episode-unresolved">未识别</span>
          )}
          <span className="filename-tail">{file.name}</span>
        </div>
      </div>
    );
  };

  const renderRenameResult = (item: RenameResultItem) => (
    <div className={`rename-result-item ${item.status}`} title={item.error || item.newName}>
      <span className="rename-result-status" aria-hidden="true">
        {item.status === "success" ? "✓" : "!"}
      </span>
      <div className="rename-result-names">
        <span className="rename-result-new">{item.newName}</span>
        <span className="rename-result-old">原文件：{item.oldName}</span>
      </div>
      <span className="rename-result-label">{item.status === "success" ? "成功" : "失败"}</span>
      {item.error && <span className="rename-result-error">{item.error}</span>}
    </div>
  );

  const activeHighlightIndex = useMemo(() => {
    if (currentSearchIndex >= 0 && searchResults[currentSearchIndex] !== undefined) {
      return searchResults[currentSearchIndex];
    }
    return null;
  }, [currentSearchIndex, searchResults]);

  const selectedCount = files.filter((file) => file.checked).length;
  const detectedCount = files.filter((file) => Number.isFinite(file.bestNumber)).length;
  const renameableCount = files.filter(
    (file) => file.checked && Number.isFinite(file.bestNumber),
  ).length;
  const missingCount = missingSegments.reduce(
    (total, segment) => total + segment.end - segment.start + 1,
    0,
  );
  const renameSuccessCount = renameResults.filter((result) => result.status === "success").length;
  const renameFailureCount = renameResults.length - renameSuccessCount;
  const renameProgress =
    renameTotal === 0 ? 0 : Math.round((renameResults.length / renameTotal) * 100);

  // 批量数据统计
  const batchTotalFiles = batchFolders.reduce((acc, f) => acc + f.totalCount, 0);
  const batchDetectedFiles = batchFolders.reduce((acc, f) => acc + f.detectedCount, 0);
  const batchMissingTotal = batchFolders.reduce((acc, f) => acc + f.missingCount, 0);
  const batchRenameableTotal = batchFolders.reduce((acc, f) => acc + f.renameableCount, 0);

  return (
    <main className="app-container">
      {window.electronAPI.closeApp && (
        <button
          className="deno-close-button"
          onClick={() => window.electronAPI.closeApp?.()}
          id="btn-close-app"
          aria-label="退出应用"
        >
          ×
        </button>
      )}

      {/* 拖拽全屏发光覆盖层 */}
      {supportsPathDrop && dragActive && (
        <div className="drag-overlay">
          <div className="drag-overlay-card">
            <div className="drag-overlay-icon">
              <Icon name="folder" size={34} />
            </div>
            <div className="drag-overlay-text">松开即可开始识别</div>
            <div className="drag-overlay-subtext">支持单集文件夹与批量子文件夹拖入分析</div>
          </div>
        </div>
      )}

      {/* 头部控制栏 */}
      <header className="header-bar">
        {viewMode === "batch-detail" ? (
          <div className="batch-breadcrumb">
            <button
              className="btn-back-batch"
              onClick={backToBatchList}
              id="btn-back-to-batch"
              aria-label="返回批量文件夹列表"
            >
              <Icon name="back" size={14} />
              返回批量列表
            </button>
            <div className="batch-detail-title-group">
              <h1 className="header-title" style={{ fontSize: 16 }}>
                {batchFolders.find((f) => f.id === activeBatchFolderId)?.folderName || "文件夹详情"}
              </h1>
              <span className="header-subtitle">批量文件夹分析 - 单项详细列表</span>
            </div>
          </div>
        ) : (
          <div className="header-title-section">
            <div className="brand-mark">
              <img src={appIconUrl} alt="" />
            </div>
            <div>
              <h1 className="header-title">JuRename</h1>
              <span className="header-subtitle">
                {viewMode === "batch-list" ? "批量文件夹分析模式" : "让文件名有正确序号"}
              </span>
            </div>
          </div>
        )}

        <div className="controls-wrapper">
          {(files.length > 0 || batchFolders.length > 0) && renamePhase === "idle" && (
            <>
              <div className="separator-combobox" ref={separatorControlRef}>
                <div className={`input-group separator-control ${separatorMenuOpen ? "open" : ""}`}>
                  <span className="input-label">分隔符</span>
                  <input
                    type="text"
                    className="input-field input-width-md"
                    value={separator}
                    onChange={(event) => setSeparator(event.target.value)}
                    onFocus={() => setSeparatorMenuOpen(true)}
                    id="input-separator"
                    aria-label="新文件名分隔符"
                    aria-expanded={separatorMenuOpen}
                    aria-controls="separator-options"
                    role="combobox"
                  />
                  <button
                    type="button"
                    className="separator-menu-trigger"
                    onClick={() => setSeparatorMenuOpen((open) => !open)}
                    aria-label="选择预设分隔符"
                    aria-expanded={separatorMenuOpen}
                  >
                    <Icon name="down" size={13} />
                  </button>
                </div>
                {separatorMenuOpen && (
                  <div className="separator-options" id="separator-options" role="listbox">
                    {SEPARATOR_OPTIONS.map((option) => (
                      <button
                        type="button"
                        key={option.label}
                        className={`separator-option ${separator === option.value ? "selected" : ""}`}
                        onClick={() => {
                          setSeparator(option.value);
                          setSeparatorMenuOpen(false);
                        }}
                        role="option"
                        aria-selected={separator === option.value}
                      >
                        <span className="separator-preview">{option.preview}</span>
                        <span>{option.label}</span>
                        {separator === option.value && (
                          <span className="separator-selected-mark">✓</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {viewMode !== "batch-list" && (
                <div className="search-control">
                  <Icon name="search" size={15} />
                  <input
                    type="text"
                    className="input-field search-field"
                    placeholder="搜索文件名"
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    id="input-search"
                    aria-label="搜索文件名"
                  />
                  {keyword && (
                    <span className="search-count">
                      {searchResults.length
                        ? `${currentSearchIndex + 1}/${searchResults.length}`
                        : "0"}
                    </span>
                  )}
                  {searchResults.length > 0 && (
                    <div className="search-nav">
                      <button
                        className="icon-btn"
                        onClick={handleSearchPrev}
                        id="btn-search-prev"
                        aria-label="上一个搜索结果"
                      >
                        <Icon name="up" size={14} />
                      </button>
                      <button
                        className="icon-btn"
                        onClick={handleSearchNext}
                        id="btn-search-next"
                        aria-label="下一个搜索结果"
                      >
                        <Icon name="down" size={14} />
                      </button>
                    </div>
                  )}
                </div>
              )}

              <button className="btn btn-quiet" onClick={clearList} id="btn-clear-list">
                <Icon name="trash" size={15} />
                清空
              </button>
              <span className="control-divider" />
            </>
          )}

          {renamePhase !== "idle" && (
            <span className={`task-status-badge ${renamePhase}`}>
              <i />
              {renamePhase === "running"
                ? `正在处理 ${renameResults.length + 1}/${renameTotal}`
                : "任务已完成"}
            </span>
          )}

          <button
            className="btn btn-primary"
            onClick={handleOpenDirectory}
            disabled={renamePhase === "running"}
            id="btn-open-folder"
          >
            <Icon name="folder" size={15} />
            打开文件夹
          </button>
        </div>
      </header>
      <div className="drag-bk"></div>

      {/* 主视图展示区域 */}
      <section className={`list-container ${dragActive ? "drag-active" : ""}`}>
        {files.length === 0 && batchFolders.length === 0 ? (
          /* 初始拖放 / 空面板 */
          <div className="dropzone" id="div-dropzone">
            <div className="dropzone-content">
              <div className="dropzone-visual">
                <span className="visual-card visual-card-back">
                  <Icon name="file" size={25} />
                </span>
                <span className="visual-card visual-card-front">
                  <Icon name="folder" size={29} />
                </span>
                <span className="visual-spark">
                  <Icon name="spark" size={17} />
                </span>
              </div>
              <span className="dropzone-eyebrow">智能序号与批量分析</span>
              <h2 className="dropzone-title">把杂乱文件与文件夹，整理成正确顺序</h2>
              <p className="dropzone-subtext">
                {supportsPathDrop
                  ? "拖入单剧集文件、整个文件夹或包含多季/多剧集的总文件夹，JuRename 将自动识别并生成安全的重命名预览。"
                  : "选择剧集文件夹，JuRename 会提取连续序号并生成安全的重命名预览。"}
              </p>
              <div className="dropzone-actions">
                <button
                  className="btn btn-primary btn-large"
                  onClick={handleOpenDirectory}
                  id="btn-empty-folder"
                >
                  <Icon name="folder" size={17} />
                  打开文件夹
                </button>
              </div>
              {supportsPathDrop && <span className="drop-hint">或直接拖放到窗口任意位置</span>}
            </div>
            <div className="feature-strip">
              <span>
                <i>01</i>连续数字优先
              </span>
              <span>
                <i>📁</i>批量文件夹分析
              </span>
              <span>
                <i>二</i>支持中文数字
              </span>
              <span>
                <i>.1</i>保留子序号
              </span>
            </div>
          </div>
        ) : renamePhase !== "idle" ? (
          /* 重命名执行与完成阶段 */
          <div className="rename-workspace" aria-live="polite">
            <div className="rename-progress-header">
              <div>
                <span className={`rename-phase-mark ${renamePhase}`}>
                  {renamePhase === "running" ? (
                    <span className="rename-spinner" />
                  ) : renameFailureCount > 0 ? (
                    "!"
                  ) : (
                    "✓"
                  )}
                </span>
                <div className="rename-progress-copy">
                  <h2>
                    {renamePhase === "running"
                      ? "正在重命名"
                      : renameFailureCount > 0
                        ? "重命名完成，部分文件失败"
                        : "重命名完成"}
                  </h2>
                  <p>
                    {renamePhase === "running"
                      ? `正在处理：${currentRenameName}`
                      : `成功 ${renameSuccessCount} 个${renameFailureCount > 0 ? `，失败 ${renameFailureCount} 个` : "，所有文件均已处理"}`}
                  </p>
                </div>
              </div>
              <strong className="rename-progress-percent">{renameProgress}%</strong>
            </div>

            <div
              className="rename-progress-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={renameTotal}
              aria-valuenow={renameResults.length}
            >
              <span style={{ width: `${renameProgress}%` }} />
            </div>

            <div className="rename-progress-meta">
              <span>
                总进度{" "}
                <strong>
                  {renameResults.length} / {renameTotal}
                </strong>
              </span>
              <div>
                <span className="success">成功 {renameSuccessCount}</span>
                <span className={renameFailureCount > 0 ? "failed" : ""}>
                  失败 {renameFailureCount}
                </span>
              </div>
            </div>

            <div className="rename-results-header">
              <strong>处理记录</strong>
              <span>
                {renamePhase === "running"
                  ? "完成一项即显示一项"
                  : "任务已经结束，不能再次执行重命名"}
              </span>
            </div>
            <div className="rename-results-list">
              {renameResults.length === 0 ? (
                <div className="rename-results-empty">正在准备第一个文件…</div>
              ) : (
                <VirtualList
                  items={renameResults}
                  itemHeight={54}
                  highlightIndex={renamePhase === "running" ? renameResults.length - 1 : null}
                  scrollBehavior="auto"
                  renderItem={renderRenameResult}
                />
              )}
            </div>
          </div>
        ) : viewMode === "batch-list" ? (
          /* 批量文件夹分析结果列表界面 */
          <div className="batch-container">
            {/* 批量总体统计数据 Bar */}
            <div className="batch-summary-strip">
              <div className="batch-summary-card">
                <strong>{batchFolders.length}</strong>
                <span>子文件夹数</span>
              </div>
              <div className="batch-summary-card">
                <strong>{batchTotalFiles}</strong>
                <span>文件总数</span>
              </div>
              <div className="batch-summary-card">
                <strong>{batchDetectedFiles} / {batchTotalFiles}</strong>
                <span>序号识别数</span>
              </div>
              <div className={`batch-summary-card ${batchMissingTotal > 0 ? "has-warning" : ""}`}>
                <strong>{batchMissingTotal}</strong>
                <span>缺省序号集数</span>
              </div>
            </div>

            {/* 各个子文件夹分析卡片网格列表 */}
            <div className="batch-folder-grid">
              {batchFolders.map((folder) => (
                <div
                  key={folder.id}
                  className="batch-folder-card"
                  onClick={() => enterBatchDetail(folder)}
                >
                  <div>
                    <div className="batch-folder-header">
                      <div className="batch-folder-title-wrapper">
                        <span className="batch-folder-icon">
                          <Icon name="folder" size={18} />
                        </span>
                        <div className="batch-folder-info">
                          <div className="batch-folder-title" title={folder.folderName}>
                            {folder.folderName}
                          </div>
                          <div className="batch-folder-path" title={folder.folderPath}>
                            {folder.folderPath}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`batch-folder-badge ${
                          folder.missingCount > 0 ? "warning" : "success"
                        }`}
                      >
                        {folder.missingCount > 0
                          ? `缺少 ${folder.missingCount} 集`
                          : "序号完整"}
                      </span>
                    </div>

                    <div className="batch-folder-segments" style={{ marginTop: 12 }}>
                      <div className="batch-segment-line">
                        <span className="batch-segment-label">连续序号:</span>
                        <div className="batch-pills">
                          {folder.continuousSegments.length === 0 ? (
                            <span className="info-empty">无</span>
                          ) : (
                            folder.continuousSegments.map((seg, i) => (
                              <span key={i} className="pill pill-success">
                                {seg.start === seg.end ? `${seg.start}` : `${seg.start}-${seg.end}`}
                              </span>
                            ))
                          )}
                        </div>
                      </div>

                      {folder.missingSegments.length > 0 && (
                        <div className="batch-segment-line">
                          <span className="batch-segment-label">缺省序号:</span>
                          <div className="batch-pills">
                            {folder.missingSegments.map((seg, i) => (
                              <span key={i} className="pill pill-danger">
                                {seg.start === seg.end ? `${seg.start}` : `${seg.start}-${seg.end}`}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="batch-folder-footer">
                    <span className="batch-file-count">
                      已识别 {folder.detectedCount}/{folder.totalCount} 个文件
                    </span>
                    <button
                      type="button"
                      className="btn-detail-link"
                      onClick={(e) => {
                        e.stopPropagation();
                        enterBatchDetail(folder);
                      }}
                    >
                      详细结果 <Icon name="arrow" size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* 单文件夹视图 或 子文件夹详细分析视图 */
          <div className="list-layout">
            <div className="list-toolbar">
              <button
                className={`checkbox-custom ${isAllChecked ? "checked" : ""}`}
                onClick={toggleAllChecked}
                id="chk-select-all"
                aria-label={isAllChecked ? "取消全选" : "全选"}
              />
              <div className="list-summary">
                <strong>{files.length} 个文件</strong>
                <span>已选择 {selectedCount} 个</span>
              </div>
              <div className="column-labels">
                <span>重命名预览</span>
              </div>
            </div>

            <div style={{ flex: 1, overflow: "hidden" }}>
              <VirtualList
                items={mixList}
                itemHeight={44}
                highlightIndex={activeHighlightIndex}
                scrollToIndexRef={scrollToIndexRef}
                renderItem={renderListItem}
              />
            </div>
          </div>
        )}
      </section>

      {/* 底部控制与信息栏 */}
      {(files.length > 0 || batchFolders.length > 0) && (
        <footer className="footer-section">
          {viewMode === "batch-list" ? (
            /* 批量列表底栏 */
            <div className="info-bar" id="div-info-bar">
              <div className="info-summary">
                <div>
                  <strong>{batchFolders.length}</strong>
                  <span>分析文件夹</span>
                </div>
                <div>
                  <strong>{batchDetectedFiles}</strong>
                  <span>已识别文件</span>
                </div>
                <div className={batchMissingTotal > 0 ? "has-missing" : ""}>
                  <strong>{batchMissingTotal}</strong>
                  <span>缺失集数</span>
                </div>
              </div>
              <div className="info-row">
                <span className="info-label">批量说明</span>
                <span className="info-empty" style={{ fontSize: 12 }}>
                  点击任意文件夹查看详细分析结果或调整勾选；点击右侧一键批量重命名。
                </span>
              </div>
            </div>
          ) : (
            /* 单文件夹 / 详细分析视图底栏 */
            <div className="info-bar" id="div-info-bar">
              <div className="info-summary">
                <div>
                  <strong>{detectedCount}</strong>
                  <span>已识别</span>
                </div>
                <div>
                  <strong>{continuousSegments.length}</strong>
                  <span>连续区间</span>
                </div>
                <div className={missingCount > 0 ? "has-missing" : ""}>
                  <strong>{missingCount}</strong>
                  <span>缺少序号</span>
                </div>
              </div>

              <div className="info-row">
                <span className="info-label">连续序号</span>
                <div className="pills-container">
                  {continuousSegments.length === 0 ? (
                    <span className="info-empty">无</span>
                  ) : (
                    continuousSegments.map((seg, i) => (
                      <span
                        key={i}
                        className="pill pill-success"
                        onClick={() => scrollToSegment(seg.start, false)}
                        id={`pill-cont-${seg.start}`}
                      >
                        {seg.start === seg.end ? `${seg.start}` : `${seg.start} - ${seg.end}`}
                      </span>
                    ))
                  )}
                </div>
              </div>

              <div className="info-row">
                <span className="info-label">缺省序号</span>
                <div className="pills-container">
                  {missingSegments.length === 0 ? (
                    <span className="info-empty info-success">序号完整</span>
                  ) : (
                    missingSegments.map((seg, i) => (
                      <span
                        key={i}
                        className="pill pill-danger"
                        onClick={() => scrollToSegment(seg.start, true)}
                        id={`pill-miss-${seg.start}`}
                      >
                        {seg.start === seg.end ? `${seg.start}` : `${seg.start} - ${seg.end}`}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 重命名执行按钮 */}
          {viewMode === "batch-list" ? (
            <button
              className={`btn-rename-giant ${renamePhase}`}
              onClick={renamePhase === "completed" ? returnToStart : handleBatchRenameAll}
              disabled={
                renamePhase === "running" || (renamePhase === "idle" && batchRenameableTotal === 0)
              }
              id="btn-batch-rename-execute"
            >
              <span className="rename-title">
                {renamePhase === "running"
                  ? "正在批量重命名"
                  : renamePhase === "completed"
                    ? "回到开始"
                    : "重命名全部"}
              </span>
              <span className="rename-count">
                {renamePhase === "idle"
                  ? `${batchRenameableTotal} 个文件`
                  : renamePhase === "running"
                    ? `${renameResults.length} / ${renameTotal}`
                    : "开始一个新任务"}
              </span>
            </button>
          ) : (
            <button
              className={`btn-rename-giant ${renamePhase}`}
              onClick={renamePhase === "completed" ? returnToStart : handleRename}
              disabled={
                renamePhase === "running" || (renamePhase === "idle" && renameableCount === 0)
              }
              id="btn-rename-execute"
            >
              <span className="rename-title">
                {renamePhase === "running"
                  ? "正在重命名"
                  : renamePhase === "completed"
                    ? "回到开始"
                    : "重命名"}
              </span>
              <span className="rename-count">
                {renamePhase === "idle"
                  ? `${renameableCount} 个文件`
                  : renamePhase === "running"
                    ? `${renameResults.length} / ${renameTotal}`
                    : "开始一个新任务"}
              </span>
            </button>
          )}
        </footer>
      )}
    </main>
  );
};
