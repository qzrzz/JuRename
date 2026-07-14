/// <reference path="../renderer.d.ts" />
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { analyzeEpisodes, formatEpisodeNumber, FileItem } from '../core/episode-detector';
import { VirtualList } from './components/VirtualList';
import appIconUrl from '../../icon.png';

type IconName = 'spark' | 'file' | 'folder' | 'search' | 'trash' | 'up' | 'down' | 'arrow';

const Icon: React.FC<{ name: IconName; size?: number }> = ({ name, size = 16 }) => {
  const paths: Record<IconName, React.ReactNode> = {
    spark: <><path d="m12 2 1.1 3.9L17 7l-3.9 1.1L12 12l-1.1-3.9L7 7l3.9-1.1L12 2Z"/><path d="m5 12 .8 2.2L8 15l-2.2.8L5 18l-.8-2.2L2 15l2.2-.8L5 12Z"/><path d="m17.5 13 .7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z"/></>,
    file: <><path d="M6 2.75h7l4 4v10.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4.75a2 2 0 0 1 2-2Z"/><path d="M13 2.75v4h4M7.5 11h6M7.5 14.5h5"/></>,
    folder: <><path d="M2.75 6.5h16.5v9.75a2 2 0 0 1-2 2H4.75a2 2 0 0 1-2-2V6.5Z"/><path d="M2.75 7V5.25a2 2 0 0 1 2-2h4l2 2h6.5a2 2 0 0 1 2 2"/></>,
    search: <><circle cx="9.5" cy="9.5" r="5.75"/><path d="m14 14 4 4"/></>,
    trash: <><path d="M4.5 6.5h11M8 3.5h4M6 6.5l.75 11h6.5l.75-11M9 9.5v5M12 9.5v5"/></>,
    up: <path d="m6 13 5-5 5 5"/>,
    down: <path d="m6 8 5 5 5-5"/>,
    arrow: <><path d="M4 11h13M12 6l5 5-5 5"/></>,
  };

  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
};

// 扩展 FileItem，加入前端交互状态
interface DisplayFileItem extends FileItem {
  checked: boolean;
}

// 混合列表中可能是文件项，也可能是缺失序号提示占位项
type MixListItem = 
  | { isMissingPlaceholder: false; file: DisplayFileItem }
  | { isMissingPlaceholder: true; start: number; end: number; length: number };

type RenamePhase = 'idle' | 'running' | 'completed';

interface RenameResultItem {
  oldPath: string;
  newPath: string;
  oldName: string;
  newName: string;
  status: 'success' | 'failed';
  error?: string;
}

const SEPARATOR_OPTIONS = [
  { value: '-', label: '短横线', preview: '-' },
  { value: '·', label: '间隔点', preview: '·' },
  { value: '_', label: '下划线', preview: '_' },
  { value: '—', label: '长横线', preview: '—' },
  { value: '.', label: '英文句点', preview: '.' },
  { value: ' ', label: '空格', preview: 'Space' },
];

export const App: React.FC = () => {
  const [files, setFiles] = useState<DisplayFileItem[]>([]);
  // 自动根据所有有效集数中最大的整数长度来决定补零宽度，最小 2 位
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
  const [separator, setSeparator] = useState<string>('-');
  const [keyword, setKeyword] = useState<string>('');
  
  // 搜索相关的索引定位状态
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [currentSearchIndex, setCurrentSearchIndex] = useState<number>(-1);
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [renamePhase, setRenamePhase] = useState<RenamePhase>('idle');
  const [renameTotal, setRenameTotal] = useState(0);
  const [renameResults, setRenameResults] = useState<RenameResultItem[]>([]);
  const [currentRenameName, setCurrentRenameName] = useState('');
  const [separatorMenuOpen, setSeparatorMenuOpen] = useState(false);

  // 虚拟列表的滚动方法引用
  const scrollToIndexRef = useRef<((index: number) => void) | null>(null);
  const separatorControlRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeSeparatorMenu = (event: MouseEvent) => {
      if (!separatorControlRef.current?.contains(event.target as Node)) {
        setSeparatorMenuOpen(false);
      }
    };
    const closeSeparatorMenuWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSeparatorMenuOpen(false);
    };
    document.addEventListener('mousedown', closeSeparatorMenu);
    document.addEventListener('keydown', closeSeparatorMenuWithKeyboard);
    return () => {
      document.removeEventListener('mousedown', closeSeparatorMenu);
      document.removeEventListener('keydown', closeSeparatorMenuWithKeyboard);
    };
  }, []);

  // 从绝对路径中安全截取文件名和目录前缀
  const splitPath = (fullPath: string) => {
    const lastSlash = Math.max(fullPath.lastIndexOf('/'), fullPath.lastIndexOf('\\'));
    const dir = fullPath.substring(0, lastSlash + 1);
    const name = fullPath.substring(lastSlash + 1);
    return { dir, name };
  };

  // 重新对所有文件运行智能集数检测算法
  const reAnalyzeFiles = (currentFiles: { name: string; path: string; checked?: boolean }[]) => {
    const analyzed = analyzeEpisodes(currentFiles);
    return analyzed.map((item, idx) => {
      // 保持之前的勾选状态，若无则默认勾选
      const prevChecked = currentFiles[idx]?.checked !== false;
      return {
        ...item,
        checked: prevChecked,
      };
    });
  };

  // 使用拖入或选择的路径开启一个新任务（不与当前列表合并）
  const openPathsAsNewTask = async (paths: string[]) => {
    if (paths.length === 0 || renamePhase === 'running') return;
    try {
      // 展开混合目录与文件
      const expandedPaths = await window.electronAPI.scanPaths(paths);

      // 转换为基础文件信息并按绝对路径去重
      const newBaseFiles = expandedPaths.map((p: string) => {
        const { name } = splitPath(p);
        return { name, path: p, checked: true };
      });
      const uniqueMap = new Map<string, typeof newBaseFiles[0]>();
      newBaseFiles.forEach(file => uniqueMap.set(file.path, file));

      setFiles(reAnalyzeFiles(Array.from(uniqueMap.values())));
      setKeyword('');
      setSearchResults([]);
      setCurrentSearchIndex(-1);
      setRenamePhase('idle');
      setRenameTotal(0);
      setRenameResults([]);
      setCurrentRenameName('');
    } catch (err) {
      console.error('打开新任务失败:', err);
    }
  };

  // 选择一个文件夹并作为新任务打开
  const handleOpenDirectory = async () => {
    if (renamePhase === 'running') return;
    const dir = await window.electronAPI.selectDirectory();
    if (dir) {
      await openPathsAsNewTask([dir]);
    }
  };

  // 单项文件勾选与其它状态保持不变

  // 改变单项的勾选状态
  const toggleFileChecked = (index: number) => {
    setFiles(prev => {
      const next = [...prev];
      if (next[index]) {
        next[index].checked = !next[index].checked;
      }
      return next;
    });
  };

  // 一键全选/取消全选
  const isAllChecked = files.length > 0 && files.every(f => f.checked);
  const toggleAllChecked = () => {
    setFiles(prev => {
      const target = !isAllChecked;
      return prev.map(f => ({ ...f, checked: target }));
    });
  };

  // 清空列表
  const clearList = () => {
    if (renamePhase !== 'idle') return;
    setFiles([]);
    setKeyword('');
    setSearchResults([]);
    setCurrentSearchIndex(-1);
    setRenameResults([]);
    setRenameTotal(0);
  };

  const returnToStart = () => {
    if (renamePhase !== 'completed') return;
    setFiles([]);
    setKeyword('');
    setSearchResults([]);
    setCurrentSearchIndex(-1);
    setRenamePhase('idle');
    setRenameTotal(0);
    setRenameResults([]);
    setCurrentRenameName('');
  };

  // 排序文件列表：按提取出的序号升序。无序号 (NaN) 的文件放在最后
  const sortedFiles = useMemo(() => {
    return [...files].sort((a, b) => {
      if (isNaN(a.bestNumber) && isNaN(b.bestNumber)) return a.name.localeCompare(b.name);
      if (isNaN(a.bestNumber)) return 1;
      if (isNaN(b.bestNumber)) return -1;
      return a.bestNumber - b.bestNumber;
    });
  }, [files]);

  // 根据排序后的文件生成包含“缺失占位行”的最终混合列表
  const mixList = useMemo(() => {
    const list: MixListItem[] = [];
    if (sortedFiles.length === 0) return list;

    let prevInt = NaN;

    sortedFiles.forEach(file => {
      const currentInt = Math.floor(file.bestNumber);

      if (!isNaN(currentInt)) {
        if (!isNaN(prevInt) && currentInt - prevInt > 1) {
          // 发现了缺失的整数序号区间，插入一个缺失指示占位项
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

  // 计算连续区间和缺省区间，用于底部的序号信息栏
  const { continuousSegments, missingSegments } = useMemo(() => {
    // 提取排序后所有非重复的整数序号
    const ints = Array.from(
      new Set(
        sortedFiles
          .map(f => Math.floor(f.bestNumber))
          .filter(n => !isNaN(n))
      )
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

    return { continuousSegments: continuous, missingSegments: missing };
  }, [sortedFiles]);

  // 全局阻止默认的拖放行为并管理窗口全局拖拽状态
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (renamePhase === 'running') return;
      setDragActive(true);
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // 只有当鼠标移出窗口时才关闭拖拽状态
      if (e.clientX === 0 && e.clientY === 0) {
        setDragActive(false);
      }
    };

    const handleDropEvent = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      if (renamePhase === 'running') return;

      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const paths: string[] = [];
        for (let i = 0; i < e.dataTransfer.files.length; i++) {
          const file = e.dataTransfer.files[i];
          const fPath = window.electronAPI.getFilePath(file);
          if (fPath) paths.push(fPath);
        }
        await openPathsAsNewTask(paths);
      }
    };

    window.addEventListener('dragover', handleDragOver, false);
    window.addEventListener('dragleave', handleDragLeave, false);
    window.addEventListener('drop', handleDropEvent, false);

    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDropEvent);
    };
  }, [files, renamePhase]);

  // 搜索关键词检索
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
        // 在原文件名和智能生成的新文件名中匹配
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

  // 定位跳转
  const handleSearchNext = () => {
    if (searchResults.length === 0) return;
    setCurrentSearchIndex(prev => {
      const nextIdx = (prev + 1) % searchResults.length;
      return nextIdx;
    });
  };

  const handleSearchPrev = () => {
    if (searchResults.length === 0) return;
    setCurrentSearchIndex(prev => {
      const nextIdx = (prev - 1 + searchResults.length) % searchResults.length;
      return nextIdx;
    });
  };

  // 点击信息栏的连续/缺省段进行滚动定位
  const scrollToSegment = (startVal: number, isMissing: boolean) => {
    if (!scrollToIndexRef.current) return;
    const targetIdx = mixList.findIndex(item => {
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

  // 逐个执行物理重命名，让界面可以展示实时进度与单项错误
  const handleRename = async () => {
    const renames = files
      .filter(f => f.checked && !isNaN(f.bestNumber))
      .map(f => {
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

    if (renames.length === 0 || renamePhase !== 'idle') return;

    const confirmText = `确定要批量重命名这 ${renames.length} 个文件吗？此操作无法撤销。`;
    if (!confirm(confirmText)) return;

    setRenameTotal(renames.length);
    setRenameResults([]);
    setRenamePhase('running');

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
          status: result.success ? 'success' : 'failed',
          error: result.error,
        };
      } catch (error) {
        resultItem = {
          ...rename,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        };
      }
      setRenameResults(previous => [...previous, resultItem]);
    }

    setCurrentRenameName('');
    setRenamePhase('completed');
  };

  // 渲染单行
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
    // 找出原文件在 files 数组中的原始索引
    const rawIndex = files.findIndex(f => f.path === file.path);
    const formattedNum = formatEpisodeNumber(file.bestNumber, paddingWidth);

    return (
      <div className="file-item" id={`item-${index}`}>
        <button
          className={`checkbox-custom ${file.checked ? 'checked' : ''}`}
          onClick={() => toggleFileChecked(rawIndex)}
          id={`chk-${index}`}
          aria-label={file.checked ? `取消选择 ${file.name}` : `选择 ${file.name}`}
        />
        <div className="file-name-text preview-name" title={`${formattedNum}${separator}${file.name}`}>
          {Number.isFinite(file.bestNumber) ? (
            <span className="episode-highlight">
              {formattedNum}{separator}
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
        {item.status === 'success' ? '✓' : '!'}
      </span>
      <div className="rename-result-names">
        <span className="rename-result-new">{item.newName}</span>
        <span className="rename-result-old">原文件：{item.oldName}</span>
      </div>
      <span className="rename-result-label">{item.status === 'success' ? '成功' : '失败'}</span>
      {item.error && <span className="rename-result-error">{item.error}</span>}
    </div>
  );

  // 计算当前高亮可视索引
  const activeHighlightIndex = useMemo(() => {
    if (currentSearchIndex >= 0 && searchResults[currentSearchIndex] !== undefined) {
      return searchResults[currentSearchIndex];
    }
    return null;
  }, [currentSearchIndex, searchResults]);

  const selectedCount = files.filter(file => file.checked).length;
  const detectedCount = files.filter(file => Number.isFinite(file.bestNumber)).length;
  const renameableCount = files.filter(file => file.checked && Number.isFinite(file.bestNumber)).length;
  const missingCount = missingSegments.reduce((total, segment) => total + segment.end - segment.start + 1, 0);
  const renameSuccessCount = renameResults.filter(result => result.status === 'success').length;
  const renameFailureCount = renameResults.length - renameSuccessCount;
  const renameProgress = renameTotal === 0 ? 0 : Math.round(renameResults.length / renameTotal * 100);

  return (
    <main className="app-container">
      {/* 拖拽全屏发光覆盖层 */}
      {dragActive && (
        <div className="drag-overlay">
          <div className="drag-overlay-card">
            <div className="drag-overlay-icon"><Icon name="folder" size={34} /></div>
            <div className="drag-overlay-text">松开即可开始识别</div>
            <div className="drag-overlay-subtext">支持文件与文件夹，导入后自动生成排序预览</div>
          </div>
        </div>
      )}
      {/* 头部控制栏 */}
      <header className="header-bar">
        <div className="header-title-section">
          <div className="brand-mark"><img src={appIconUrl} alt="" /></div>
          <div>
            <h1 className="header-title">JuRename</h1>
            <span className="header-subtitle">让文件名有正确序号</span>
          </div>
        </div>

        <div className="controls-wrapper">
          {files.length > 0 && renamePhase === 'idle' && (
            <>
              <div className="separator-combobox" ref={separatorControlRef}>
                <div className={`input-group separator-control ${separatorMenuOpen ? 'open' : ''}`}>
                  <span className="input-label">分隔符</span>
                  <input
                    type="text"
                    className="input-field input-width-md"
                    value={separator}
                    onChange={event => setSeparator(event.target.value)}
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
                    onClick={() => setSeparatorMenuOpen(open => !open)}
                    aria-label="选择预设分隔符"
                    aria-expanded={separatorMenuOpen}
                  >
                    <Icon name="down" size={13} />
                  </button>
                </div>
                {separatorMenuOpen && (
                  <div className="separator-options" id="separator-options" role="listbox">
                    {SEPARATOR_OPTIONS.map(option => (
                      <button
                        type="button"
                        key={option.label}
                        className={`separator-option ${separator === option.value ? 'selected' : ''}`}
                        onClick={() => {
                          setSeparator(option.value);
                          setSeparatorMenuOpen(false);
                        }}
                        role="option"
                        aria-selected={separator === option.value}
                      >
                        <span className="separator-preview">{option.preview}</span>
                        <span>{option.label}</span>
                        {separator === option.value && <span className="separator-selected-mark">✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="search-control">
                <Icon name="search" size={15} />
                <input
                  type="text"
                  className="input-field search-field"
                  placeholder="搜索文件名"
                  value={keyword}
                  onChange={event => setKeyword(event.target.value)}
                  id="input-search"
                  aria-label="搜索文件名"
                />
                {keyword && <span className="search-count">{searchResults.length ? `${currentSearchIndex + 1}/${searchResults.length}` : '0'}</span>}
                {searchResults.length > 0 && (
                  <div className="search-nav">
                    <button className="icon-btn" onClick={handleSearchPrev} id="btn-search-prev" aria-label="上一个搜索结果"><Icon name="up" size={14} /></button>
                    <button className="icon-btn" onClick={handleSearchNext} id="btn-search-next" aria-label="下一个搜索结果"><Icon name="down" size={14} /></button>
                  </div>
                )}
              </div>

              <button className="btn btn-quiet" onClick={clearList} id="btn-clear-list">
                <Icon name="trash" size={15} />清空
              </button>
              <span className="control-divider" />
            </>
          )}

          {renamePhase !== 'idle' && (
            <span className={`task-status-badge ${renamePhase}`}>
              <i />{renamePhase === 'running' ? `正在处理 ${renameResults.length + 1}/${renameTotal}` : '任务已完成'}
            </span>
          )}

          <button className="btn btn-primary" onClick={handleOpenDirectory} disabled={renamePhase === 'running'} id="btn-open-folder">
            <Icon name="folder" size={15} />打开文件夹
          </button>
        </div>
      </header>

      {/* 主列表区域 */}
      <section className={`list-container ${dragActive ? 'drag-active' : ''}`}>
        {files.length === 0 ? (
          <div className="dropzone" id="div-dropzone">
            <div className="dropzone-content">
              <div className="dropzone-visual">
                <span className="visual-card visual-card-back"><Icon name="file" size={25} /></span>
                <span className="visual-card visual-card-front"><Icon name="folder" size={29} /></span>
                <span className="visual-spark"><Icon name="spark" size={17} /></span>
              </div>
              <span className="dropzone-eyebrow">智能序号识别</span>
              <h2 className="dropzone-title">把杂乱文件，整理成正确顺序</h2>
              <p className="dropzone-subtext">拖入剧集文件或整个文件夹，JuRename 会提取连续序号并生成安全的重命名预览。</p>
              <div className="dropzone-actions">
                <button className="btn btn-primary btn-large" onClick={handleOpenDirectory} id="btn-empty-folder">
                  <Icon name="folder" size={17} />打开文件夹
                </button>
              </div>
              <span className="drop-hint">或直接拖放到窗口任意位置</span>
            </div>
            <div className="feature-strip">
              <span><i>01</i>连续数字优先</span>
              <span><i>二</i>支持中文数字</span>
              <span><i>.1</i>保留子序号</span>
            </div>
          </div>
        ) : renamePhase !== 'idle' ? (
          <div className="rename-workspace" aria-live="polite">
            <div className="rename-progress-header">
              <div>
                <span className={`rename-phase-mark ${renamePhase}`}>
                  {renamePhase === 'running' ? <span className="rename-spinner" /> : (renameFailureCount > 0 ? '!' : '✓')}
                </span>
                <div className="rename-progress-copy">
                  <h2>{renamePhase === 'running' ? '正在重命名' : (renameFailureCount > 0 ? '重命名完成，部分文件失败' : '重命名完成')}</h2>
                  <p>
                    {renamePhase === 'running'
                      ? `正在处理：${currentRenameName}`
                      : `成功 ${renameSuccessCount} 个${renameFailureCount > 0 ? `，失败 ${renameFailureCount} 个` : '，所有文件均已处理'}`}
                  </p>
                </div>
              </div>
              <strong className="rename-progress-percent">{renameProgress}%</strong>
            </div>

            <div className="rename-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={renameTotal} aria-valuenow={renameResults.length}>
              <span style={{ width: `${renameProgress}%` }} />
            </div>

            <div className="rename-progress-meta">
              <span>总进度 <strong>{renameResults.length} / {renameTotal}</strong></span>
              <div>
                <span className="success">成功 {renameSuccessCount}</span>
                <span className={renameFailureCount > 0 ? 'failed' : ''}>失败 {renameFailureCount}</span>
              </div>
            </div>

            <div className="rename-results-header">
              <strong>处理记录</strong>
              <span>{renamePhase === 'running' ? '完成一项即显示一项' : '任务已经结束，不能再次执行重命名'}</span>
            </div>
            <div className="rename-results-list">
              {renameResults.length === 0 ? (
                <div className="rename-results-empty">正在准备第一个文件…</div>
              ) : (
                <VirtualList
                  items={renameResults}
                  itemHeight={54}
                  highlightIndex={renamePhase === 'running' ? renameResults.length - 1 : null}
                  scrollBehavior="auto"
                  renderItem={renderRenameResult}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="list-layout">
            {/* 顶栏操作：全选 */}
            <div className="list-toolbar">
              <button
                className={`checkbox-custom ${isAllChecked ? 'checked' : ''}`}
                onClick={toggleAllChecked}
                id="chk-select-all"
                aria-label={isAllChecked ? '取消全选' : '全选'}
              />
              <div className="list-summary">
                <strong>{files.length} 个文件</strong>
                <span>已选择 {selectedCount} 个</span>
              </div>
              <div className="column-labels">
                <span>重命名预览</span>
              </div>
            </div>
            
            <div style={{ flex: 1, overflow: 'hidden' }}>
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
      {files.length > 0 && (
        <footer className="footer-section">
          {/* 序号信息栏 */}
          <div className="info-bar" id="div-info-bar">
            <div className="info-summary">
              <div><strong>{detectedCount}</strong><span>已识别</span></div>
              <div><strong>{continuousSegments.length}</strong><span>连续区间</span></div>
              <div className={missingCount > 0 ? 'has-missing' : ''}><strong>{missingCount}</strong><span>缺少序号</span></div>
            </div>
            {/* 连续序号 */}
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
            {/* 缺省序号 */}
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

          {/* 重命名按钮 */}
          <button 
            className={`btn-rename-giant ${renamePhase}`}
            onClick={renamePhase === 'completed' ? returnToStart : handleRename}
            disabled={renamePhase === 'running' || (renamePhase === 'idle' && renameableCount === 0)}
            id="btn-rename-execute"
          >
            <span className="rename-title">
              {renamePhase === 'running' ? '正在重命名' : renamePhase === 'completed' ? '回到开始' : '重命名'}
            </span>
            <span className="rename-count">
              {renamePhase === 'idle'
                ? `${renameableCount} 个文件`
                : renamePhase === 'running'
                  ? `${renameResults.length} / ${renameTotal}`
                  : '开始一个新任务'}
            </span>
          </button>
        </footer>
      )}
    </main>
  );
};
