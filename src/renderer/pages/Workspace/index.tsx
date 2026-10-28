import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Badge, Layout, Button, Typography, App, Segmented } from 'antd'
import { PlusOutlined, BookOutlined, SaveOutlined } from '@ant-design/icons'
import MonacoEditor, { type MonacoEditorHandle } from '../../components/Editor/MonacoEditor'
import EditorToolbar from '../../components/Editor/EditorToolbar'
import EditorTabs from '../../components/Layout/EditorTabs'
import OutlineView from '../../components/Editor/OutlineView'
import SidebarPanel, { type SidebarTab } from '../../components/Workspace/SidebarPanel'
import GraphView from '../../components/Graph/GraphView'
import type { GraphKind } from '../../components/Graph/graphModel'
import CommandPalette from '../../components/Dialogs/CommandPalette'
import ExportDialog, { type ExportOptions } from '../../components/Dialogs/ExportDialog'
import ProposalReviewDialog from '../../components/Dialogs/ProposalReviewDialog'
import { useMenu } from '../../hooks/useMenu'
import { useKeyboard } from '../../hooks/useKeyboard'
import { useBookEvents } from '../../hooks/useBookEvents'
import { useChapter, useDialog, useExport, useFile, useProject } from '../../hooks/useIPC'
import { assembleMarkdown, sanitizeFilename } from '../../services/exportService'
import { reportMigration } from '../../services/migrationReport'
import { describeBookError } from '../../services/bookErrors'
import { useEditorStore, useShortcutStore } from '../../stores'
import { useEditorSession } from './hooks/useEditorSession'
import { useWritingStats } from './hooks/useWritingStats'
import { useAutoSave } from './hooks/useAutoSave'
import { useOrganize } from './hooks/useOrganize'
import { bookChangeTouchesCurrentChapter, decideConflict } from './hooks/bookChangeConflict'
import type { Chapter, ProjectConfig, ProjectData } from '@/common/ipc'
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

  const { getAllChapters, getChapterById, rebuildChapter } = useChapter()
  const { exportDocument } = useExport()
  const { saveFile } = useDialog()
  const { writeFile } = useFile()
  const { openProject } = useProject()

  // -------------------------------------------------------------------------
  // A-seam（Task 10 收口）：两条 open 路径、同一个入口。
  // Home「最近列表点击」（handleOpenProject → navigate 只带 projectPath）不经 project:open——
  // 而 project:open 是 migrateBook + startWatching + config 加载的唯一调用点（project.ts）。
  // 路径直达挂载必须先补开一次再做任何读盘：open 幂等（v2 直读 / 崩溃态 R1 续传 / startWatching
  // 内部先停前一个监听），否则 v1 书显示为「空」（listChapters 跳过无 front-matter 文件——文件在
  // 盘上但全部隐身）、Task 9 watcher 永不启动、dailyGoal/autoSave 配置全丢。
  // 对话框路径（state.project 已在、config 随附）已由弹窗 open/create 完成 → 本效果是 no-op，
  // 行为零改动（统一双入口的代价 = 弹窗流程重复 open，被裁定否决；以 state.project 为分流判据）。
  // -------------------------------------------------------------------------
  const pathOnlyMount = !state?.project && !!state?.projectPath
  const [opened, setOpened] = useState<ProjectData | null>(null)
  const openingRef = useRef(false)
  useEffect(() => {
    if (!pathOnlyMount || openingRef.current) return
    openingRef.current = true
    openProject(state?.projectPath as string)
      .then((p) => {
        setOpened(p)
        reportMigration(p, { message, modal })
      })
      .catch((err) => {
        console.error('最近项目补开失败:', err)
        // 补开失败 = 书目录不可打开（CORRUPT_BOOK/INVALID_PROJECT 等）：给出可读文案并退回首页，
        // 绝不停留在「正在打开…」假死态（stale recent 记录指向已删/已损坏目录是真实场景）
        const { title, content } = describeBookError(err instanceof Error ? err.message : String(err))
        message.error(`${title}：${content}`, 8)
        navigate('/', { replace: true })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 每次挂载至多补开一次（StrictMode 双执行由 openingRef 合并；project:open 幂等，重复调用只是冗余而非损坏）
  }, [])

  // 路由参数与项目配置
  const rawProjectPath = state?.project?.path || state?.projectPath
  // 路径直达挂载：project:open 完成前禁止任何读盘（迁移/自检/watcher 接线都是列表加载的前置）
  const projectPath = pathOnlyMount && opened === null ? undefined : rawProjectPath
  const projectName = state?.project?.name || opened?.name || '未命名项目'
  const config = state?.config ?? opened?.config
  const autoSaveEnabled = config?.autoSave ?? true
  const autoSaveInterval = config?.autoSaveInterval ?? 30000

  // 侧边栏状态（菜单事件需要驱动，故保留在 Workspace）
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('chapters')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  // 模式状态
  const [focusMode, setFocusMode] = useState(false)
  const [typewriterMode, setTypewriterMode] = useState(false)
  // M3 主区视图（Task 3）：写作 | 图谱 一级切换 + 图谱内二级切换（M4c-2 Task 4 扩为五档：
  // 人物关系 | 世界观 | 剧情走向 | 关键选项 | 角色成长）
  const [viewMode, setViewMode] = useState<'write' | 'graph'>('write')
  const [graphKind, setGraphKind] = useState<GraphKind>('character')
  // 命令面板 / 大纲 / 导出对话框
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [outlineVisible, setOutlineVisible] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  // M4b T5 差异确认面板：徽章点击进入（打开时面板自拉新鲜 proposal:getAll）
  const [proposalReviewOpen, setProposalReviewOpen] = useState(false)

  // 章节会话：save/flush 并发语义（dirty 门控 / LIVE id 镜像 / 函数式回写）全部在 hook 内
  const session = useEditorSession(projectPath)
  const { chapters, openedChapters, currentChapter, editorContent, chapterTitle, setChapterTitle,
    loadChapters, openChapter, closeChapter, createChapter, mergeUpdatedChapters, save, flushIfDirty, handleEditorChange,
    isDirtyNow, setFlushPaused, discardEdits, lastSavedContent, markSavedContent } = session

  // 写作统计：countWords 增量（切章重置基线）/ 60s 活跃分钟 / 3s 防抖落盘
  const stats = useWritingStats({ projectPath, chapters, editorContent, currentChapterId: currentChapter?.id ?? null })
  const { persistNow } = stats

  // 自动保存：按项目配置间隔静默 flush（取代原 services/autoSave.ts）
  useAutoSave({ enabled: autoSaveEnabled, intervalMs: autoSaveInterval, chapterId: currentChapter?.id ?? null, flush: flushIfDirty })

  // 整理本章（M4b Task 4）：buffer 优先（用户所见即所整理——quote 逐字铁律要求出处
  // 对齐编辑器缓冲），非当前章/无缓冲回落磁盘内容。并发门与徽章刷新全在 hook 内。
  const organize = useOrganize({
    projectPath,
    projectName,
    config,
    getBufferChapter: (chapterId) =>
      currentChapter && currentChapter.id === chapterId
        ? { title: chapterTitle, body: isDirtyNow() ? editorContent : currentChapter.content }
        : null
  })
  const organizeDisabled =
    !projectPath || !currentChapter || organize.pendingChapterIds.has(currentChapter.id)

  // save/createChapter 每次渲染刷新镜像 ref（同 useEditorSession 的 flushIfDirtyStable 惯用法）：
  // 供被 memo 的事件回调（命令面板）与异步决议回调（Task 9 冲突弹窗）调用最新闭包，
  // 防止陈旧 editorContent/chapters 造成丢保存或旧编号建章。
  const saveRef = useRef(save)
  saveRef.current = save
  const createChapterRef = useRef(createChapter)
  createChapterRef.current = createChapter
  // Task 9 修订轮2（I3）：冲突弹窗决议在「点击时」读缓冲——弹窗开着期间编辑器仍可键入
  // （mask 只挡指针，不保证挡键盘），决议回调若吃事件渲染的陈旧闭包会把新键入静默回滚。
  const editorContentRef = useRef(editorContent)
  editorContentRef.current = editorContent
  const chapterTitleRef = useRef(chapterTitle)
  chapterTitleRef.current = chapterTitle

  // -------------------------------------------------------------------------
  // Task 9 外部变更订阅（裁定 5）：book:changed → 静默刷新会话；当前脏章被外部改 → 冲突弹窗
  // -------------------------------------------------------------------------
  // book:changed 回调需读最新 currentChapter——镜像 ref（惯用法同上 saveRef）
  const currentChapterRef = useRef(currentChapter)
  currentChapterRef.current = currentChapter
  // 冲突弹窗单例门：弹窗期间到达的后续事件不再叠开（走静默刷新分支）
  const conflictOpenRef = useRef(false)

  // 冲突弹窗状态机（裁定 5 + 修订轮2）：
  // 打开 = conflictOpenRef 置位 + setFlushPaused(当前章) → 该章的一切静默 flush（自动保存 tick /
  //   selectChapter 离章 flush / 关窗兜底）在 session.saveCurrentChapter 单点短路，其他章不受影响；
  // 决议（保留我的 / 重新加载 / X 关闭）→ 总是先 setFlushPaused(null) 恢复，再执行决议动作。
  // diskMissing = 判定时磁盘点读为 null（章被外删/坏档/点读失败）——「保留我的」此时走 rebuild 救援。
  const openConflictModal = (chapter: Chapter, diskMissing: boolean) => {
    conflictOpenRef.current = true
    setFlushPaused(chapter.id)
    let resolved = false
    const finish = () => {
      resolved = true
      conflictOpenRef.current = false
      setFlushPaused(null) // 决议 → 永远解除暂停（裁定 5：无论走哪条决议，含 X 关闭）
      instance.destroy()
    }
    // 「保留我的」= 本地缓冲强制落盘，两条路径（修订轮2 I2/I3）：
    // - 磁盘章仍在 → saveRef.current({silent:true})：走 chapter:update 仓库写（RMW）→ 缓存就地同步。
    //   I3：saveRef 每渲染刷新——决议在「点击时」取最新闭包（最新 editorContent/chapterTitle），
    //   弹窗开着期间继续键入的内容绝不丢失（旧实现吃事件渲染的陈旧 save 闭包 = 静默回滚新键入）；
    // - 磁盘章已被外删/损坏（diskMissing）→ chapter:rebuild 整体重建（applyPatch 的 RMW 对这类目标
    //   必抛 CHAPTER_MISSING/FRONTMATTER_*，常规保存无法落盘）；缓冲经 ref 镜像在点击时读取。
    const keepMine = () => {
      if (resolved) return
      finish()
      if (!diskMissing) {
        void saveRef.current({ silent: true })
        return
      }
      if (!projectPath) return
      const title = chapterTitleRef.current
      const content = editorContentRef.current
      rebuildChapter(projectPath, chapter.id, title, content)
        .then((rebuilt) => {
          mergeUpdatedChapters([rebuilt]) // 重建后的新鲜章并入会话（meta 已重置默认）
          // Task 10（G-M2，T9 遗留整改）：清 dirty / 刷基准都必须镜像 saveCurrentChapter 的
          // 「仍是同一章」守卫——IPC 往返期间用户切章并打字时，无条件 discardEdits() 会抹掉
          // 【新章】的脏标记（丢保存隐患）；markSavedContent 同理绝不能把基准写成旧章内容。
          // 切走了就都不动：本次落盘的是旧章自己的缓冲，与新章的未保存编辑无关。
          //（静态走查钉死，无 jsdom——同 Task 9 惯例；见 task-10-report 走查表）
          if (currentChapterRef.current?.id === chapter.id) {
            discardEdits() // 缓冲已整体落盘 → 清 dirty（语义同常规 save 成功）
            markSavedContent(rebuilt.content) // G-M3：基准刷新为刚落盘内容，关闭陈旧基准空窗
          }
          message.success('已在磁盘重建该文件并保存本地内容（卷归属/状态已重置为默认）')
        })
        .catch((err) => {
          console.error('冲突重建失败:', err)
          message.error('重建失败——本地内容仍在编辑器中，未丢失')
        })
    }
    // 「重新加载」= 弃本地编辑：清 dirty → loadChapters 的非脏路径用磁盘内容回灌
    // editorContent/chapterTitle（复用 Task 5 的会话保留语义，不另造回灌路径）。
    // 章已被外删时 loadChapters 走 Task 5 的「当前章被删」分支（顺位下一 tab 或清空会话）。
    const reload = () => {
      if (resolved) return
      finish()
      discardEdits()
      void loadChapters()
    }
    const instance = modal.warning({
      title: '文件被外部修改',
      // 文案如实覆盖两种「保留我的」语义（I2）：常规覆盖写 vs 磁盘档已不可读时的整体重建
      content: diskMissing
        ? `「${chapter.title}」在磁盘上已被其他程序删除或损坏，而你本地有未保存的编辑。「保留我的」将以本地内容在磁盘重建该文件（卷归属/状态重置为默认，正文与标题完整保留）；「重新加载」将放弃本地编辑。`
        : `「${chapter.title}」在磁盘上被其他程序修改，而你本地有未保存的编辑。「保留我的」将以本地内容覆盖磁盘版本；「重新加载」将放弃本地编辑、采用磁盘版本。`,
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

  // 修订 ①（控制器改判）：冲突必须「内容比对」判定，不能「事件触发」判定——裁定时本应用
  // 自己的写盘会经 watcher 回声成 book:changed，连续打字期间按事件+dirty 开弹窗 = 每个自动
  // 保存周期误报一次。（修订轮2 I1 起自写已在广播前按 ~1s 窗口源头剔除，常规自保存不再触发
  // 本事件；但越窗迟出的自写事件与真并发外部编辑仍会到达，内容比对判定不可回退成事件判定。）
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
      openConflictModal(cur, diskContent === null) // diskMissing → 「保留我的」走 rebuild 救援（I2）
      return
    }
    // 非脏 / 其他章 / 其他域变更 → 静默刷新（Task 5 loadChapters：tab 布局与当前章保留，
    // 脏编辑器不回灌）。干净章的自写回声（若有，也只可能是 I1 窗口外迟出漏进者）落这里：
    // 重拉相同值 = 无害 no-op。
    void loadChapters()
  }

  const handleBookChanged = (paths: string[]) => {
    void resolveBookChange(paths)
  }
  useBookEvents({ onBookChanged: handleBookChanged })

  // 关窗/退出兜底：fire-and-forget flush + 统计落盘（稳定引用，内部读最新镜像）；主要保障仍是切章/返回的显式 flush
  useEffect(() => {
    const handler = () => { flushIfDirty(); persistNow() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [flushIfDirty, persistNow])

  // 返回首页：先 fire-and-forget flush + 统计落盘，再路由
  const handleBack = () => { flushIfDirty(); persistNow(); navigate('/') }

  // 迁移补开（A-seam）尚未完成时给出可读的加载态，而非「暂无章节」的空书假象
  const awaitingOpen = pathOnlyMount && opened === null

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
      // 'plot' (Ctrl+3) → 叙事面板（Task 5：剧情线/关键选项/伏笔录入宿主）
      case 'plot':
        setSidebarTab('narrative')
        setSidebarCollapsed(false)
        break
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

  // 图谱节点点击回退通道（M4c-2 Task 4 起仅「无章节引用」的节点走这里——有引用的节点
  // 在 GraphView 内弹跳章菜单）：侧栏切到对应面板并展开。entityId 刻意暂未消费：面板内
  // 选中/滚动到该实体卡需给面板增受控选中管线（M3 定为 stretch，不新建子系统）。
  // arc stage 节点 entityId 回指角色 → 与 character 同落「角色」面板；plotline/choice
  // 节点落 Task 5「叙事」面板——只切 tab：停在对应段需给面板加受控选段/选中管线
  //（与 entityId 同条 stretch 裁定，不新建子系统）。
  const handleGraphNodeClick = (_entityId: string, kind: GraphKind) => {
    const tab: SidebarTab | null =
      kind === 'character' || kind === 'arc'
        ? 'characters'
        : kind === 'world'
          ? 'settings'
          : kind === 'plotline' || kind === 'choice'
            ? 'narrative'
            : null
    if (tab === null) return
    setSidebarTab(tab)
    setSidebarCollapsed(false)
  }

  // 图谱跳章菜单确认（M4c-2 Task 4）：定位章对象 → 打开 → 切回写作视图（用户落在该章编辑器）。
  // chapters 是会话态（GraphView 的菜单项恒由同一列表生成）；脱靶仅发生在菜单渲染后该章
  // 被删除的竞态窗口——给出可读提示而非静默无响应。
  const handleJumpToChapter = (chapterId: string) => {
    const target = chapters.find((c) => c.id === chapterId)
    if (!target) {
      message.warning('该章节已不存在，可能刚被删除')
      return
    }
    openChapter(target)
    setViewMode('write')
  }

  // 主区渲染单一出口（§7.6 布局接缝）：M1 恒返回编辑器+大纲视图，M3 在此切出图谱视图。
  // 专注模式是写作专属态：focusMode 开启时降级为写作视图（菜单/快捷键/命令面板从图谱态进入专注
  // 同样生效，退专注自动回图谱），切换条同步隐藏——编辑器 fragment 由此保持一字未动（零回归约束）。
  const effectiveViewMode = focusMode ? 'write' : viewMode
  const renderMainView = () => {
    if (effectiveViewMode === 'graph') {
      // 宿主容器契约（Task 2 坑 a；编辑器 e000148 同款教训）：GraphView 根为 absolute;inset:0，
      // 父级必须 position:relative 且已有确定尺寸——本容器 flex:1 + minHeight:0 在列向 Layout 中
      // 吃满剩余高度；若父级是 auto 高度块，inset:0 会塌成 0×0（白屏，但 typecheck/build 全绿）。
      return (
        <div style={{ position: 'relative', flex: 1, minHeight: 0, width: '100%' }}>
          <GraphView
            projectPath={projectPath ?? ''}
            kind={graphKind}
            chapters={chapters}
            onNodeClick={handleGraphNodeClick}
            onJumpToChapter={handleJumpToChapter}
          />
        </div>
      )
    }
    return (
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
            onOrganize={() => { if (currentChapter) void organize.organize(currentChapter.id) }}
            organizing={organize.organizing} organizeDisabled={organizeDisabled}
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
          ) : awaitingOpen ? (
            // A-seam：路径直达挂载正在补开（迁移/自检/watcher 接线尚未返回）——
            // 显示加载态而非「暂无章节」，避免 v1 书在迁移期间被误报成空书（数据其实都在盘上）
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)' }}>
              <Text style={{ color: 'var(--color-text-secondary)' }}>正在打开书籍…</Text>
            </div>
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
  }
  const mainView = renderMainView()

  return (
    <Layout style={{ height: '100vh' }}>
      {/* 命令面板 */}
      <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} onExecute={handleCommand} />
      <ExportDialog open={exportDialogOpen} onClose={() => setExportDialogOpen(false)} chapters={chapters} projectName={projectName} onExport={handleExport} />
      <ProposalReviewDialog
        open={proposalReviewOpen}
        onClose={() => setProposalReviewOpen(false)}
        projectPath={projectPath}
        chapters={chapters}
      />
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
      {/* 主内容区：单一出口。视图切换条常驻主区顶部（focusMode 除外——专注是写作专属态），
          保证 写作↔图谱 双向都可达；图谱态下再出五档二级切换（M4c-2 Task 4） */}
      <Layout>
        {!focusMode && (
          <div
            style={{
              flex: '0 0 auto',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              padding: 'var(--space-2) var(--space-4)',
              background: 'var(--color-bg-base)',
              borderBottom: '1px solid var(--color-border)'
            }}
          >
            <Segmented
              value={viewMode}
              onChange={(v) => setViewMode(v as 'write' | 'graph')}
              options={[
                { label: '写作', value: 'write' },
                {
                  // 提案徽章（M4b Task 4）：未消化提案数挂在图谱入口上——T5 审阅面板
                  // （提案处理的宿主视图）在图谱侧，count=0 时 Badge 自动隐身。
                  // T5 接线：点击徽章数字打开审阅面板。注意 antd Segmented 条目是
                  // <label><input type=radio>——点击任意后代的【默认行为】就会激活 radio
                  // 切换视图，stopPropagation 只停冒泡、拦不住默认动作（评审 I1 实测坐实）。
                  // 因此必须 preventDefault 取消激活 + stopPropagation 双管齐下：点数字=只开面板、
                  // 视图留在写作；点「图谱」文字仍是纯切换；count=0 时数字不存在，点击自然回落切换。
                  label: (
                    <span
                      className="proposal-review-entry"
                      onClick={(e) => {
                        if (
                          organize.pendingCount > 0 &&
                          (e.target as HTMLElement).closest('.ant-badge-count')
                        ) {
                          e.preventDefault()
                          e.stopPropagation()
                          setProposalReviewOpen(true)
                        }
                      }}
                    >
                      <Badge count={organize.pendingCount} size="small" offset={[4, -4]}>
                        <span style={{ padding: '0 6px' }}>图谱</span>
                      </Badge>
                    </span>
                  ),
                  value: 'graph'
                }
              ]}
            />
            {viewMode === 'graph' && (
              <Segmented
                value={graphKind}
                onChange={(v) => setGraphKind(v as GraphKind)}
                options={[
                  { label: '人物关系', value: 'character' },
                  { label: '世界观', value: 'world' },
                  { label: '剧情走向', value: 'plotline' },
                  { label: '关键选项', value: 'choice' },
                  { label: '角色成长', value: 'arc' }
                ]}
              />
            )}
          </div>
        )}
        {mainView}
      </Layout>
    </Layout>
  )
}

export default Workspace
