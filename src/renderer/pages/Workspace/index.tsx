import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Layout, Button, Typography, App } from 'antd'
import { PlusOutlined, BookOutlined, SaveOutlined } from '@ant-design/icons'
import MonacoEditor, { type MonacoEditorHandle } from '../../components/Editor/MonacoEditor'
import EditorToolbar from '../../components/Editor/EditorToolbar'
import EditorTabs from '../../components/Layout/EditorTabs'
import OutlineView from '../../components/Editor/OutlineView'
import SidebarPanel, { type SidebarTab } from '../../components/Workspace/SidebarPanel'
import CommandPalette from '../../components/Dialogs/CommandPalette'
import ExportDialog, { type ExportOptions } from '../../components/Dialogs/ExportDialog'
import { useMenu } from '../../hooks/useMenu'
import { useKeyboard } from '../../hooks/useKeyboard'
import { useChapter, useDialog, useExport, useFile } from '../../hooks/useIPC'
import { assembleMarkdown, sanitizeFilename } from '../../services/exportService'
import { useEditorStore, useShortcutStore } from '../../stores'
import { useEditorSession } from './hooks/useEditorSession'
import { useWritingStats } from './hooks/useWritingStats'
import { useAutoSave } from './hooks/useAutoSave'
import type { Chapter, ProjectConfig } from '@/common/ipc'
import { countWords } from '@/common/wordCount'

const { Header, Content, Sider } = Layout
const { Text } = Typography

interface WorkspaceState {
  project?: { name: string; path: string }
  projectPath?: string
  config?: ProjectConfig
}

function Workspace() {
  const location = useLocation()
  const navigate = useNavigate()
  const state = location.state as WorkspaceState
  const { message } = App.useApp()

  const { fontSize, wordWrap, showLineNumbers } = useEditorStore()
  const setShortcutDialogOpen = useShortcutStore((s) => s.setDialogOpen)
  const editorRef = useRef<MonacoEditorHandle>(null)

  const { getAllChapters } = useChapter()
  const { exportDocument } = useExport()
  const { saveFile } = useDialog()
  const { writeFile } = useFile()

  // 路由参数与项目配置
  const projectPath = state?.project?.path || state?.projectPath
  const projectName = state?.project?.name || '未命名项目'
  const config = state?.config
  const autoSaveEnabled = config?.autoSave ?? true
  const autoSaveInterval = config?.autoSaveInterval ?? 30000

  // 侧边栏状态（菜单事件需要驱动，故保留在 Workspace）
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('chapters')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  // 模式状态
  const [focusMode, setFocusMode] = useState(false)
  const [typewriterMode, setTypewriterMode] = useState(false)
  // 命令面板 / 大纲 / 导出对话框
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [outlineVisible, setOutlineVisible] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)

  // 章节会话：save/flush 并发语义（dirty 门控 / LIVE id 镜像 / 函数式回写）全部在 hook 内
  const session = useEditorSession(projectPath)
  const { chapters, openedChapters, currentChapter, editorContent, chapterTitle, setChapterTitle,
    loadChapters, openChapter, closeChapter, createChapter, save, flushIfDirty, handleEditorChange } = session

  // 写作统计：countWords 增量（切章重置基线）/ 60s 活跃分钟 / 3s 防抖落盘
  const stats = useWritingStats({ projectPath, chapters, editorContent, currentChapterId: currentChapter?.id ?? null })
  const { persistNow } = stats

  // 自动保存：按项目配置间隔静默 flush（取代原 services/autoSave.ts）
  useAutoSave({ enabled: autoSaveEnabled, intervalMs: autoSaveInterval, chapterId: currentChapter?.id ?? null, flush: flushIfDirty })

  // 关窗/退出兜底：fire-and-forget flush + 统计落盘（稳定引用，内部读最新镜像）；主要保障仍是切章/返回的显式 flush
  useEffect(() => {
    const handler = () => { flushIfDirty(); persistNow() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [flushIfDirty, persistNow])

  // 返回首页：先 fire-and-forget flush + 统计落盘，再路由
  const handleBack = () => { flushIfDirty(); persistNow(); navigate('/') }

  // 手动保存（Ctrl+S / 菜单保存 / 工具栏）：带成功提示，不门控 dirty。
  const handleSave = () => { void save({ silent: false }) }

  // 导出 Markdown：flush 当前章 → 磁盘读权威章节 → 按范围选 → 拼装 → 保存框 → 写盘
  const handleExport = async (options: ExportOptions): Promise<{ ok: boolean }> => {
    if (!projectPath) return { ok: false }
    // 1) 先把当前章未保存编辑落盘（复用批次1 chokepoint）
    await save({ silent: true })
    // 2) 从磁盘读权威最新章节列表，按 order 排序
    const all = await getAllChapters(projectPath)
    const sorted = [...all].sort((a, b) => a.order - b.order)
    // 3) 按范围选章
    let selected: Chapter[]
    if (options.includeChapters === 'current') selected = sorted.filter(c => c.id === currentChapter?.id)
    else if (options.includeChapters === 'selected') {
      const ids = options.selectedChapterIds ?? []
      selected = sorted.filter(c => ids.includes(c.id))
    } else selected = sorted
    // 4) 空集合兜底
    if (selected.length === 0) { message.warning('无章节可导出'); return { ok: false } }
    // 5) 按格式选扩展名 + 过滤器
    const fmt = options.format
    const ext = fmt === 'word' ? 'docx' : fmt === 'pdf' ? 'pdf' : fmt === 'epub' ? 'epub' : 'md'
    const filterName = fmt === 'word' ? 'Word' : fmt === 'pdf' ? 'PDF' : fmt === 'epub' ? 'ePub' : 'Markdown'
    const savePath = await saveFile(`${sanitizeFilename(projectName)}.${ext}`, [{ name: filterName, extensions: [ext] }])
    if (!savePath) return { ok: false }
    // 6) 生成/写盘：markdown 走本地拼装；word/pdf/epub 走主进程
    const addFrontMatter = options.options?.addFrontMatter ?? true
    const addToc = options.options?.addToc ?? true
    let ok = false
    try {
      if (fmt === 'markdown') {
        const md = assembleMarkdown({
          projectName, chapters: selected, addFrontMatter, addToc,
          date: new Date().toISOString().slice(0, 10)
        })
        ok = await writeFile(savePath, md)
      } else {
        ok = await exportDocument(fmt as 'word' | 'pdf' | 'epub', {
          chapters: selected, projectName, options: { addFrontMatter, addToc }, savePath
        })
      }
    } catch (e) {
      console.error('导出失败:', e)
      ok = false
    }
    if (ok) { message.success('导出成功'); return { ok: true } }
    message.error('导出失败')
    return { ok: false }
  }

  // 命令面板处理
  const handleCommand = useCallback((command: string) => {
    switch (command) {
      case 'file:save': handleSave(); break
      case 'chapter:new': createChapter(); break
      case 'view:focusMode': setFocusMode(prev => !prev); break
      case 'view:typewriterMode': setTypewriterMode(prev => !prev); break
      default: break
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖 chapters/模式状态；命令内调用的 handler 非稳定引用，按现状即可
  }, [chapters, focusMode, typewriterMode])

  // 菜单栏事件
  useMenu((event, ...args) => {
    switch (event) {
      case 'newChapter': createChapter(); break
      case 'save': handleSave(); break
      case 'focusMode': setFocusMode(args[0] as boolean); break
      case 'typewriterMode': setTypewriterMode(args[0] as boolean); break
      case 'toggleOutline': setOutlineVisible((v) => !v); break
      case 'toggleChapterTree': setSidebarCollapsed((v) => !v); break
      // 菜单 → 侧栏对应 tab 并展开；'settings' 为「世界观设定」(Ctrl+2) → 侧栏设定 tab（非偏好页）
      case 'characters': case 'settings': case 'wordCount': case 'dailyStats':
        setSidebarTab(event === 'characters' ? 'characters' : event === 'settings' ? 'settings' : 'stats')
        setSidebarCollapsed(false)
        break
      // 'plot' (Ctrl+3) 无对应面板，暂不处理
      case 'export': setExportDialogOpen(true); break
      case 'shortcuts': setShortcutDialogOpen(true); break
      default: break
    }
  })

  // 键盘快捷键
  useKeyboard({
    onSave: handleSave, onNew: createChapter,
    onToggleFocusMode: () => setFocusMode(prev => !prev),
    onToggleTypewriterMode: () => setTypewriterMode(prev => !prev),
    onToggleCommandPalette: () => setCommandPaletteOpen(prev => !prev),
    onToggleSidebar: () => setSidebarCollapsed((v) => !v), onOutline: () => setOutlineVisible((v) => !v)
  })

  // 主区渲染单一出口（§7.6 布局接缝）：M1 恒返回编辑器+大纲视图，M3 在此切出图谱视图
  const renderMainView = () => (
    <>
      {/* Tab栏：专注模式隐藏 */}
      {!focusMode && (
        <EditorTabs
          chapters={openedChapters} activeChapterId={currentChapter?.id ?? null} currentChapter={currentChapter}
          onSelectChapter={openChapter} onCloseChapter={closeChapter}
        />
      )}
      {/* Header：专注模式降为仅标题+保存的轻量条 */}
      <Header style={{ padding: 0, background: 'var(--color-bg-base)', height: 'auto', lineHeight: 'normal' }}>
        {focusMode ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-2) var(--space-4)' }}>
            <Text style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-sm)' }}>{chapterTitle}</Text>
            <Button type="text" icon={<SaveOutlined />} onClick={handleSave}>保存</Button>
          </div>
        ) : (
          <EditorToolbar
            onSave={handleSave} onExport={() => setExportDialogOpen(true)} chapterTitle={chapterTitle} onTitleChange={setChapterTitle}
            wordCount={countWords(editorContent)} focusMode={focusMode} typewriterMode={typewriterMode}
            onToggleFocus={setFocusMode} onToggleTypewriter={setTypewriterMode}
          />
        )}
      </Header>
      {/* 编辑器 + 大纲 */}
      <Layout>
        <Content style={{ background: 'var(--color-paper)', padding: focusMode ? '0 var(--space-6)' : 'var(--space-3) var(--space-4)', flex: 1 }}>
          {currentChapter ? (
            <MonacoEditor
              ref={editorRef} value={editorContent}
              onChange={handleEditorChange} onSave={handleSave}
              focusMode={focusMode} typewriterMode={typewriterMode}
              fontSize={fontSize} wordWrap={wordWrap} showLineNumbers={showLineNumbers}
            />
          ) : (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)' }}>
              <BookOutlined style={{ fontSize: 48, marginBottom: 16 }} />
              <Text style={{ color: 'var(--color-text-secondary)' }}>{chapters.length === 0 ? '暂无章节，点击新建章节开始创作' : '选择一个章节开始编辑'}</Text>
              {chapters.length === 0 && (
                <Button type="primary" icon={<PlusOutlined />} onClick={createChapter} style={{ marginTop: 16 }}>新建章节</Button>
              )}
            </div>
          )}
        </Content>
        {outlineVisible && currentChapter && !focusMode && (
          <Sider width={260} style={{ background: 'var(--color-bg-elevated)', borderLeft: '1px solid var(--color-border)', overflow: 'auto' }}>
            <OutlineView content={editorContent} onNavigateToLine={(ln) => editorRef.current?.revealLineInCenter(ln)} />
          </Sider>
        )}
      </Layout>
    </>
  )
  const mainView = renderMainView()

  return (
    <Layout style={{ height: '100vh' }}>
      {/* 命令面板 */}
      <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} onExecute={handleCommand} />
      <ExportDialog open={exportDialogOpen} onClose={() => setExportDialogOpen(false)} chapters={chapters} projectName={projectName} onExport={handleExport} />
      {/* 左侧边栏 */}
      <SidebarPanel
        projectPath={projectPath || ''} projectName={projectName}
        tab={sidebarTab} collapsed={sidebarCollapsed} focusMode={focusMode}
        chapters={chapters} selectedChapterId={currentChapter?.id ?? null}
        statsView={stats} dailyGoal={config?.dailyGoal ?? 2000}
        onOpenChapter={openChapter} onChaptersChanged={loadChapters}
        onBack={handleBack} onOpenSettings={() => navigate('/settings')}
        onSetTab={setSidebarTab} onToggleCollapse={() => setSidebarCollapsed(v => !v)}
      />
      {/* 主内容区：单一出口 */}
      <Layout>
        {mainView}
      </Layout>
    </Layout>
  )
}

export default Workspace
