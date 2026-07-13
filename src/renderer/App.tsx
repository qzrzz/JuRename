/// <reference path="../renderer.d.ts" />
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { analyzeEpisodes, formatEpisodeNumber, FileItem } from '../core/episode-detector';
import { VirtualList } from './components/VirtualList';

// 扩展 FileItem，加入前端交互状态
interface DisplayFileItem extends FileItem {
  checked: boolean;
}

// 混合列表中可能是文件项，也可能是缺失序号提示占位项
type MixListItem = 
  | { isMissingPlaceholder: false; file: DisplayFileItem }
  | { isMissingPlaceholder: true; start: number; end: number; length: number };

export const App: React.FC = () => {
  const [files, setFiles] = useState<DisplayFileItem[]>([]);
  const [paddingWidth, setPaddingWidth] = useState<number>(2);
  const [separator, setSeparator] = useState<string>(' - ');
  const [keyword, setKeyword] = useState<string>('');
  
  // 搜索相关的索引定位状态
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [currentSearchIndex, setCurrentSearchIndex] = useState<number>(-1);
  const [dragActive, setDragActive] = useState<boolean>(false);

  // 虚拟列表的滚动方法引用
  const scrollToIndexRef = useRef<((index: number) => void) | null>(null);

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

  // 处理拖入或选择的绝对路径列表
  const handlePathsAdded = async (paths: string[]) => {
    if (paths.length === 0) return;
    try {
      // 展开混合目录与文件
      const expandedPaths = await window.electronAPI.scanPaths(paths);
      if (expandedPaths.length === 0) return;

      // 转换为基础文件信息并合并
      const newBaseFiles = expandedPaths.map((p: string) => {
        const { name } = splitPath(p);
        return { name, path: p, checked: true };
      });

      // 追加到已有列表并全局重新运行算法
      setFiles(prev => {
        const combined = [...prev, ...newBaseFiles];
        // 去重：按绝对路径排重
        const uniqueMap = new Map<string, typeof combined[0]>();
        combined.forEach(f => uniqueMap.set(f.path, f));
        return reAnalyzeFiles(Array.from(uniqueMap.values()));
      });
    } catch (err) {
      console.error('添加路径失败:', err);
    }
  };

  // 按钮触发文件选择
  const handleSelectFiles = async () => {
    const selected = await window.electronAPI.selectFiles();
    await handlePathsAdded(selected);
  };

  // 按钮触发文件夹选择
  const handleSelectDirectory = async () => {
    const dir = await window.electronAPI.selectDirectory();
    if (dir) {
      await handlePathsAdded([dir]);
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
    setFiles([]);
    setKeyword('');
    setSearchResults([]);
    setCurrentSearchIndex(-1);
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

      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const paths: string[] = [];
        for (let i = 0; i < e.dataTransfer.files.length; i++) {
          const file = e.dataTransfer.files[i];
          const fPath = window.electronAPI.getFilePath(file);
          if (fPath) paths.push(fPath);
        }
        await handlePathsAdded(paths);
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
  }, [files]);

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

  // 执行批量物理重命名
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
        };
      });

    if (renames.length === 0) return;

    const confirmText = `确定要批量重命名这 ${renames.length} 个文件吗？此操作无法撤销。`;
    if (!confirm(confirmText)) return;

    try {
      const result = await window.electronAPI.renameFiles(renames);
      if (result.success) {
        alert('批量重命名成功！');
        clearList();
      } else {
        const errorMsg = result.errors?.map((e: { path: string; error: string }) => `${splitPath(e.path).name}: ${e.error}`).join('\n') || '未知错误';
        alert(`部分或全部文件重命名失败：\n${errorMsg}`);
      }
    } catch (e: any) {
      alert(`物理重命名出错: ${e.message}`);
    }
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
        <div 
          className={`checkbox-custom ${file.checked ? 'checked' : ''}`}
          onClick={() => toggleFileChecked(rawIndex)}
          id={`chk-${index}`}
        />
        <div className="file-name-text">
          {!isNaN(file.bestNumber) && (
            <span className="episode-highlight">
              {formattedNum}{separator}
            </span>
          )}
          {file.name}
        </div>
        <div className="old-name-tag">
          {file.name}
        </div>
      </div>
    );
  };

  // 计算当前高亮可视索引
  const activeHighlightIndex = useMemo(() => {
    if (currentSearchIndex >= 0 && searchResults[currentSearchIndex] !== undefined) {
      return searchResults[currentSearchIndex];
    }
    return null;
  }, [currentSearchIndex, searchResults]);

  return (
    <main className="app-container">
      {/* 拖拽全屏发光覆盖层 */}
      {dragActive && (
        <div className="drag-overlay">
          <div className="drag-overlay-card">
            <div className="drag-overlay-icon">📥</div>
            <div className="drag-overlay-text">释放以导入剧集文件 / 文件夹</div>
            <div className="drag-overlay-subtext">智能识别集数、自动排除年份与分辨率干扰</div>
          </div>
        </div>
      )}
      {/* 头部控制栏 */}
      <header className="header-bar">
        <div className="header-title-section">
          <h1 className="header-title">剧集智能重命名 JuRename</h1>
          <span className="header-subtitle">拖拽剧集文件或文件夹至窗口即可自动提取集数补零</span>
        </div>

        <div className="controls-wrapper">
          {/* 文件导入按钮 */}
          <button className="btn" onClick={handleSelectFiles} id="btn-import-files">
            选择文件
          </button>
          <button className="btn" onClick={handleSelectDirectory} id="btn-import-dir">
            选择文件夹
          </button>

          {/* 补零位数 */}
          <div className="input-group">
            <span className="input-label">补零位数</span>
            <input 
              type="number"
              min="1"
              max="9"
              className="input-field input-width-sm"
              value={paddingWidth}
              onChange={e => setPaddingWidth(Math.max(1, parseInt(e.target.value, 10) || 1))}
              id="input-padding"
            />
          </div>

          {/* 分隔符 */}
          <div className="input-group">
            <span className="input-label">分隔符</span>
            <input 
              type="text"
              className="input-field input-width-md"
              value={separator}
              onChange={e => setSeparator(e.target.value)}
              id="input-separator"
            />
          </div>

          {/* 搜索过滤/滚动定位 */}
          <div className="input-group">
            <input 
              type="text"
              className="input-field search-field"
              placeholder="搜索剧集名滚动定位..."
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              id="input-search"
            />
            {searchResults.length > 0 && (
              <span style={{ fontSize: '0.75rem', color: 'var(--accent-green)' }}>
                {currentSearchIndex + 1}/{searchResults.length}
              </span>
            )}
          </div>
          {searchResults.length > 0 && (
            <div style={{ display: 'flex', gap: '4px' }}>
              <button className="btn" style={{ padding: '6px 10px' }} onClick={handleSearchPrev} id="btn-search-prev">▲</button>
              <button className="btn" style={{ padding: '6px 10px' }} onClick={handleSearchNext} id="btn-search-next">▼</button>
            </div>
          )}

          {files.length > 0 && (
            <button className="btn" onClick={clearList} id="btn-clear-list">
              清空
            </button>
          )}
        </div>
      </header>

      {/* 主列表区域 */}
      <section className={`list-container ${dragActive ? 'drag-active' : ''}`}>
        {files.length === 0 ? (
          <div className="dropzone" onClick={handleSelectFiles} id="div-dropzone">
            <div className="dropzone-icon">✨</div>
            <span className="dropzone-text">拖拽文件 / 文件夹到此处，或者点击导入</span>
            <span className="dropzone-subtext">智能识别集数大写汉字、自动规避年份与分辨率</span>
          </div>
        ) : (
          <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* 顶栏操作：全选 */}
            <div 
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                padding: '10px 20px', 
                borderBottom: '1px solid var(--border-color)', 
                background: 'rgba(255,255,255,0.01)',
                fontSize: '0.85rem',
                color: 'var(--text-secondary)'
              }}
            >
              <div 
                className={`checkbox-custom ${isAllChecked ? 'checked' : ''}`}
                onClick={toggleAllChecked}
                style={{ marginRight: '14px' }}
                id="chk-select-all"
              />
              <span>全选 / 反选 ({files.filter(f => f.checked).length}/{files.length} 个文件)</span>
              <span style={{ marginLeft: 'auto' }}>智能生成新文件名预览</span>
              <span style={{ marginLeft: 'auto', width: '35%', opacity: 0.6, paddingLeft: '40px' }}>原文件名</span>
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
            {/* 连续序号 */}
            <div className="info-row">
              <span className="info-label">连续序号</span>
              <div className="pills-container">
                {continuousSegments.length === 0 ? (
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>无</span>
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
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>无缺省</span>
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
            className="btn-rename-giant"
            onClick={handleRename}
            disabled={files.filter(f => f.checked).length === 0}
            id="btn-rename-execute"
          >
            一键批量重命名
          </button>
        </footer>
      )}
    </main>
  );
};
