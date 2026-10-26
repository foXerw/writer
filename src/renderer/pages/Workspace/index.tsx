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
import { useBookEvents } from '../../hooks/useBookEvents'
import { useChapter, useDialog, useExport, useFile } from '../../hooks/useIPC'
import { assembleMarkdown, sanitizeFilename } from '../../services/exportService'
import { useEditorStore, useShortcutStore } from '../../stores'
import { useEditorSession } from './hooks/useEditorSession'
import { useWritingStats } from './hooks/useWritingStats'
import { useAutoSave } from './hooks/useAutoSave'
import { bookChangeTouchesCurrentChapter, decideConflict } from './hooks/bookChangeConflict'
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
  const { message, modal } = App.useApp()

  const { fontSize, wordWrap, showLineNumbers } = useEditorStore()
  const setShortcutDialogOpen = useShortcutStore((s) => s.setDialogOpen)
  const editorRef = useRef<MonacoEditorHandle>(null)

  const { getAllChapters, getChapterById } = useChapter()
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
    loadChapters, openChapter, closeChapter, createChapter, mergeUpdatedChapters, save, flushIfDirty, handleEditorChange,
    isDirtyNow, setFlushPaused, discardEdits, lastSavedContent } = session

  // 写作统计：countWords 增量（切章重置基线）/ 60s 活跃分钟 / 3s 防抖落盘
  const stats = useWritingStats({ projectPath, chapters, editorContent, currentChapterId: currentChapter?.id ?? null })
  const { persistNow } = stats

  // 自动保存：按项目配置间隔静默 flush（取代原 services/autoSave.ts）
  useAutoSave({ enabled: autoSaveEnabled, intervalMs: autoSaveInterval, chapterId: currentChapter?.id ?? null, flush: flushIfDirty })

  // -------------------------------------------------------------------------
  // Task 9 外部变更订阅（裁定 5）：book:changed → 静默刷新会话；当前脏章被外部改 → 冲突弹窗
  // -------------------------------------------------------------------------
  // book:changed 回调需读最新 currentChapter——镜像 ref（惯用法同下方 saveRef）
  const currentChapterRef = useRef(currentChapter)
  currentChapterRef.current = currentChapter
  // 冲突弹窗单例门：弹窗期间到达的后续事件不再叠开（走静默刷新分支）
  const conflictOpenRef = useRef(false)

  // 冲突弹窗状态机（裁定 5）：
  // 打开 = conflictOpenRef 置位 + setFlushPaused(当前章) → 该章的一切静默 flush（自动保存 tick /
  //   selectChapter 离章 flush / 关窗兜底）在 session.saveCurrentChapter 单点短路，其他章不受影响；
  // 决议（保留我的 / 重新加载 / X 关闭）→ 总是先 setFlushPaused(null) 恢复，再执行决议动作。
  const openConflictModal = (chapter: Chapter) => {
    conflictOpenRef.current = true
    setFlushPaused(chapter.id)
    let resolved = false
    const finish = () => {
      resolved = true
      conflictOpenRef.current = false
      setFlushPaused(null) // 决议 → 永远解除暂停（裁定 5：无论走哪条决议，含 X 关闭）
      instance.destroy()
    }
    // 「保留我的」= 本地缓冲强制覆盖磁盘：暂停门解除后走 save({silent:true})——chapter:update
    // 仓库写 → 缓存就地同步（不会陈旧）；save 成功清 dirty，后续回声落干净路径静默刷新。
    const keepMine = () => {
      if (resolved) return
      finish()
      void save({ silent: true })
    }
    // 「重新加载」= 弃本地编辑：清 dirty → loadChapters 的非脏路径用磁盘内容回灌
    // editorContent/chapterTitle（复用 Task 5 的会话保留语义，不另造回灌路径）。
    const reload = () => {
      if (resolved) return
      finish()
      discardEdits()
      void loadChapters()
    }
    const instance = modal.warning({
      title: '文件被外部修改',
      content: `「${chapter.title}」在磁盘上被其他程序修改，而你本地有未保存的编辑。请选择冲突解决方式。`,
      closable: true,     // 显示 X：X 关闭按默认「保留我的」处理（见 onCancel 注释）
      maskClosable: false,
      keyboard: false,    // Esc 不触发误决议——隐式关闭只剩 X 一条路，同样归入「保留我的」默认
      // 恰好两个按钮（裁定 5）。自定义 footer 而非默认 ok/cancel：默认 onCancel 无法区分
      // 「点了重新加载」与「X 关闭」，两者决议必须不同（前者弃本地、后者保留本地）。
      footer: () => (
        <>
          <Button onClick={reload}>重新加载</Button>
          <Button type="primary" onClick={keepMine}>保留我的</Button>
        </>
      ),
      // X 关闭（及其他任何「未显式选择」的关闭路径）= 按默认「保留我的」处理（裁定 5）——
      // 绝不静默丢弃用户编辑：保留只是重写一次盘，丢弃却不可逆。
      onCancel: keepMine
    })
  }

  // 修订 ①（控制器改判）：冲突必须「内容比对」判定，不能「事件触发」判定——本应用自己的写盘
  // 会经 watcher 回声成 book:changed，连续打字期间按事件+dirty 开弹窗 = 每个自动保存周期误报一次。
  // 判定：bypass 缓存点读磁盘真相 vs lastSaved（会话最近一次成功保存/重载的内容，useEditorSession 维护）：
  // 相等 → 自写回声静默忽略（不弹窗、不刷新抖动）；不等（含章被外删/点读失败 → null）→ 真外部改动 → 弹窗。
  const resolveBookChange = async (paths: string[]): Promise<void> => {
    if (!projectPath) return
    const cur = currentChapterRef.current
    if (
      cur !== null &&
      bookChangeTouchesCurrentChapter(paths, cur.id) &&
      isDirtyNow() &&
      !conflictOpenRef.current
    ) {
      let diskContent: string | null = null
      try {
        // 冲突判定专用输入：bypassCache 直读此刻磁盘真相（不吃缓存权威）
        const disk = await getChapterById(projectPath, cur.id, { bypassCache: true })
        diskContent = disk?.content ?? null
      } catch (err) {
        // 点读失败（坏档/IPC 异常）→ diskContent=null ≠ lastSaved → 弹窗多问一次，绝不静默丢编辑
        console.error('冲突判定读取磁盘失败，按真实外部改动处理:', err)
      }
      // 异步窗口守卫：await 期间切章/弹窗已被别的事件打开/已不脏 → 放弃本次判定，落静默刷新
      if (conflictOpenRef.current || currentChapterRef.current?.id !== cur.id || !isDirtyNow()) {
        void loadChapters()
        return
      }
      if (decideConflict(diskContent, lastSavedContent()) === 'ignore-echo') {
        // 自写回声：本批只有当前章文件 → 完全静默（零刷新抖动）；
        // 批次混有其他路径（如外部同时改了别的章）→ 其余变更仍走静默刷新
        if (paths.some((x) => x !== `chapters/${cur.id}.md`)) void loadChapters()
        return
      }
      openConflictModal(cur)
      return
    }
    // 非脏 / 其他章 / 其他域变更 → 静默刷新（Task 5 loadChapters：tab 布局与当前章保留，
    // 脏编辑器不回灌）。干净章的自写回声也落这里（裁定 5 接受）：重拉相同值 = 无害 no-op。
    void loadChapters()
  }

  const handleBookChanged = (paths: string[]) => {
    void resolveBookChange(paths)
  }
  useBookEvents({ onBookChanged: handleBookChanged })

  // save/createChapter 每次渲染刷新镜像 ref（同 useEditorSession 的 flushIfDirtyStable 惯用法）：
  // 供被 memo 的事件回调（命令面板）调用最新闭包，防止陈旧 editorContent/chapters 造成丢保存或旧编号建章。
  const saveRef = useRef(save)
  saveRef.current = save
  const createChapterRef = useRef(createChapter)
  createChapterRef.current = createChapter

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

  // 命令面板处理：memo 引用保持恒定，所有易变逻辑经 ref 读最新闭包。
  // （曾用 [chapters, focusMode, typewriterMode] 作依赖 → 捕获旧渲染的 save 闭包，
  //   面板保存会写陈旧 editorContent 并清 dirty，关窗 flush 被跳过导致丢字。）
  const handleCommand = useCallback((command: string) => {
    switch (command) {
      case 'file:save': void saveRef.current({ silent: false }); break
      case 'chapter:new': void createChapterRef.current(); break
      case 'view:focusMode': setFocusMode(prev => !prev); break
      case 'view:typewriterMode': setTypewriterMode(prev => !prev); break
      default: break
    }
  }, [])

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
        onOpenChapter={openChapter} onChaptersChanged={loadChapters} onChaptersResync={mergeUpdatedChapters}
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
