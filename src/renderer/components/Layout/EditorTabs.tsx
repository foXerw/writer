import { useCallback } from 'react'
import { Tabs, Dropdown, Tooltip } from 'antd'
import {
  CloseOutlined,
  EllipsisOutlined,
  CloseCircleOutlined,
  ColumnWidthOutlined
} from '@ant-design/icons'
import type { TabsProps, MenuProps } from 'antd'
import type { Chapter } from '@/common/ipc'

interface EditorTabsProps {
  chapters: Chapter[]
  activeChapterId: string | null
  currentChapter: Chapter | null
  onSelectChapter: (chapter: Chapter) => void
  onCloseChapter: (chapterId: string) => void
}

// 纯受控组件：激活位与打开列表均来自 props（Workspace 的 currentChapter/openedChapters 是唯一真源）
function EditorTabs({
  chapters,
  activeChapterId,
  currentChapter,
  onSelectChapter,
  onCloseChapter
}: EditorTabsProps) {
  // Tab关闭处理
  const handleClose = useCallback((key: string) => {
    onCloseChapter(key)
  }, [onCloseChapter])

  // 关闭其他Tab
  const handleCloseOthers = useCallback(() => {
    if (currentChapter) {
      chapters.filter(c => c.id !== currentChapter.id).forEach(c => {
        onCloseChapter(c.id)
      })
    }
  }, [currentChapter, chapters, onCloseChapter])

  // 关闭全部
  const handleCloseAll = useCallback(() => {
    chapters.forEach(c => onCloseChapter(c.id))
  }, [chapters, onCloseChapter])

  // 关闭指定 tab 右侧的所有 tab（不含 target）
  const handleCloseRight = useCallback((targetId: string) => {
    const idx = chapters.findIndex(c => c.id === targetId)
    if (idx < 0) return
    chapters.slice(idx + 1).forEach(c => {
      onCloseChapter(c.id)
    })
  }, [chapters, onCloseChapter])

  // 关闭除 target 外的所有 tab（以右键 target 为基准，区别于以激活 tab 为基准的 handleCloseOthers）
  const handleCloseOthersThan = useCallback((targetId: string) => {
    chapters.filter(c => c.id !== targetId).forEach(c => {
      onCloseChapter(c.id)
    })
  }, [chapters, onCloseChapter])

  // 切换到下一个Tab
  const handleSwitchToNext = useCallback(() => {
    if (chapters.length <= 1) return
    const currentIndex = chapters.findIndex(c => c.id === activeChapterId)
    const nextIndex = currentIndex === chapters.length - 1 ? 0 : currentIndex + 1
    const nextChapter = chapters[nextIndex]
    onSelectChapter(nextChapter)
  }, [chapters, activeChapterId, onSelectChapter])

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

  // 单个 tab 的右键菜单项（以右键的 target chapter 为基准）
  const contextMenuItems = useCallback((chapter: Chapter): MenuProps['items'] => [
    { key: 'close', icon: <CloseOutlined />, label: '关闭', onClick: () => handleClose(chapter.id) },
    { key: 'closeOthers', icon: <CloseCircleOutlined />, label: '关闭其他', onClick: () => handleCloseOthersThan(chapter.id) },
    { key: 'closeRight', icon: <ColumnWidthOutlined />, label: '关闭右侧', onClick: () => handleCloseRight(chapter.id) },
    { key: 'closeAll', icon: <CloseCircleOutlined />, label: '关闭全部', onClick: handleCloseAll }
  ], [handleClose, handleCloseOthersThan, handleCloseRight, handleCloseAll])

  // 转换为Antd Tabs items
  const items: TabsProps['items'] = chapters.map((chapter, _index) => ({
    key: chapter.id,
    label: (
      <Dropdown trigger={['contextMenu']} menu={{ items: contextMenuItems(chapter) }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px', height: 32, cursor: 'default' }}>
          <span style={{
            maxWidth: 100,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 12
          }}>
            {chapter.title || '无标题'}
          </span>
          {chapter.status === 'completed' && (
            <span style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--color-success)',
              flexShrink: 0
            }} title="已完成" />
          )}
          {chapter.status === 'revising' && (
            <span style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--color-warning)',
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
              style={{ fontSize: 10, color: 'var(--color-text-secondary)', marginLeft: 2 }}
            />
          </Tooltip>
        </span>
      </Dropdown>
    ),
    children: null
  }))

  // Tab切换
  const handleChange = (key: string) => {
    const chapter = chapters.find(c => c.id === key)
    if (chapter) {
      onSelectChapter(chapter)
    }
  }

  return (
    <div
      className="editor-tabs"
      style={{
        height: 36,
        background: 'var(--color-bg-elevated)',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        alignItems: 'center'
      }}
    >
      <Tabs
        activeKey={activeChapterId || ''}
        items={items}
        onChange={handleChange}
        hideAdd
        size="small"
        style={{ flex: 1, minWidth: 0, marginBottom: 0 }}
        tabBarStyle={{
          margin: 0,
          paddingLeft: 4,
          background: 'var(--color-bg-elevated)'
        }}
        moreIcon={
          <Dropdown menu={{ items: menuItems }} trigger={['click']}>
            <span style={{ padding: '0 8px', cursor: 'pointer' }}>
              <EllipsisOutlined />
            </span>
          </Dropdown>
        }
      />
      {/* 「N 个标签」计数槽（UI 验收批次 #5）：原绝对定位 + borderLeft 竖线在右上角拼出
          一格「游离网格」，且与下一行字数列不对齐。改为行内 flex 项：与工具栏同 16px 右内边距、
          整行高度垂直居中，竖线删除——信息保留，观感归位。 */}
      <div style={{
        flex: '0 0 auto',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        paddingRight: 'var(--space-4)'
      }}>
        <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
          {chapters.length} 个标签
        </span>
      </div>
      {/* 原此处内联样式注入已全部迁入 global.css 的 .editor-tabs 作用域 */}
    </div>
  )
}

export default EditorTabs
