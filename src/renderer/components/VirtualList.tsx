import React, { useRef, useState, useEffect, useCallback } from 'react';

export interface VirtualListProps {
  items: any[];
  itemHeight?: number;
  renderItem: (item: any, index: number) => React.ReactNode;
  scrollToIndexRef?: React.MutableRefObject<((index: number) => void) | null>;
  highlightIndex?: number | null;
}

export const VirtualList: React.FC<VirtualListProps> = ({
  items,
  itemHeight = 44,
  renderItem,
  scrollToIndexRef,
  highlightIndex
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(400);

  // 监听容器的实际高度变化，以更新可见区域计算
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });

    resizeObserver.observe(container);
    setContainerHeight(container.clientHeight);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  // 滚动到指定索引项的位置
  const scrollToIndex = useCallback((index: number) => {
    const container = containerRef.current;
    if (!container) return;
    
    const safeIndex = Math.max(0, Math.min(index, items.length - 1));
    const targetScrollTop = safeIndex * itemHeight;
    container.scrollTo({
      top: targetScrollTop,
      behavior: 'smooth'
    });
  }, [items.length, itemHeight]);

  // 将滚动方法暴露给父组件
  useEffect(() => {
    if (scrollToIndexRef) {
      scrollToIndexRef.current = scrollToIndex;
    }
  }, [scrollToIndexRef, scrollToIndex]);

  // 当高亮索引变化时，自动定位到该行
  useEffect(() => {
    if (highlightIndex !== null && highlightIndex !== undefined && highlightIndex >= 0) {
      scrollToIndex(highlightIndex);
    }
  }, [highlightIndex, scrollToIndex]);

  const totalHeight = items.length * itemHeight;

  // 缓冲区大小，防白屏
  const bufferCount = 5;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - bufferCount);
  const endIndex = Math.min(items.length, Math.ceil((scrollTop + containerHeight) / itemHeight) + bufferCount);

  const visibleItems = [];
  for (let i = startIndex; i < endIndex; i++) {
    visibleItems.push({
      item: items[i],
      index: i,
      style: {
        position: 'absolute' as const,
        top: i * itemHeight,
        left: 0,
        right: 0,
        height: itemHeight,
      }
    });
  }

  return (
    <div
      ref={containerRef}
      className="virtual-list-viewport"
      onScroll={onScroll}
      style={{ position: 'relative', height: '100%', width: '100%' }}
    >
      {/* 撑开滚动条的占位元素 */}
      <div style={{ height: totalHeight, width: '100%', pointerEvents: 'none' }} />
      {/* 仅渲染可见区域内的项目 */}
      {visibleItems.map(({ item, index, style }) => (
        <div 
          key={index} 
          style={style} 
          className={`list-item-wrapper ${highlightIndex === index ? 'search-highlight' : ''}`}
        >
          {renderItem(item, index)}
        </div>
      ))}
    </div>
  );
};
