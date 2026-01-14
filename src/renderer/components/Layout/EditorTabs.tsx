import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Tabs } from 'antd'
import { CloseOutlined } from '@ant-design/icons'
import type { TabsProps } from 'antd'
import type { Chapter } from '../../common/ipc'

interface EditorTab {
  id: string
  title: string
  content: string
  chapter: Chapter
}

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
  const [activeKey, setActiveKey] = useState<string>('')

  // 初始化activeKey
  useEffect(() => {
    if (currentChapter && activeKey !== currentChapter.id) {
      setActiveKey(currentChapter.id)
    }
  }, [currentChapter])

  // 转换为Antd Tabs items
  const items: TabsProps['items'] = chapters.map((chapter) => ({
    key: chapter.id,
    label: (
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>{chapter.title || '无标题'}</span>
        {chapter.status === 'completed' && (
          <span style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#52c41a'
          }} />
        )}
        <CloseOutlined
          className="tab-close"
          onClick={(e) => {
            e.stopPropagation()
            onCloseChapter(chapter.id)
          }}
          style={{
            fontSize: 12,
            color: '#888',
            marginLeft: 4
          }}
        />
      </span>
    ),
    children: null
  }))

  // Tab切换
  const handleChange = (key: string) => {
    setActiveKey(key)
    const chapter = chapters.find(c => c.id === key)
    if (chapter) {
      onSelectChapter(chapter)
    }
  }

  // Tab关闭
  const handleClose = (key: string) => {
    onCloseChapter(key)
  }

  // 关闭其他Tab
  const handleCloseOthers = () => {
    if (currentChapter) {
      chapters.filter(c => c.id !== currentChapter.id).forEach(c => {
        onCloseChapter(c.id)
      })
    }
  }

  // 关闭全部
  const handleCloseAll = () => {
    chapters.forEach(c => {
      onCloseChapter(c.id)
    })
    setActiveKey('')
  }

  return (
    <div style={{
      height: 40,
      background: '#252526',
      borderBottom: '1px solid #333',
      display: 'flex',
      alignItems: 'center'
    }}>
      <Tabs
        activeKey={activeKey}
        items={items}
        onChange={handleChange}
        onEdit={handleClose}
        hideAdd
        type="editable-card"
        size="small"
        style={{ width: '100%', marginBottom: 0 }}
        tabBarStyle={{
          margin: 0,
          paddingLeft: 8,
          background: '#252526'
        }}
        moreIcon={<span style={{ color: '#888' }}>···</span>}
      />
      <div style={{
        padding: '0 8px',
        borderLeft: '1px solid #333',
        height: '100%',
        display: 'flex',
        alignItems: 'center'
      }}>
        <span style={{ fontSize: 12, color: '#888' }}>
          {chapters.length} 个打开
        </span>
      </div>

      <style>{`
        .ant-tabs-tab {
          background: #2d2d2d !important;
          border: none !important;
          margin-right: 4px !important;
        }
        .ant-tabs-tab-active {
          background: #1e1e1e !important;
        }
        .ant-tabs-tab .anticon {
          color: #888;
        }
        .ant-tabs-tab-active .anticon {
          color: #58a6ff;
        }
        .tab-close:hover {
          color: #ff4d4f !important;
        }
        .ant-tabs-nav::before {
          border-bottom: none !important;
        }
      `}</style>
    </div>
  )
}

export default EditorTabs
