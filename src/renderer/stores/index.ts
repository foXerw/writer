import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Chapter, ProjectData, RecentProject, WritingStats } from '../common/ipc'

// Tab状态
interface TabState {
  openedTabs: Chapter[]
  activeTabId: string | null
  setOpenedTabs: (tabs: Chapter[]) => void
  addTab: (chapter: Chapter) => void
  removeTab: (chapterId: string) => void
  setActiveTab: (chapterId: string) => void
  closeAllTabs: () => void
  reorderTabs: (fromIndex: number, toIndex: number) => void
}

// 使用持久化存储
export const useTabStore = create<TabState>()(
  persist(
    (set, get) => ({
      openedTabs: [],
      activeTabId: null,

      setOpenedTabs: (tabs) => set({ openedTabs: tabs }),

      addTab: (chapter) => {
        const { openedTabs } = get()
        if (!openedTabs.find(t => t.id === chapter.id)) {
          set({ openedTabs: [...openedTabs, chapter] })
        }
        set({ activeTabId: chapter.id })
      },

      removeTab: (chapterId) => {
        const { openedTabs, activeTabId } = get()
        const index = openedTabs.findIndex(t => t.id === chapterId)
        const newTabs = openedTabs.filter(t => t.id !== chapterId)

        let newActiveId = activeTabId
        if (activeTabId === chapterId) {
          if (newTabs.length > 0) {
            newActiveId = index > 0 ? newTabs[index - 1].id : newTabs[0].id
          } else {
            newActiveId = null
          }
        }

        set({ openedTabs: newTabs, activeTabId: newActiveId })
      },

      setActiveTab: (chapterId) => set({ activeTabId: chapterId }),

      closeAllTabs: () => set({ openedTabs: [], activeTabId: null }),

      reorderTabs: (fromIndex, toIndex) => {
        const { openedTabs } = get()
        const newTabs = [...openedTabs]
        const [removed] = newTabs.splice(fromIndex, 1)
        newTabs.splice(toIndex, 0, removed)
        set({ openedTabs: newTabs })
      }
    }),
    {
      name: 'tab-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        openedTabs: state.openedTabs.map(t => ({
          id: t.id,
          title: t.title,
          content: '', // 不持久化内容，只保存元数据
          order: t.order,
          status: t.status,
          wordCount: t.wordCount,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt
        })),
        activeTabId: state.activeTabId
      })
    }
  )
)

// 项目状态
interface ProjectState {
  currentProject: ProjectData | null
  recentProjects: RecentProject[]
  setCurrentProject: (project: ProjectData | null) => void
  addRecentProject: (project: RecentProject) => void
  clearRecentProjects: () => void
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      currentProject: null,
      recentProjects: [],

      setCurrentProject: (project) => set({ currentProject: project }),

      addRecentProject: (project) => {
        const { recentProjects } = get()
        const filtered = recentProjects.filter(p => p.path !== project.path)
        set({ recentProjects: [project, ...filtered].slice(0, 10) })
      },

      clearRecentProjects: () => set({ recentProjects: [] })
    }),
    {
      name: 'project-storage',
      storage: createJSONStorage(() => localStorage)
    }
  )
)

// 编辑器状态
interface EditorState {
  focusMode: boolean
  typewriterMode: boolean
  showLineNumbers: boolean
  wordWrap: boolean
  fontSize: number
  setFocusMode: (enabled: boolean) => void
  setTypewriterMode: (enabled: boolean) => void
  setShowLineNumbers: (show: boolean) => void
  setWordWrap: (wrap: boolean) => void
  setFontSize: (size: number) => void
}

export const useEditorStore = create<EditorState>()(
  persist(
    (set) => ({
      focusMode: false,
      typewriterMode: false,
      showLineNumbers: true,
      wordWrap: true,
      fontSize: 16,

      setFocusMode: (enabled) => set({ focusMode: enabled }),
      setTypewriterMode: (enabled) => set({ typewriterMode: enabled }),
      setShowLineNumbers: (show) => set({ showLineNumbers: show }),
      setWordWrap: (wrap) => set({ wordWrap: wrap }),
      setFontSize: (size) => set({ fontSize: size })
    }),
    {
      name: 'editor-storage',
      storage: createJSONStorage(() => localStorage)
    }
  )
)

// 写作统计状态
interface StatsState {
  stats: WritingStats
  todayWordCount: number
  setStats: (stats: WritingStats) => void
  addWordCount: (count: number) => void
  updateDuration: (minutes: number) => void
}

export const useStatsStore = create<StatsState>()(
  persist(
    (set) => ({
      stats: {
        dailyWordCount: 0,
        totalWordCount: 0,
        writingDuration: 0,
        streak: 0
      },
      todayWordCount: 0,

      setStats: (stats) => set({ stats }),

      addWordCount: (count) => set((state) => ({
        todayWordCount: state.todayWordCount + count,
        stats: {
          ...state.stats,
          dailyWordCount: state.stats.dailyWordCount + count,
          totalWordCount: state.stats.totalWordCount + count
        }
      })),

      updateDuration: (minutes) => set((state) => ({
        stats: {
          ...state.stats,
          writingDuration: state.stats.writingDuration + minutes
        }
      }))
    }),
    {
      name: 'stats-storage',
      storage: createJSONStorage(() => localStorage)
    }
  )
)
