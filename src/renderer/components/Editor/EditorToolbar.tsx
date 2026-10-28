import { Space, Button, Tooltip, Dropdown } from 'antd'
import {
  BoldOutlined,
  ItalicOutlined,
  UnorderedListOutlined,
  OrderedListOutlined,
  SaveOutlined,
  UndoOutlined,
  RedoOutlined,
  EyeOutlined,
  EditOutlined,
  DownloadOutlined,
  ScanOutlined,
  StopOutlined
} from '@ant-design/icons'
import type { MenuProps } from 'antd'
import ThemeToggle from '../ThemeToggle'

interface EditorToolbarProps {
  onSave?: () => void
  onExport?: () => void
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
  // 整理本章（M4b Task 4）：AI 读本章 → 生成设定提案；organizeDisabled = 无当前章/已有未消化
  // 提案（并发门与徽章禁用面由 Workspace 汇总传入）。
  // M4c-2 Task 6（裁定 4）：organizing 期间按钮位改渲染「取消」→ onCancelOrganize（ai:cancel 通道）
  onOrganize?: () => void
  organizing?: boolean
  organizeDisabled?: boolean
  onCancelOrganize?: () => void
}

function EditorToolbar({
  onSave,
  onExport,
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
  onTitleChange,
  onOrganize,
  organizing = false,
  organizeDisabled = false,
  onCancelOrganize
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
        background: 'var(--color-bg-elevated)',
        borderBottom: '1px solid var(--color-border)',
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
            background: 'var(--color-bg-base)',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            padding: '4px 8px',
            color: 'var(--color-text)',
            fontSize: 14,
            width: 200
          }}
        />

        {/* 分隔线 */}
        <div style={{ width: 1, height: 20, background: 'var(--color-border-secondary)', margin: '0 8px' }} />

        {/* 撤销/重做 */}
        <Tooltip title="撤销 (Ctrl+Z)">
          <Button
            type="text"
            icon={<UndoOutlined />}
            onClick={onUndo}
            style={{ color: 'var(--color-text)' }}
          />
        </Tooltip>
        <Tooltip title="重做 (Ctrl+Y)">
          <Button
            type="text"
            icon={<RedoOutlined />}
            onClick={onRedo}
            style={{ color: 'var(--color-text)' }}
          />
        </Tooltip>

        {/* 分隔线 */}
        <div style={{ width: 1, height: 20, background: 'var(--color-border-secondary)', margin: '0 8px' }} />

        {/* 格式工具 */}
        <Tooltip title="粗体 (Ctrl+B)">
          <Button
            type="text"
            icon={<BoldOutlined />}
            onClick={onBold}
            style={{ color: 'var(--color-text)' }}
          />
        </Tooltip>
        <Tooltip title="斜体 (Ctrl+I)">
          <Button
            type="text"
            icon={<ItalicOutlined />}
            onClick={onItalic}
            style={{ color: 'var(--color-text)' }}
          />
        </Tooltip>

        {/* 标题级别 */}
        <Dropdown menu={{ items: headingItems, onClick: handleHeadingClick }} trigger={['click']}>
          <Button type="text" style={{ color: 'var(--color-text)' }}>
            标题
          </Button>
        </Dropdown>

        {/* 列表 */}
        <Tooltip title="无序列表">
          <Button
            type="text"
            icon={<UnorderedListOutlined />}
            onClick={() => onList?.('unordered')}
            style={{ color: 'var(--color-text)' }}
          />
        </Tooltip>
        <Tooltip title="有序列表">
          <Button
            type="text"
            icon={<OrderedListOutlined />}
            onClick={() => onList?.('ordered')}
            style={{ color: 'var(--color-text)' }}
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
              color: focusMode ? 'var(--color-primary)' : 'var(--color-text)',
              background: focusMode ? 'var(--color-primary-tint-bg)' : 'transparent'
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
              color: typewriterMode ? 'var(--color-primary)' : 'var(--color-text)',
              background: typewriterMode ? 'var(--color-primary-tint-bg)' : 'transparent'
            }}
          />
        </Tooltip>

        {/* 分隔线 */}
        <div style={{ width: 1, height: 20, background: 'var(--color-border-secondary)', margin: '0 8px' }} />

        {/* 整理本章按钮（M4b Task 4）：提案生成入口，disabled 汇总自 Workspace
            （无当前章 / 已有未消化提案）。M4c-2 Task 6（裁定 4）：在途期间原位改渲染「取消」，
            点击 → useOrganize.cancel() → ai:cancel(requestId)；ai:cancel 返回 false（已自行收尾）
            时不打断正常完成路径，本按钮随终态自然回到「整理本章」。 */}
        {organizing ? (
          <Tooltip title="停止本次整理（中止在途 AI 请求；已结束的请求无法撤回）">
            <Button type="text" danger icon={<StopOutlined />} onClick={onCancelOrganize}>
              取消
            </Button>
          </Tooltip>
        ) : (
          <Tooltip
            title={
              organizeDisabled
                ? '整理本章暂不可用：需有当前章节，且本章没有待处理的提案'
                : '整理本章（AI 通读本章，生成可逐条采纳的设定提案）'
            }
          >
            <Button
              type="text"
              icon={<ScanOutlined />}
              onClick={onOrganize}
              disabled={organizeDisabled}
              style={{ color: 'var(--color-text)' }}
            >
              整理本章
            </Button>
          </Tooltip>
        )}

        {/* 导出按钮 */}
        <Tooltip title="导出 (Ctrl+E)">
          <Button
            type="text"
            icon={<DownloadOutlined />}
            onClick={onExport}
            style={{ color: 'var(--color-text)' }}
          />
        </Tooltip>

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

        <ThemeToggle />

        {/* 字数统计 */}
        <span style={{ color: 'var(--color-text-secondary)', fontSize: 12, marginLeft: 8 }}>
          {wordCount.toLocaleString()} 字
        </span>
      </Space>
    </div>
  )
}

export default EditorToolbar
