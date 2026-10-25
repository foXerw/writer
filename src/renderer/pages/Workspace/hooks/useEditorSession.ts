import { useState, useEffect, useRef, useCallback } from 'react'
import { App } from 'antd'
import { useChapter } from '../../../hooks/useIPC'
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
  save: (opts?: { silent?: boolean }) => Promise<void>
  flushIfDirty: () => void
  handleEditorChange: (value: string) => void
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
  // 镜像 LIVE current chapter id，每次渲染更新，确保异步 resolve 时读到最新值。
  const currentChapterIdRef = useRef<string | null>(currentChapter?.id ?? null)
  currentChapterIdRef.current = currentChapter?.id ?? null
  // 镜像打开列表：closeChapter 在单次事件的批量循环（关闭全部/其他/右侧）内逐步读写，
  // 避免从同一陈旧闭包列表计算导致只关掉最后一个。
  const openedChaptersRef = useRef(openedChapters)
  openedChaptersRef.current = openedChapters

  // 加载章节列表
  useEffect(() => {
    if (projectPath) {
      loadChapters()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在 projectPath 变化时加载
  }, [projectPath])

  const loadChapters = async () => {
    if (!projectPath) return
    try {
      const data = await getAllChapters(projectPath)
      setChapters(data)
      if (data.length > 0) {
        const firstChapter = data[0]
        setOpenedChapters([firstChapter])
        selectChapter(firstChapter)
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

  // 新建章节
  const createChapter = async () => {
    if (!projectPath) return
    const title = `新章节 ${chapters.length + 1}`
    try {
      const newChapter = await createChapterIpc(projectPath, title)
      setChapters([...chapters, newChapter])
      openChapter(newChapter)
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
    save: saveCurrentChapter,
    flushIfDirty: flushIfDirtyStable,
    handleEditorChange
  }
}
