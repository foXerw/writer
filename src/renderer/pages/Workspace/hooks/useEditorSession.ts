import { useState, useEffect, useRef, useCallback } from 'react'
import { App } from 'antd'
import { useChapter } from '../../../hooks/useIPC'
import { planChapterRefresh } from './chapterRefresh'
import type { Chapter } from '@/common/ipc'

export interface EditorSession {
  chapters: Chapter[]
  openedChapters: Chapter[]
  currentChapter: Chapter | null
  editorContent: string
  chapterTitle: string
  setChapterTitle: (t: string) => void
  loadChapters: () => Promise<void>
  openChapter: (c: Chapter) => void
  closeChapter: (id: string) => void
  createChapter: () => Promise<void>
  // Task 5 评审整改第 2 条：外部变更（移卷）成功后把回传的新鲜章同步进会话
  mergeUpdatedChapters: (updates: Chapter[]) => void
  save: (opts?: { silent?: boolean }) => Promise<void>
  flushIfDirty: () => void
  handleEditorChange: (value: string) => void
  // Task 9 外部改动冲突（裁定 5）的三件接缝——冲突弹窗的开合/决议全部经由它们，不在 JSX 里塞标志位：
  /** 当前章此刻是否有未保存编辑（book:changed 到达时判定「冲突 vs 静默刷新」）。 */
  isDirtyNow: () => boolean
  /** 冲突弹窗期间暂停指定章的静默 flush（chapterId=null 恢复）；其他章不受影响。 */
  setFlushPaused: (chapterId: string | null) => void
  /** 「重新加载」决议：只清 dirty 标志——内容回灌由随后的 loadChapters 非脏路径完成（复用 Task 5 语义）。 */
  discardEdits: () => void
}

// 章节编辑会话 —— Task 7 自原 Workspace/index.tsx 章节状态段逐行迁移，save/flush 并发语义不变：
// - isDirtyRef：脏标记；silent flush 仅在脏时写盘，手动保存不门控；
// - currentChapterIdRef：LIVE 镜像（渲染期 + selectChapter/closeChapter 同步更新），
//   异步保存 resolve 时仅当仍指向同一章才清 dirty，防「切章 + 编辑新章」被陈旧回写清掉新章脏标记；
// - flushIfDirtyRef：每次渲染刷新，供稳定回调（beforeunload / 自动保存定时器）调用最新闭包；
// - 保存后的状态回写全部使用函数式 updater，防止切走后被回写。
export function useEditorSession(projectPath: string | undefined): EditorSession {
  const { message } = App.useApp()
  const { getAllChapters, createChapter: createChapterIpc, updateChapter } = useChapter()

  // 章节状态
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [openedChapters, setOpenedChapters] = useState<Chapter[]>([])
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null)
  const [editorContent, setEditorContent] = useState('')
  const [chapterTitle, setChapterTitle] = useState('')

  const isDirtyRef = useRef(false)
  // Task 9 冲突弹窗暂停门：弹窗未决议期间，该章的一切静默 flush（自动保存 tick / selectChapter
  // 离章 flush / 关窗兜底）短路；其他章不受影响；决议（保留我的/重新加载/X 关闭）总是 setFlushPaused(null)。
  const flushPausedChapterIdRef = useRef<string | null>(null)
  // 镜像 LIVE current chapter id，每次渲染更新，确保异步 resolve 时读到最新值。
  const currentChapterIdRef = useRef<string | null>(currentChapter?.id ?? null)
  currentChapterIdRef.current = currentChapter?.id ?? null
  // 镜像打开列表：closeChapter 在单次事件的批量循环（关闭全部/其他/右侧）内逐步读写，
  // 避免从同一陈旧闭包列表计算导致只关掉最后一个。
  const openedChaptersRef = useRef(openedChapters)
  openedChaptersRef.current = openedChapters
  // 首载自动打开只发生一次（换项目重置）——用户主动关光 tab 后的刷新不再强行开章
  const autoOpenedRef = useRef(false)

  // projectPath 变化即加载（并重置首载标记：新项目允许首载自动打开第一章）
  useEffect(() => {
    autoOpenedRef.current = false
    if (projectPath) {
      void loadChapters()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在 projectPath 变化时加载
  }, [projectPath])

  // 加载章节列表（Task 5 评审整改第 3 条：刷新保留 tab 布局与当前章，
  // 不再「每次刷新都关掉所有 tab 跳到第 1 章」——卷操作使旧语义成为主流程炸弹）
  const loadChapters = async () => {
    if (!projectPath) return
    try {
      const data = await getAllChapters(projectPath)
      const plan = planChapterRefresh({
        opened: openedChaptersRef.current,
        currentId: currentChapterIdRef.current,
        fresh: data,
        hasAutoOpened: autoOpenedRef.current
      })
      setChapters(data)
      openedChaptersRef.current = plan.tabs
      setOpenedChapters(plan.tabs)
      if (plan.current) {
        // 当前章仍在：元数据以磁盘为准重同步（volumeId 等）；脏编辑器不回灌，
        // 本地编辑以 chapterTitle/editorContent 为准（保存路径不变）
        setCurrentChapter(plan.current)
        if (!isDirtyRef.current) {
          setEditorContent(plan.current.content)
          setChapterTitle(plan.current.title)
        }
      } else if (currentChapterIdRef.current) {
        // 当前章已被外部删除：有剩余 tab 则顺位（selectChapter 先 flush 离开的章——
        // chapter:update 已不回写归属，flush 不可能复活旧 volumeId）；否则清空会话
        if (plan.tabs.length > 0) {
          selectChapter(plan.tabs[0])
        } else {
          setCurrentChapter(null)
          currentChapterIdRef.current = null
          isDirtyRef.current = false // 章已删，未保存编辑无处可归，丢弃（不写回已删文件）
          setEditorContent('')
          setChapterTitle('')
        }
      } else if (plan.autoOpenFirst && data.length > 0) {
        autoOpenedRef.current = true
        openedChaptersRef.current = [data[0]]
        setOpenedChapters([data[0]])
        selectChapter(data[0])
      }
    } catch (error) {
      console.error('加载章节失败:', error)
    }
  }

  // 打开章节
  const openChapter = (chapter: Chapter) => {
    setOpenedChapters(prev => {
      if (prev.find(c => c.id === chapter.id)) {
        return prev
      }
      return [...prev, chapter]
    })
    selectChapter(chapter)
  }

  // 关闭章节（Task 6 评审整改：副作用移出 setState updater；关闭最后一个 tab 清空当前章）
  const closeChapter = (chapterId: string) => {
    // 先计算下一个打开列表（经镜像 ref，兼容同一事件内的批量关闭循环）
    const next = openedChaptersRef.current.filter(c => c.id !== chapterId)
    openedChaptersRef.current = next
    setOpenedChapters(next)
    // 非当前章：仅更新列表，不动选区
    if (currentChapterIdRef.current !== chapterId) return
    if (next.length > 0) {
      // 沿用现有 filtered[0] 兜底；selectChapter 内部会先 flush 即将离开的章
      selectChapter(next[0])
    } else {
      // 关闭最后一个 tab：先静默 flush（不丢未保存编辑），再清空当前章与编辑器
      flushIfDirty()
      setCurrentChapter(null)
      currentChapterIdRef.current = null
      setEditorContent('')
      setChapterTitle('')
    }
  }

  // 选择章节
  const selectChapter = (chapter: Chapter) => {
    flushIfDirty() // 先保存即将离开的当前章（若脏）
    setCurrentChapter(chapter)
    // 同步 LIVE 镜像：批量关闭循环中后续步骤据此读到待提交的新当前章
    currentChapterIdRef.current = chapter.id
    setEditorContent(chapter.content)
    setChapterTitle(chapter.title)
    // 注：原 prevLenRef（切章不计字数增量）随统计逻辑迁至 useWritingStats（按 currentChapterId 变化重置基线）
  }

  // 新建章节（Task 5：落在当前打开章所属卷；无当前章/未分卷 → 未分卷桶。
  // 简单裁定：volumeId 经 hook 参数直通，不在 hook 边界另设「当前卷」状态）
  const createChapter = async () => {
    if (!projectPath) return
    const title = `新章节 ${chapters.length + 1}`
    try {
      const newChapter = await createChapterIpc(projectPath, title, currentChapter?.volumeId ?? null)
      setChapters([...chapters, newChapter])
      openChapter(newChapter)
      message.success('章节创建成功')
    } catch (error) {
      message.error('章节创建失败')
    }
  }

  // Task 5 评审整改第 2 条（纵深防御）：外部变更（chapter:moveToVolume 回传/删卷疏散预置）
  // 成功后立刻把新鲜章并入会话——陈旧 volumeId 对象的存活窗口从「整个列表重拉 IPC 往返」
  // 缩到近零。只并列表/tab/当前章的元数据对象；编辑器缓冲（editorContent/chapterTitle）与
  // dirty 态一概不动——用户未保存编辑永远以本地为准（fix 1 已保证保存通道不回写归属）。
  const mergeUpdatedChapters = (updates: Chapter[]) => {
    if (updates.length === 0) return
    const byId = new Map(updates.map((u) => [u.id, u]))
    setChapters((prev) => prev.map((c) => byId.get(c.id) ?? c))
    setOpenedChapters((prev) => prev.map((c) => byId.get(c.id) ?? c))
    setCurrentChapter((prev) => (prev && byId.get(prev.id)) || prev)
  }

  // 保存当前章节到磁盘。silent=true 用于切章/返回/关窗/自动保存的静默 flush。
  const saveCurrentChapter = async (opts?: { silent?: boolean }): Promise<void> => {
    if (!currentChapter || !projectPath) return
    // 静默 flush：无脏数据则跳过；手动保存（silent=false）尊重显式 Ctrl+S，不门控 dirty。
    if (opts?.silent && !isDirtyRef.current) return
    const outgoing = currentChapter
    // Task 9 暂停门（裁定 5）：冲突弹窗未决议期间，该章的静默 flush 一律短路——自动保存 tick、
    // selectChapter 离章 flush、关窗兜底全走本函数，单点拦截即全覆盖；其他章不受影响。
    // 手动保存（silent=false）不进门：弹窗期间 Ctrl+S 等效「保留我的」（同一 repo 写，缓存照常同步）。
    if (opts?.silent && flushPausedChapterIdRef.current === outgoing.id) return
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

  // 静默 flush 脏数据：切章 / 返回 / 关窗 / 自动保存调用。
  const flushIfDirty = () => {
    void saveCurrentChapter({ silent: true })
  }

  const flushIfDirtyRef = useRef(flushIfDirty)
  useEffect(() => {
    flushIfDirtyRef.current = flushIfDirty
  })

  // 对外稳定引用：内部始终调用最新一次渲染的 flush 闭包（语义同原 flushIfDirtyRef 调用点）
  const flushIfDirtyStable = useCallback(() => {
    flushIfDirtyRef.current()
  }, [])

  // 编辑器内容变化包装：置 dirty
  //（原字数增量/活跃时间戳逻辑迁至 useWritingStats，由其观察 editorContent/currentChapterId）
  const handleEditorChange = (val: string) => {
    setEditorContent(val)
    isDirtyRef.current = true
  }

  // Task 9 冲突接缝（裁定 5）：三件都是稳定引用（读 ref，不随渲染变化），供 Workspace 的
  // book:changed 回调与冲突弹窗决议调用。
  const isDirtyNow = useCallback(() => isDirtyRef.current, [])

  const setFlushPaused = useCallback((chapterId: string | null) => {
    flushPausedChapterIdRef.current = chapterId
  }, [])

  // 「重新加载」决议的丢编辑步：只清 dirty——loadChapters 的 `!isDirtyRef` 分支随即用磁盘内容
  // 回灌 editorContent/chapterTitle（Task 5 保留语义原样复用，不另造回灌路径）
  const discardEdits = useCallback(() => {
    isDirtyRef.current = false
  }, [])

  return {
    chapters,
    openedChapters,
    currentChapter,
    editorContent,
    chapterTitle,
    setChapterTitle,
    loadChapters,
    openChapter,
    closeChapter,
    createChapter,
    mergeUpdatedChapters,
    save: saveCurrentChapter,
    flushIfDirty: flushIfDirtyStable,
    handleEditorChange,
    isDirtyNow,
    setFlushPaused,
    discardEdits
  }
}
