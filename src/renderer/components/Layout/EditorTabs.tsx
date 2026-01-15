import React, { useCallback, useEffect } from 'react'
import { Tabs, Dropdown, Tooltip } from 'antd'
import {
  CloseOutlined,
  EllipsisOutlined,
  CloseCircleOutlined,
  ColumnWidthOutlined
} from '@ant-design/icons'
import type { TabsProps, MenuProps } from 'antd'
import type { Chapter } from '../../common/ipc'
import { useTabStore } from '../../stores'

interface EditorTabsProps {
  chapters: Chapter[]
  currentChapter: Chapter | null
  onSelectChapter: (chapter: Chapter) => void
  onCloseChapter: (chapterId: string) => void
  onSaveChapter: (chapter: Chapter) => void
}

function EditorTabs({
  chapters,
  currentChapter,
  onSelectChapter,
  onCloseChapter,
  onSaveChapter
}: EditorTabsProps) {
  const { activeTabId, setActiveTab, addTab, removeTab, closeAllTabs, reorderTabs } = useTabStore()

  // 同步外部 chapters 变化到 store
  useEffect(() => {
    if (chapters.length > 0 && activeTabId === null) {
      setActiveTab(chapters[0].id)
    }
  }, [chapters, activeTabId, setActiveTab])

  // Tab关闭处理
  const handleClose = useCallback((key: string) => {
    removeTab(key)
    onCloseChapter(key)
  }, [removeTab, onCloseChapter])

  // 关闭其他Tab
  const handleCloseOthers = useCallback(() => {
    if (currentChapter) {
      chapters.filter(c => c.id !== currentChapter.id).forEach(c => {
        removeTab(c.id)
        onCloseChapter(c.id)
      })
    }
  }, [currentChapter, chapters, removeTab, onCloseChapter])

  // 关闭全部
  const handleCloseAll = useCallback(() => {
    closeAllTabs()
    chapters.forEach(c => onCloseChapter(c.id))
  }, [closeAllTabs, chapters, onCloseChapter])

  // 切换到下一个Tab
  const handleSwitchToNext = useCallback(() => {
    if (chapters.length <= 1) return
    const currentIndex = chapters.findIndex(c => c.id === activeTabId)
    const nextIndex = currentIndex === chapters.length - 1 ? 0 : currentIndex + 1
    const nextChapter = chapters[nextIndex]
    setActiveTab(nextChapter.id)
    onSelectChapter(nextChapter)
  }, [chapters, activeTabId, setActiveTab, onSelectChapter])

  // 下拉菜单
  const menuItems: MenuProps['items'] = [
    {
      key: 'closeOthers',
      icon: <CloseCircleOutlined />,
      label: '关闭其他',
      onClick: handleCloseOthers
    },
    {
      key: 'closeAll',
      icon: <CloseCircleOutlined />,
      label: '关闭全部',
      onClick: handleCloseAll
    },
    {
      key: 'switchNext',
      icon: <ColumnWidthOutlined />,
      label: '切换到下一个',
      onClick: handleSwitchToNext
    }
  ]

  // 转换为Antd Tabs items
  const items: TabsProps['items'] = chapters.map((chapter, index) => ({
    key: chapter.id,
    label: (
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 4px' }}>
        <span style={{
          maxWidth: 120,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}>
          {chapter.title || '无标题'}
        </span>
        {chapter.status === 'completed' && (
          <span style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: '#52c41a',
            flexShrink: 0
          }} title="已完成" />
        )}
        {chapter.status === 'revising' && (
          <span style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: '#faad14',
            flexShrink: 0
          }} title="修改中" />
        )}
        <Tooltip title="关闭" mouseEnterDelay={0.3}>
          <CloseOutlined
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation()
              handleClose(chapter.id)
            }}
            style={{ fontSize: 10, color: '#888', marginLeft: 2 }}
          />
        </Tooltip>
      </span>
    ),
    children: null
  }))

  // Tab切换
  const handleChange = (key: string) => {
    setActiveTab(key)
    const chapter = chapters.find(c => c.id === key)
    if (chapter) {
      onSelectChapter(chapter)
    }
  }

  // 右键菜单
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
  }

  return (
    <div
      style={{
        height: 36,
        background: '#252526',
        borderBottom: '1px solid #333',
        display: 'flex',
        alignItems: 'center'
      }}
      onContextMenu={handleContextMenu}
    >
      <Tabs
        activeKey={activeTabId || ''}
        items={items}
        onChange={handleChange}
        hideAdd
        size="small"
        style={{ width: 'calc(100% - 80px)', marginBottom: 0 }}
        tabBarStyle={{
          margin: 0,
          paddingLeft: 4,
          background: '#252526'
        }}
        moreIcon={
          <Dropdown menu={{ items: menuItems }} trigger={['click']}>
            <span style={{ padding: '0 8px', cursor: 'pointer' }}>
              <EllipsisOutlined />
            </span>
          </Dropdown>
        }
      />
      <div style={{
        position: 'absolute',
        right: 8,
        padding: '0 8px',
        borderLeft: '1px solid #333',
        height: '100%',
        display: 'flex',
        alignItems: 'center'
      }}>
        <span style={{ fontSize: 11, color: '#888' }}>
          {chapters.length} 个标签
        </span>
      </div>

      <style>{`
        .ant-tabs-nav {
          margin-bottom: 0 !important;
        }
        .ant-tabs-tab {
          background: #2d2d2d !important;
          border: none !important;
          margin-right: 2px !important;
          padding: '4px 8px !important;
          min-width: unset !important;
        }
        .ant-tabs-tab-active {
          background: #1e1e1e !important;
          border-bottom: 2px solid #58a6ff !important;
        }
        .ant-tabs-tab .anticon {
          color: #888;
        }
        .ant-tabs-tab-active .anticon {
          color: #58a6ff;
        }
        .tab-close {
          opacity: 0;
          transition: opacity 0.2s;
        }
        .ant-tabs-tab:hover .tab-close {
          opacity: 1;
        }
        .ant-tabs-nav::before {
          border-bottom: none !important;
        }
        .ant-tabs-extra-content {
          display: none !important;
        }
      `}</style>
    </div>
  )
}

export default EditorTabs
