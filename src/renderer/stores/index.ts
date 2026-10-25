import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { ProjectData, RecentProject } from '@/common/ipc'
import type { Combo } from '../services/shortcutService'

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

// 快捷键自定义（应用级，跨项目共享）
interface ShortcutState {
  overrides: Record<string, Combo>
  dialogOpen: boolean
  setBinding: (id: string, combo: Combo) => void
  resetBinding: (id: string) => void
  resetAll: () => void
  setDialogOpen: (open: boolean) => void
}

export const useShortcutStore = create<ShortcutState>()(
  persist(
    (set) => ({
      overrides: {},
      dialogOpen: false,
      setBinding: (id, combo) => set((s) => ({ overrides: { ...s.overrides, [id]: combo } })),
      resetBinding: (id) => set((s) => {
        const overrides = { ...s.overrides }
        delete overrides[id]
        return { overrides }
      }),
      resetAll: () => set({ overrides: {} }),
      setDialogOpen: (open) => set({ dialogOpen: open })
    }),
    {
      name: 'shortcut-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ overrides: s.overrides })
    }
  )
)

// 应用设置（主题等）
interface SettingsState {
  themeMode: 'dark' | 'light'
  setThemeMode: (mode: 'dark' | 'light') => void
  toggleTheme: () => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      themeMode: 'dark',
      setThemeMode: (mode) => set({ themeMode: mode }),
      toggleTheme: () => set({ themeMode: get().themeMode === 'dark' ? 'light' : 'dark' }),
    }),
    {
      name: 'settings-storage',
      storage: createJSONStorage(() => localStorage),
    },
  ),
)
