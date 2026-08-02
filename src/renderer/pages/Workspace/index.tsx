import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Layout, Button, Space, Typography, App } from 'antd'
import {
  FileTextOutlined,
  PlusOutlined,
  FolderOpenOutlined,
  UserOutlined,
  SettingOutlined,
  BarChartOutlined,
  BookOutlined,
  LeftOutlined
} from '@ant-design/icons'
import MonacoEditor from '../../components/Editor/MonacoEditor'
import EditorToolbar from '../../components/Editor/EditorToolbar'
import EditorTabs from '../../components/Layout/EditorTabs'
import ChapterTree from '../../components/Explorer/ChapterTree'
import CharacterPanel from '../../components/Explorer/CharacterPanel'
import SettingPanel from '../../components/Explorer/SettingPanel'
import StatsPanel from '../../components/Explorer/StatsPanel'
import CommandPalette from '../../components/Dialogs/CommandPalette'
import ExportDialog from '../../components/Dialogs/ExportDialog'
import type { ExportOptions } from '../../components/Dialogs/ExportDialog'
import OutlineView from '../../components/Editor/OutlineView'
import type { MonacoEditorHandle } from '../../components/Editor/MonacoEditor'
import { useMenu } from '../../hooks/useMenu'
import { startAutoSave, stopAutoSave, saveFileDialog, writeFile, getStats, saveStats, exportDocument } from '../../services/ipcService'
import { assembleMarkdown, sanitizeFilename } from '../../services/exportService'
import {
  EMPTY_STATS, addWords, addMinutes, todayWords, todayMinutes,
  computeStreak, recentHistory, STATS_DURATION_TICK_MS, STATS_IDLE_THRESHOLD_MS
} from '../../services/statsService'
import { useEditorStore, useShortcutStore } from '../../stores'
import { useChapter } from '../../hooks/useIPC'
import { useKeyboard } from '../../hooks/useKeyboard'
import type { Chapter, ProjectConfig } from '@/common/ipc'
import type { StatsData } from '@/common/ipc'

const { Header, Content, Sider } = Layout
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { Text, Title } = Typography

interface WorkspaceState {
  project?: { name: string; path: string }
  projectPath?: string
  config?: ProjectConfig
}

type SidebarTab = 'chapters' | 'characters' | 'settings' | 'stats'

function Workspace() {
  const location = useLocation()
  const navigate = useNavigate()
  const state = location.state as WorkspaceState
  const { message } = App.useApp()

  const { fontSize, wordWrap, showLineNumbers } = useEditorStore()
  const setShortcutDialogOpen = useShortcutStore((s) => s.setDialogOpen)
  const editorRef = useRef<MonacoEditorHandle>(null)

  const { getAllChapters, createChapter, updateChapter, deleteChapter } = useChapter()

  // 侧边栏状态
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('chapters')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // 章节状态
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [openedChapters, setOpenedChapters] = useState<Chapter[]>([])
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null)
  const [editorContent, setEditorContent] = useState('')
  const [chapterTitle, setChapterTitle] = useState('')

  // 模式状态
  const [focusMode, setFocusMode] = useState(false)
  const [typewriterMode, setTypewriterMode] = useState(false)

  // 命令面板
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [outlineVisible, setOutlineVisible] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [loading, setLoading] = useState(false)

  // 写作统计：今日字数/时长/历史（持久化于项目目录）
  const [stats, setStats] = useState<StatsData>(EMPTY_STATS)
  const statsRef = useRef(stats)
  statsRef.current = stats
  const statsLoadedRef = useRef(false)
  const prevLenRef = useRef(0)           // 当前章上一刻长度，用于增量
  const lastActivityRef = useRef(0)      // 最近一次按键时间戳

  const projectPath = state?.project?.path || state?.projectPath
  // 镜像 ref：供 beforeunload 的 []-deps effect 避免陈旧闭包
  const projectPathRef = useRef(projectPath)
  projectPathRef.current = projectPath
  const projectName = state?.project?.name || '未命名项目'
  const config = state?.config
  const autoSaveEnabled = config?.autoSave ?? true
  const autoSaveInterval = config?.autoSaveInterval ?? 30000
  const isDirtyRef = useRef(false)
  const editorContentRef = useRef(editorContent)
  useEffect(() => {
    editorContentRef.current = editorContent
  }, [editorContent])
  // 镜像 LIVE current chapter id，每次渲染更新，确保异步 resolve 时读到最新值。
  const currentChapterIdRef = useRef<string | null>(currentChapter?.id ?? null)
  currentChapterIdRef.current = currentChapter?.id ?? null

  // 加载章节列表
  useEffect(() => {
    if (projectPath) {
      loadChapters()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在 projectPath 变化时加载
  }, [projectPath])

  const loadChapters = async () => {
    if (!projectPath) return
    setLoading(true)
    try {
      const data = await getAllChapters(projectPath)
      // 载入项目写作统计
      try {
        const loaded = await getStats(projectPath)
        setStats(loaded && loaded.dailyHistory ? loaded : EMPTY_STATS)
      } catch (e) {
        console.error('载入统计失败:', e)
        setStats(EMPTY_STATS)
      }
      statsLoadedRef.current = true
      setChapters(data)
      if (data.length > 0) {
        const firstChapter = data[0]
        setOpenedChapters([firstChapter])
        selectChapter(firstChapter)
      }
    } catch (error) {
      console.error('加载章节失败:', error)
    } finally {
      setLoading(false)
    }
  }

  // 打开章节
  const handleOpenChapter = (chapter: Chapter) => {
    setOpenedChapters(prev => {
      if (prev.find(c => c.id === chapter.id)) {
        return prev
      }
      return [...prev, chapter]
    })
    selectChapter(chapter)
  }

  // 关闭章节
  const handleCloseChapter = (chapterId: string) => {
    setOpenedChapters(prev => {
      const filtered = prev.filter(c => c.id !== chapterId)
      if (currentChapter?.id === chapterId && filtered.length > 0) {
        selectChapter(filtered[0])
      }
      return filtered
    })
  }

  // 选择章节
  const selectChapter = (chapter: Chapter) => {
    flushIfDirty() // 先保存即将离开的当前章（若脏）
    setCurrentChapter(chapter)
    setEditorContent(chapter.content)
    setChapterTitle(chapter.title)
    prevLenRef.current = chapter.content.length   // 切章不计增量
  }

  // 新建章节
  const handleCreateChapter = async () => {
    if (!projectPath) return
    const title = `新章节 ${chapters.length + 1}`
    try {
      const newChapter = await createChapter(projectPath, title)
      setChapters([...chapters, newChapter])
      handleOpenChapter(newChapter)
      message.success('章节创建成功')
    } catch (error) {
      message.error('章节创建失败')
    }
  }

  // 保存当前章节到磁盘。silent=true 用于切章/返回/关窗/自动保存的静默 flush。
  const saveCurrentChapter = async (opts?: { silent?: boolean }): Promise<void> => {
    if (!currentChapter || !projectPath) return
    // 静默 flush：无脏数据则跳过；手动保存（silent=false）尊重显式 Ctrl+S，不门控 dirty。
    if (opts?.silent && !isDirtyRef.current) return
    const outgoing = currentChapter
    try {
      const updated = await updateChapter(projectPath, {
        ...outgoing,
        title: chapterTitle,
        content: editorContent
      })
      // 函数式更新避免陈旧闭包；仅当仍是同一章时同步 currentChapter，防止切走后被回写。
      setChapters(prev => prev.map(c => (c.id === updated.id ? updated : c)))
      setOpenedChapters(prev => prev.map(c => (c.id === updated.id ? updated : c)))
      setCurrentChapter(prev => (prev && prev.id === updated.id ? updated : prev))
      // 仅当仍是同一章时才清 dirty，防止「切章 + 编辑新章」期间被陈旧回写清掉新章脏标记。
      if (currentChapterIdRef.current === outgoing.id) {
        isDirtyRef.current = false
      }
      if (!opts?.silent) {
        message.success('保存成功')
      }
    } catch (error) {
      if (opts?.silent) {
        message.error('自动保存失败，请手动保存 (Ctrl+S)')
      } else {
        message.error('保存失败')
      }
    }
  }

  // 手动保存（Ctrl+S / 菜单保存 / 工具栏）：带成功提示，不门控 dirty。
  const handleSave = () => {
    void saveCurrentChapter({ silent: false })
  }

  // 静默 flush 脏数据：切章 / 返回 / 关窗 / 自动保存调用。
  const flushIfDirty = () => {
    void saveCurrentChapter({ silent: true })
  }

  const flushIfDirtyRef = useRef(flushIfDirty)
  useEffect(() => {
    flushIfDirtyRef.current = flushIfDirty
  })

  // 编辑器内容变化包装：置 dirty
  const handleEditorChange = (val: string) => {
    setEditorContent(val)
    isDirtyRef.current = true
    // 正向字数增量累计今日；记录活跃时间戳
    const delta = val.length - prevLenRef.current
    prevLenRef.current = val.length
    if (delta > 0) {
      setStats(s => addWords(s, delta))
    }
    lastActivityRef.current = Date.now()
  }

  // 自动保存：按配置间隔静默写盘（不弹 toast）
  useEffect(() => {
    if (!currentChapter || !autoSaveEnabled) return
    startAutoSave({
      interval: autoSaveInterval,
      onSave: () => {
        void flushIfDirtyRef.current()
        return editorContentRef.current
      }
    })
    return () => stopAutoSave()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 故意只依赖章节 id（切换章时重启定时器），非整个 currentChapter 对象
  }, [currentChapter?.id, autoSaveEnabled, autoSaveInterval])

  // 写作时长：每 60s，若近 IDLE 阈值内有按键则今日 +1 分钟
  useEffect(() => {
    if (!projectPath) return
    const timer = setInterval(() => {
      if (Date.now() - lastActivityRef.current < STATS_IDLE_THRESHOLD_MS) {
        setStats(s => addMinutes(s, 1))
      }
    }, STATS_DURATION_TICK_MS)
    return () => clearInterval(timer)
  }, [projectPath])

  // 统计持久化：变化后防抖 3s 写盘
  useEffect(() => {
    if (!projectPath || !statsLoadedRef.current) return
    const t = setTimeout(() => { void saveStats(projectPath, stats) }, 3000)
    return () => clearTimeout(t)
  }, [stats, projectPath])

  // 关窗/退出兜底：fire-and-forget 触发一次 flush（异步 IPC，尽力而为）。
  // 主要保障是切章/返回的显式 flush；此处为最后兜底。
  useEffect(() => {
    const handler = () => {
      flushIfDirtyRef.current()
      if (projectPathRef.current) void saveStats(projectPathRef.current, statsRef.current)
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // 删除章节
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleDeleteChapter = async (chapterId: string) => {
    if (!projectPath) return
    try {
      await deleteChapter(projectPath, chapterId)
      setChapters(chapters.filter(c => c.id !== chapterId))
      setOpenedChapters(prev => prev.filter(c => c.id !== chapterId))
      if (currentChapter?.id === chapterId) {
        setCurrentChapter(null)
        setEditorContent('')
        setChapterTitle('')
      }
      message.success('章节已删除')
    } catch (error) {
      message.error('删除失败')
    }
  }

  // 返回首页
  const handleBack = () => {
    flushIfDirty()
    if (projectPath) void saveStats(projectPath, statsRef.current)
    navigate('/')
  }

  // 导出 Markdown：flush 当前章 → 磁盘读权威章节 → 按范围选 → 拼装 → 保存框 → 写盘
  const handleExport = async (options: ExportOptions): Promise<{ ok: boolean }> => {
    if (!projectPath) return { ok: false }
    // 1) 先把当前章未保存编辑落盘（复用批次1 chokepoint）
    await saveCurrentChapter({ silent: true })
    // 2) 从磁盘读权威最新章节列表，按 order 排序
    const all = await getAllChapters(projectPath)
    const sorted = [...all].sort((a, b) => a.order - b.order)
    // 3) 按范围选章
    let selected: Chapter[]
    if (options.includeChapters === 'current') {
      selected = sorted.filter(c => c.id === currentChapter?.id)
    } else if (options.includeChapters === 'selected') {
      const ids = options.selectedChapterIds ?? []
      selected = sorted.filter(c => ids.includes(c.id))
    } else {
      selected = sorted
    }
    // 4) 空集合兜底
    if (selected.length === 0) {
      message.warning('无章节可导出')
      return { ok: false }
    }
    // 5) 按格式选扩展名 + 过滤器
    const fmt = options.format
    const ext = fmt === 'word' ? 'docx' : fmt === 'pdf' ? 'pdf' : fmt === 'epub' ? 'epub' : 'md'
    const filterName = fmt === 'word' ? 'Word' : fmt === 'pdf' ? 'PDF' : fmt === 'epub' ? 'ePub' : 'Markdown'
    const savePath = await saveFileDialog(`${sanitizeFilename(projectName)}.${ext}`, [
      { name: filterName, extensions: [ext] }
    ])
    if (!savePath) return { ok: false }
    // 6) 生成/写盘：markdown 走本地拼装；word/pdf/epub 走主进程
    let ok = false
    try {
      if (fmt === 'markdown') {
        const md = assembleMarkdown({
          projectName,
          chapters: selected,
          addFrontMatter: options.options?.addFrontMatter ?? true,
          addToc: options.options?.addToc ?? true,
          date: new Date().toISOString().slice(0, 10)
        })
        ok = await writeFile(savePath, md)
      } else {
        ok = await exportDocument(fmt as 'word' | 'pdf' | 'epub', {
          chapters: selected,
          projectName,
          options: {
            addFrontMatter: options.options?.addFrontMatter ?? true,
            addToc: options.options?.addToc ?? true
          },
          savePath
        })
      }
    } catch (e) {
      console.error('导出失败:', e)
      ok = false
    }
    if (ok) {
      message.success('导出成功')
      return { ok: true }
    }
    message.error('导出失败')
    return { ok: false }
  }

  // 命令面板处理
  const handleCommand = useCallback((command: string) => {
    switch (command) {
      case 'file:save':
        handleSave()
        break
      case 'chapter:new':
        handleCreateChapter()
        break
      case 'view:focusMode':
        setFocusMode(prev => !prev)
        break
      case 'view:typewriterMode':
        setTypewriterMode(prev => !prev)
        break
      default:
        break
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖 chapters/模式状态；命令内调用的 handler 非稳定引用，按现状即可
  }, [chapters, focusMode, typewriterMode])

  // 菜单栏事件
  useMenu((event, ...args) => {
    switch (event) {
      case 'newChapter':
        handleCreateChapter()
        break
      case 'save':
        handleSave()
        break
      case 'focusMode':
        setFocusMode(args[0] as boolean)
        break
      case 'typewriterMode':
        setTypewriterMode(args[0] as boolean)
        break
      case 'toggleOutline':
        setOutlineVisible((v) => !v)
        break
      case 'toggleChapterTree':
        setSidebarCollapsed((v) => !v)
        break
      case 'characters':
        setSidebarTab('characters')
        setSidebarCollapsed(false)
        break
      case 'settings': // 菜单「世界观设定」(Ctrl+2) → 侧栏设定 tab（非偏好页）
        setSidebarTab('settings')
        setSidebarCollapsed(false)
        break
      case 'wordCount':
      case 'dailyStats':
        setSidebarTab('stats')
        setSidebarCollapsed(false)
        break
      // 'plot' (Ctrl+3) 无对应面板，暂不处理
      case 'export':
        setExportDialogOpen(true)
        break
      case 'shortcuts':
        setShortcutDialogOpen(true)
        break
      default:
        break
    }
  })

  // 键盘快捷键
  useKeyboard({
    onSave: handleSave,
    onNew: handleCreateChapter,
    onToggleFocusMode: () => setFocusMode(prev => !prev),
    onToggleTypewriterMode: () => setTypewriterMode(prev => !prev),
    onToggleCommandPalette: () => setCommandPaletteOpen(prev => !prev),
    onToggleSidebar: () => setSidebarCollapsed((v) => !v),
    onOutline: () => setOutlineVisible((v) => !v)
  })

  // 侧边栏Tab配置
  const sidebarTabs = [
    { key: 'chapters', label: '章节', icon: <FileTextOutlined /> },
    { key: 'characters', label: '角色', icon: <UserOutlined /> },
    { key: 'settings', label: '设定', icon: <SettingOutlined /> },
    { key: 'stats', label: '统计', icon: <BarChartOutlined /> }
  ]

  return (
    <Layout style={{ height: '100vh' }}>
      {/* 命令面板 */}
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onExecute={handleCommand}
      />
      <ExportDialog
        open={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        chapters={chapters}
        projectName={projectName}
        onExport={handleExport}
      />

      {/* 左侧边栏 */}
      <Sider
        width={sidebarCollapsed ? 0 : 280}
        collapsedWidth={48}
        collapsed={sidebarCollapsed || focusMode}
        theme="dark"
        style={{ background: '#252526', overflow: 'hidden' }}
      >
        {/* 顶部项目信息 */}
        <div style={{
          padding: sidebarCollapsed ? '12px 0' : '12px 16px',
          borderBottom: '1px solid #333',
          display: 'flex',
          alignItems: 'center',
          justifyContent: sidebarCollapsed ? 'center' : 'space-between'
        }}>
          {!sidebarCollapsed && (
            <Space>
              <Button
                type="text"
                icon={<LeftOutlined />}
                onClick={handleBack}
                style={{ color: '#d4d4d4' }}
              />
              <Text style={{ color: '#d4d4d4', fontWeight: 500, fontSize: 13 }} ellipsis>
                {projectName}
              </Text>
            </Space>
          )}
          {!sidebarCollapsed && (
            <Button
              type="text"
              icon={<SettingOutlined />}
              onClick={() => navigate('/settings')}
              style={{ color: '#d4d4d4' }}
            />
          )}
          {sidebarCollapsed && (
            <Button
              type="text"
              icon={<LeftOutlined />}
              onClick={handleBack}
              style={{ color: '#d4d4d4' }}
            />
          )}
        </div>

        {/* 侧边栏Tab */}
        {!sidebarCollapsed && (
          <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100% - 50px)' }}>
            {/* Tab按钮栏 */}
            <div style={{
              display: 'flex',
              borderBottom: '1px solid #333',
              background: '#1e1e1e'
            }}>
              {sidebarTabs.map(tab => (
                <Button
                  key={tab.key}
                  type="text"
                  onClick={() => setSidebarTab(tab.key as SidebarTab)}
                  style={{
                    flex: 1,
                    height: 36,
                    borderRadius: 0,
                    color: sidebarTab === tab.key ? '#fff' : '#888',
                    background: sidebarTab === tab.key ? '#252526' : 'transparent',
                    borderBottom: sidebarTab === tab.key ? '2px solid #1890ff' : '2px solid transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    fontSize: 12
                  }}
                >
                  {tab.icon}
                  {tab.label}
                </Button>
              ))}
            </div>

            {/* Tab内容区 */}
            <div style={{ flex: 1, overflow: 'auto', background: '#252526' }}>
              {sidebarTab === 'chapters' && (
                <ChapterTree
                  projectPath={projectPath || ''}
                  chapters={chapters}
                  selectedChapterId={currentChapter?.id}
                  onSelectChapter={handleOpenChapter}
                  onChapterChange={loadChapters}
                />
              )}
              {sidebarTab === 'characters' && (
                <CharacterPanel
                  projectPath={projectPath || ''}
                />
              )}
              {sidebarTab === 'settings' && (
                <SettingPanel
                  projectPath={projectPath || ''}
                />
              )}
              {sidebarTab === 'stats' && (
                <StatsPanel
                  todayWordCount={todayWords(stats)}
                  totalWordCount={chapters.reduce((sum, c) => sum + c.wordCount, 0)}
                  writingDuration={todayMinutes(stats)}
                  streak={computeStreak(stats)}
                  dailyGoal={config?.dailyGoal ?? 2000}
                  history={recentHistory(stats, 14)}
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
          borderTop: '1px solid #333',
          textAlign: 'center'
        }}>
          <Button
            type="text"
            icon={sidebarCollapsed ? <FolderOpenOutlined /> : <FolderOpenOutlined />}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            style={{ color: '#666' }}
          />
        </div>
      </Sider>

      {/* 主内容区 */}
      <Layout>
        {/* Tab栏 */}
        <EditorTabs
          chapters={openedChapters}
          currentChapter={currentChapter}
          onSelectChapter={handleOpenChapter}
          onCloseChapter={handleCloseChapter}
          onSaveChapter={handleSave}
        />

        {/* 工具栏 */}
        <Header style={{
          padding: 0,
          background: '#1e1e1e',
          height: 'auto',
          lineHeight: 'normal'
        }}>
          <EditorToolbar
            onSave={handleSave}
            onExport={() => setExportDialogOpen(true)}
            chapterTitle={chapterTitle}
            onTitleChange={setChapterTitle}
            wordCount={editorContent.length}
            focusMode={focusMode}
            typewriterMode={typewriterMode}
            onToggleFocus={setFocusMode}
            onToggleTypewriter={setTypewriterMode}
          />
        </Header>

        {/* 编辑器 + 大纲 */}
        <Layout>
          <Content style={{ background: '#1e1e1e', padding: 0, flex: 1 }}>
            {currentChapter ? (
              <MonacoEditor
                ref={editorRef}
                value={editorContent}
                onChange={handleEditorChange}
                onSave={handleSave}
                focusMode={focusMode}
                typewriterMode={typewriterMode}
                fontSize={fontSize}
                wordWrap={wordWrap}
                showLineNumbers={showLineNumbers}
              />
            ) : (
              <div style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#666'
              }}>
                <BookOutlined style={{ fontSize: 48, marginBottom: 16 }} />
                <Text style={{ color: '#888' }}>
                  {chapters.length === 0 ? '暂无章节，点击新建章节开始创作' : '选择一个章节开始编辑'}
                </Text>
                {chapters.length === 0 && (
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={handleCreateChapter}
                    style={{ marginTop: 16 }}
                  >
                    新建章节
                  </Button>
                )}
              </div>
            )}
          </Content>

          {outlineVisible && currentChapter && (
            <Sider
              width={260}
              theme="dark"
              style={{ background: '#252526', borderLeft: '1px solid #333', overflow: 'auto' }}
            >
              <OutlineView
                content={editorContent}
                onNavigateToLine={(ln) => editorRef.current?.revealLineInCenter(ln)}
              />
            </Sider>
          )}
        </Layout>
      </Layout>
    </Layout>
  )
}

export default Workspace
