import { Layout, Button, Space, Typography } from 'antd'
import {
  FileTextOutlined,
  FolderOpenOutlined,
  UserOutlined,
  SettingOutlined,
  BarChartOutlined,
  BranchesOutlined,
  LeftOutlined
} from '@ant-design/icons'
import ChapterTree from '../Explorer/ChapterTree'
import CharacterPanel from '../Explorer/CharacterPanel'
import SettingPanel from '../Explorer/SettingPanel'
import StatsPanel from '../Explorer/StatsPanel'
import NarrativePanel from '../Explorer/NarrativePanel'
import { appRegionStyle } from '../../styles/css'
import type { WritingStatsView } from '../../pages/Workspace/hooks/useWritingStats'
import type { Chapter } from '@/common/ipc'

const { Sider } = Layout
const { Text } = Typography

export type SidebarTab = 'chapters' | 'characters' | 'settings' | 'stats' | 'narrative'

interface SidebarPanelProps {
  projectPath: string
  projectName: string
  tab: SidebarTab
  collapsed: boolean
  focusMode: boolean               // Sider collapsed = collapsed || focusMode（照搬原行为）
  chapters: Chapter[]
  selectedChapterId: string | null
  statsView: WritingStatsView
  dailyGoal: number
  onOpenChapter: (chapter: Chapter) => void
  onChaptersChanged: () => void
  /** Task 5 评审整改：卷操作成功后立刻把新鲜章并入会话（纵深防御，先于列表重拉） */
  onChaptersResync: (updates: Chapter[]) => void
  onBack: () => void
  onOpenSettings: () => void
  onSetTab: (tab: SidebarTab) => void
  onToggleCollapse: () => void
}

// 左侧边栏 —— Task 7 自原 Workspace/index.tsx 的 Sider 区块原样迁移：
// 项目头部 / Tab 切换 / 章节·角色·设定·统计·叙事五面板 / 收起按钮。
// tab 与 collapsed 仍由 Workspace 持有（菜单事件需驱动侧栏），此处只经回调上报。
function SidebarPanel({
  projectPath,
  projectName,
  tab,
  collapsed,
  focusMode,
  chapters,
  selectedChapterId,
  statsView,
  dailyGoal,
  onOpenChapter,
  onChaptersChanged,
  onChaptersResync,
  onBack,
  onOpenSettings,
  onSetTab,
  onToggleCollapse
}: SidebarPanelProps) {
  // 侧边栏Tab配置
  const sidebarTabs = [
    { key: 'chapters', label: '章节', icon: <FileTextOutlined /> },
    { key: 'characters', label: '角色', icon: <UserOutlined /> },
    { key: 'settings', label: '设定', icon: <SettingOutlined /> },
    { key: 'stats', label: '统计', icon: <BarChartOutlined /> },
    { key: 'narrative', label: '叙事', icon: <BranchesOutlined /> }
  ]

  return (
    <Sider
      width={collapsed ? 0 : 280}
      collapsedWidth={48}
      collapsed={collapsed || focusMode}
      style={{ background: 'var(--color-bg-elevated)', overflow: 'hidden' }}
    >
      {/* 顶部项目信息 —— 无边框窗口的拖拽带（UI 验收批次 #1）：
          行本体可拖窗，返回/设置两个按钮显式 no-drag 保持可点击（与 Home 页 Header 同法） */}
      <div style={{
        padding: collapsed ? '12px 0' : '12px 16px',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'space-between',
        ...appRegionStyle('drag')
      }}>
        {!collapsed && (
          <Space>
            <Button
              type="text"
              icon={<LeftOutlined />}
              onClick={onBack}
              style={{ color: 'var(--color-text)', ...appRegionStyle('no-drag') }}
            />
            <Text style={{ color: 'var(--color-text)', fontWeight: 500, fontSize: 13 }} ellipsis>
              {projectName}
            </Text>
          </Space>
        )}
        {!collapsed && (
          <Button
            type="text"
            icon={<SettingOutlined />}
            onClick={onOpenSettings}
            style={{ color: 'var(--color-text)', ...appRegionStyle('no-drag') }}
          />
        )}
        {collapsed && (
          <Button
            type="text"
            icon={<LeftOutlined />}
            onClick={onBack}
            style={{ color: 'var(--color-text)', ...appRegionStyle('no-drag') }}
          />
        )}
      </div>

      {/* 侧边栏Tab */}
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100% - 50px)' }}>
          {/* Tab按钮栏 */}
          <div style={{
            display: 'flex',
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-bg-base)'
          }}>
            {sidebarTabs.map(t => (
              // minWidth:0 是关键（UI 验收批次 #2）：flex 子项默认 min-width:auto 不会收缩到
              // 内容以下，5 个按钮 × min-content(~72px)=360px 撑破 280px Sider 的 overflow:hidden，
              // 「叙事」整槽被裁到看不见。放开收缩后 flex:1 均分 ≈56px，标签万一套不下走省略号。
              <Button
                key={t.key}
                className="sidebar-tab-btn"
                type="text"
                onClick={() => onSetTab(t.key as SidebarTab)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: 36,
                  borderRadius: 0,
                  color: tab === t.key ? 'var(--color-text)' : 'var(--color-text-secondary)',
                  background: tab === t.key ? 'var(--color-bg-elevated)' : 'transparent',
                  borderBottom: tab === t.key ? '2px solid var(--color-primary)' : '2px solid transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                  padding: '0 2px',
                  fontSize: 12,
                  overflow: 'hidden'
                }}
              >
                <span style={{ flexShrink: 0, display: 'inline-flex' }}>{t.icon}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.label}</span>
              </Button>
            ))}
          </div>

          {/* Tab内容区 */}
          <div style={{ flex: 1, overflow: 'auto', background: 'var(--color-bg-elevated)' }}>
            {tab === 'chapters' && (
              <ChapterTree
                projectPath={projectPath}
                chapters={chapters}
                selectedChapterId={selectedChapterId ?? undefined}
                onSelectChapter={onOpenChapter}
                onChapterChange={onChaptersChanged}
                onChaptersResync={onChaptersResync}
              />
            )}
            {tab === 'characters' && (
              <CharacterPanel
                projectPath={projectPath}
              />
            )}
            {tab === 'settings' && (
              <SettingPanel
                projectPath={projectPath}
              />
            )}
            {tab === 'stats' && (
              <StatsPanel
                todayWordCount={statsView.todayWordCount}
                totalWordCount={statsView.totalWordCount}
                writingDuration={statsView.todayMinutes}
                streak={statsView.streak}
                dailyGoal={dailyGoal}
                history={statsView.history}
                projectPath={projectPath}
              />
            )}
            {tab === 'narrative' && (
              <NarrativePanel
                projectPath={projectPath}
                chapters={chapters}
              />
            )}
          </div>
        </div>
      )}

      {/* 收起按钮 */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: '8px',
        borderTop: '1px solid var(--color-border)',
        textAlign: 'center'
      }}>
        <Button
          type="text"
          icon={collapsed ? <FolderOpenOutlined /> : <FolderOpenOutlined />}
          onClick={onToggleCollapse}
          style={{ color: 'var(--color-text-tertiary)' }}
        />
      </div>
    </Sider>
  )
}

export default SidebarPanel
