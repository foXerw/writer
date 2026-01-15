import React from 'react'
import { Space, Button, Tooltip, Dropdown, Segmented } from 'antd'
import {
  BoldOutlined,
  ItalicOutlined,
  UnorderedListOutlined,
  OrderedListOutlined,
  ColumnWidthOutlined,
  SaveOutlined,
  UndoOutlined,
  RedoOutlined,
  EyeOutlined,
  EditOutlined
} from '@ant-design/icons'
import type { MenuProps } from 'antd'

interface EditorToolbarProps {
  onSave?: () => void
  onUndo?: () => void
  onRedo?: () => void
  onBold?: () => void
  onItalic?: () => void
  onHeading?: (level: number) => void
  onList?: (type: 'ordered' | 'unordered') => void
  focusMode?: boolean
  typewriterMode?: boolean
  onToggleFocus?: (value: boolean) => void
  onToggleTypewriter?: (value: boolean) => void
  wordCount?: number
  chapterTitle?: string
  onTitleChange?: (title: string) => void
}

function EditorToolbar({
  onSave,
  onUndo,
  onRedo,
  onBold,
  onItalic,
  onHeading,
  onList,
  focusMode = false,
  typewriterMode = false,
  onToggleFocus,
  onToggleTypewriter,
  wordCount = 0,
  chapterTitle = '',
  onTitleChange
}: EditorToolbarProps) {
  // 标题级别菜单
  const headingItems: MenuProps['items'] = [
    { key: '1', label: '一级标题' },
    { key: '2', label: '二级标题' },
    { key: '3', label: '三级标题' },
    { key: '4', label: '四级标题' }
  ]

  const handleHeadingClick: MenuProps['onClick'] = ({ key }) => {
    onHeading?.(parseInt(key))
  }

  return (
    <div
      style={{
        height: 40,
        padding: '0 16px',
        background: '#252526',
        borderBottom: '1px solid #333',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}
    >
      {/* 左侧：章节标题和基本工具 */}
      <Space size="small">
        {/* 章节标题输入 */}
        <input
          type="text"
          value={chapterTitle}
          onChange={(e) => onTitleChange?.(e.target.value)}
          placeholder="章节标题"
          style={{
            background: '#1e1e1e',
            border: '1px solid #333',
            borderRadius: 4,
            padding: '4px 8px',
            color: '#d4d4d4',
            fontSize: 14,
            width: 200
          }}
        />

        {/* 分隔线 */}
        <div style={{ width: 1, height: 20, background: '#444', margin: '0 8px' }} />

        {/* 撤销/重做 */}
        <Tooltip title="撤销 (Ctrl+Z)">
          <Button
            type="text"
            icon={<UndoOutlined />}
            onClick={onUndo}
            style={{ color: '#d4d4d4' }}
          />
        </Tooltip>
        <Tooltip title="重做 (Ctrl+Y)">
          <Button
            type="text"
            icon={<RedoOutlined />}
            onClick={onRedo}
            style={{ color: '#d4d4d4' }}
          />
        </Tooltip>

        {/* 分隔线 */}
        <div style={{ width: 1, height: 20, background: '#444', margin: '0 8px' }} />

        {/* 格式工具 */}
        <Tooltip title="粗体 (Ctrl+B)">
          <Button
            type="text"
            icon={<BoldOutlined />}
            onClick={onBold}
            style={{ color: '#d4d4d4' }}
          />
        </Tooltip>
        <Tooltip title="斜体 (Ctrl+I)">
          <Button
            type="text"
            icon={<ItalicOutlined />}
            onClick={onItalic}
            style={{ color: '#d4d4d4' }}
          />
        </Tooltip>

        {/* 标题级别 */}
        <Dropdown menu={{ items: headingItems, onClick: handleHeadingClick }} trigger={['click']}>
          <Button type="text" style={{ color: '#d4d4d4' }}>
            标题
          </Button>
        </Dropdown>

        {/* 列表 */}
        <Tooltip title="无序列表">
          <Button
            type="text"
            icon={<UnorderedListOutlined />}
            onClick={() => onList?.('unordered')}
            style={{ color: '#d4d4d4' }}
          />
        </Tooltip>
        <Tooltip title="有序列表">
          <Button
            type="text"
            icon={<OrderedListOutlined />}
            onClick={() => onList?.('ordered')}
            style={{ color: '#d4d4d4' }}
          />
        </Tooltip>
      </Space>

      {/* 右侧：模式切换和保存 */}
      <Space size="small">
        {/* 专注模式开关 */}
        <Tooltip title="专注模式 (F8)">
          <Button
            type="text"
            icon={<EyeOutlined />}
            onClick={() => onToggleFocus?.(!focusMode)}
            style={{
              color: focusMode ? '#1890ff' : '#d4d4d4',
              background: focusMode ? 'rgba(24, 144, 255, 0.1)' : 'transparent'
            }}
          />
        </Tooltip>

        {/* 打字机模式开关 */}
        <Tooltip title="打字机模式 (F9)">
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => onToggleTypewriter?.(!typewriterMode)}
            style={{
              color: typewriterMode ? '#1890ff' : '#d4d4d4',
              background: typewriterMode ? 'rgba(24, 144, 255, 0.1)' : 'transparent'
            }}
          />
        </Tooltip>

        {/* 分隔线 */}
        <div style={{ width: 1, height: 20, background: '#444', margin: '0 8px' }} />

        {/* 保存按钮 */}
        <Tooltip title="保存 (Ctrl+S)">
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={onSave}
            size="small"
          >
            保存
          </Button>
        </Tooltip>

        {/* 字数统计 */}
        <span style={{ color: '#888', fontSize: 12, marginLeft: 8 }}>
          {wordCount.toLocaleString()} 字
        </span>
      </Space>
    </div>
  )
}

export default EditorToolbar
