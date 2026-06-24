import { useCallback } from 'react'
import type { ProjectData, Chapter, Character, Setting, RecentProject, ProjectType } from '@/common/ipc'

// IPC API 类型
interface IPCAPI {
  project: {
    create: (params: { name: string; path: string; type: ProjectType }) => Promise<ProjectData>
    open: (path: string) => Promise<ProjectData>
    getRecent: () => Promise<RecentProject[]>
  }
  file: {
    read: (path: string) => Promise<string>
    write: (params: { path: string; content: string }) => Promise<boolean>
    delete: (path: string) => Promise<boolean>
    exists: (path: string) => Promise<boolean>
  }
  chapter: {
    getAll: (projectPath: string) => Promise<Chapter[]>
    create: (params: { projectPath: string; title: string }) => Promise<Chapter>
    update: (params: { projectPath: string; chapter: Chapter }) => Promise<Chapter>
    delete: (params: { projectPath: string; chapterId: string }) => Promise<boolean>
    rename: (params: { projectPath: string; chapterId: string; newTitle: string }) => Promise<Chapter>
    reorder: (params: { projectPath: string; fromId: string; toId: string }) => Promise<boolean>
    getById: (params: { projectPath: string; chapterId: string }) => Promise<Chapter | null>
  }
  character: {
    getAll: (projectPath: string) => Promise<Character[]>
    getById: (params: { projectPath: string; characterId: string }) => Promise<Character | null>
    create: (params: { projectPath: string; character: Partial<Character> }) => Promise<Character>
    update: (params: { projectPath: string; character: Character }) => Promise<Character>
    delete: (params: { projectPath: string; characterId: string }) => Promise<boolean>
  }
  setting: {
    getAll: (projectPath: string) => Promise<Setting[]>
    getById: (params: { projectPath: string; settingId: string }) => Promise<Setting | null>
    create: (params: { projectPath: string; setting: Partial<Setting> }) => Promise<Setting>
    update: (params: { projectPath: string; setting: Setting }) => Promise<Setting>
    delete: (params: { projectPath: string; settingId: string }) => Promise<boolean>
  }
  dialog: {
    openDirectory: () => Promise<string | null>
    openFile: (filters: { name: string; extensions: string[] }[]) => Promise<string | null>
    saveFile: (defaultPath: string) => Promise<string | null>
  }
}

// 获取IPC API
function getIPC(): IPCAPI {
  if (typeof window === 'undefined') {
    throw new Error('IPC只能在渲染进程中使用')
  }

  if (!window.novelWriter) {
    throw new Error('novelWriter API未初始化，请确保在Electron环境中运行')
  }

  return window.novelWriter as unknown as IPCAPI
}

// 项目相关Hook
export function useProject() {
  const ipc = getIPC()

  const createProject = useCallback(async (
    name: string,
    path: string,
    type: ProjectType
  ): Promise<ProjectData> => {
    return ipc.project.create({ name, path, type })
  }, [ipc])

  const openProject = useCallback(async (projectPath: string): Promise<ProjectData> => {
    return ipc.project.open(projectPath)
  }, [ipc])

  const getRecentProjects = useCallback(async (): Promise<RecentProject[]> => {
    return ipc.project.getRecent()
  }, [ipc])

  return {
    createProject,
    openProject,
    getRecentProjects
  }
}

// 文件相关Hook
export function useFile() {
  const ipc = getIPC()

  const readFile = useCallback(async (filePath: string): Promise<string> => {
    return ipc.file.read(filePath)
  }, [ipc])

  const writeFile = useCallback(async (
    filePath: string,
    content: string
  ): Promise<boolean> => {
    return ipc.file.write({ path: filePath, content })
  }, [ipc])

  const deleteFile = useCallback(async (filePath: string): Promise<boolean> => {
    return ipc.file.delete(filePath)
  }, [ipc])

  const fileExists = useCallback(async (filePath: string): Promise<boolean> => {
    return ipc.file.exists(filePath)
  }, [ipc])

  return {
    readFile,
    writeFile,
    deleteFile,
    fileExists
  }
}

// 章节相关Hook
export function useChapter() {
  const ipc = getIPC()

  const getAllChapters = useCallback(async (projectPath: string): Promise<Chapter[]> => {
    return ipc.chapter.getAll(projectPath)
  }, [ipc])

  const createChapter = useCallback(async (
    projectPath: string,
    title: string
  ): Promise<Chapter> => {
    return ipc.chapter.create({ projectPath, title })
  }, [ipc])

  const updateChapter = useCallback(async (
    projectPath: string,
    chapter: Chapter
  ): Promise<Chapter> => {
    return ipc.chapter.update({ projectPath, chapter })
  }, [ipc])

  const deleteChapter = useCallback(async (
    projectPath: string,
    chapterId: string
  ): Promise<boolean> => {
    return ipc.chapter.delete({ projectPath, chapterId })
  }, [ipc])

  const renameChapter = useCallback(async (
    projectPath: string,
    chapterId: string,
    newTitle: string
  ): Promise<Chapter> => {
    return ipc.chapter.rename({ projectPath, chapterId, newTitle })
  }, [ipc])

  const reorderChapters = useCallback(async (
    projectPath: string,
    fromId: string,
    toId: string
  ): Promise<boolean> => {
    return ipc.chapter.reorder({ projectPath, fromId, toId })
  }, [ipc])

  const getChapterById = useCallback(async (
    projectPath: string,
    chapterId: string
  ): Promise<Chapter | null> => {
    return ipc.chapter.getById({ projectPath, chapterId })
  }, [ipc])

  return {
    getAllChapters,
    createChapter,
    updateChapter,
    deleteChapter,
    renameChapter,
    reorderChapters,
    getChapterById
  }
}

// 角色相关 Hook
export function useCharacter() {
  const ipc = getIPC()

  const getAllCharacters = useCallback(async (projectPath: string): Promise<Character[]> => {
    return ipc.character.getAll(projectPath)
  }, [ipc])

  const getCharacterById = useCallback(async (
    projectPath: string,
    characterId: string
  ): Promise<Character | null> => {
    return ipc.character.getById({ projectPath, characterId })
  }, [ipc])

  const createCharacter = useCallback(async (
    projectPath: string,
    character: Partial<Character>
  ): Promise<Character> => {
    return ipc.character.create({ projectPath, character })
  }, [ipc])

  const updateCharacter = useCallback(async (
    projectPath: string,
    character: Character
  ): Promise<Character> => {
    return ipc.character.update({ projectPath, character })
  }, [ipc])

  const deleteCharacter = useCallback(async (
    projectPath: string,
    characterId: string
  ): Promise<boolean> => {
    return ipc.character.delete({ projectPath, characterId })
  }, [ipc])

  return {
    getAllCharacters,
    getCharacterById,
    createCharacter,
    updateCharacter,
    deleteCharacter
  }
}

// 世界观设定相关 Hook
export function useSetting() {
  const ipc = getIPC()

  const getAllSettings = useCallback(async (projectPath: string): Promise<Setting[]> => {
    return ipc.setting.getAll(projectPath)
  }, [ipc])

  const getSettingById = useCallback(async (
    projectPath: string,
    settingId: string
  ): Promise<Setting | null> => {
    return ipc.setting.getById({ projectPath, settingId })
  }, [ipc])

  const createSetting = useCallback(async (
    projectPath: string,
    setting: Partial<Setting>
  ): Promise<Setting> => {
    return ipc.setting.create({ projectPath, setting })
  }, [ipc])

  const updateSetting = useCallback(async (
    projectPath: string,
    setting: Setting
  ): Promise<Setting> => {
    return ipc.setting.update({ projectPath, setting })
  }, [ipc])

  const deleteSetting = useCallback(async (
    projectPath: string,
    settingId: string
  ): Promise<boolean> => {
    return ipc.setting.delete({ projectPath, settingId })
  }, [ipc])

  return {
    getAllSettings,
    getSettingById,
    createSetting,
    updateSetting,
    deleteSetting
  }
}

// 对话框Hook
export function useDialog() {
  const ipc = getIPC()

  const openDirectory = useCallback(async (): Promise<string | null> => {
    return ipc.dialog.openDirectory()
  }, [ipc])

  const openFile = useCallback(async (
    filters: { name: string; extensions: string[] }[]
  ): Promise<string | null> => {
    return ipc.dialog.openFile(filters)
  }, [ipc])

  const saveFile = useCallback(async (
    defaultPath: string
  ): Promise<string | null> => {
    return ipc.dialog.saveFile(defaultPath)
  }, [ipc])

  return {
    openDirectory,
    openFile,
    saveFile
  }
}
