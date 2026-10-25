import { useCallback } from 'react'
import type {
  NovelWriterApi,
  ProjectData,
  Chapter,
  Setting,
  Volume,
  ProjectType,
  FileFilter,
  StatsData,
  ExportParams
} from '@/common/ipc'
import type { CharacterV2 } from '@/common/schema'

// 导出格式（原通用服务层的 ExportFormat，随门面迁移）
export type ExportFormat = 'word' | 'pdf' | 'epub'

// 获取统一 IPC 门面（window.novelWriter 是唯一通路，类型见 @/common/ipc）
function getIPC(): NovelWriterApi {
  if (typeof window === 'undefined') {
    throw new Error('IPC只能在渲染进程中使用')
  }

  if (!window.novelWriter) {
    throw new Error('novelWriter API未初始化，请确保在Electron环境中运行')
  }

  return window.novelWriter
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

  return {
    createProject,
    openProject
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
    title: string,
    // Task 5：落在当前卷；未传/null = 未分卷
    volumeId?: string | null
  ): Promise<Chapter> => {
    return ipc.chapter.create({ projectPath, title, volumeId: volumeId ?? null })
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

// 卷相关 Hook（Task 5：与 useChapter 同一薄包装纪律，一通道一函数）
export function useVolume() {
  const ipc = getIPC()

  const getAllVolumes = useCallback(async (projectPath: string): Promise<Volume[]> => {
    return ipc.volume.getAll(projectPath)
  }, [ipc])

  const createVolume = useCallback(async (
    projectPath: string,
    title: string
  ): Promise<Volume> => {
    return ipc.volume.create({ projectPath, title })
  }, [ipc])

  const renameVolume = useCallback(async (
    projectPath: string,
    volumeId: string,
    newTitle: string
  ): Promise<Volume> => {
    return ipc.volume.rename({ projectPath, volumeId, newTitle })
  }, [ipc])

  const deleteVolume = useCallback(async (
    projectPath: string,
    volumeId: string
  ): Promise<boolean> => {
    return ipc.volume.delete({ projectPath, volumeId })
  }, [ipc])

  const reorderVolumes = useCallback(async (
    projectPath: string,
    fromId: string,
    toId: string
  ): Promise<boolean> => {
    return ipc.volume.reorder({ projectPath, fromId, toId })
  }, [ipc])

  // 移卷 = 章的归属变更（volumeId=null 或未传 = 未分卷）
  const moveChapterToVolume = useCallback(async (
    projectPath: string,
    chapterId: string,
    volumeId: string | null
  ): Promise<Chapter> => {
    return ipc.chapter.moveToVolume({ projectPath, chapterId, volumeId })
  }, [ipc])

  return {
    getAllVolumes,
    createVolume,
    renameVolume,
    deleteVolume,
    reorderVolumes,
    moveChapterToVolume
  }
}

// 角色相关 Hook（Task 6：v2 人物卡 CharacterV2）
export function useCharacter() {
  const ipc = getIPC()

  const getAllCharacters = useCallback(async (projectPath: string): Promise<CharacterV2[]> => {
    return ipc.character.getAll(projectPath)
  }, [ipc])

  const getCharacterById = useCallback(async (
    projectPath: string,
    characterId: string
  ): Promise<CharacterV2 | null> => {
    return ipc.character.getById({ projectPath, characterId })
  }, [ipc])

  const createCharacter = useCallback(async (
    projectPath: string,
    character: Partial<CharacterV2>
  ): Promise<CharacterV2> => {
    return ipc.character.create({ projectPath, character })
  }, [ipc])

  const updateCharacter = useCallback(async (
    projectPath: string,
    character: CharacterV2
  ): Promise<CharacterV2> => {
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
    filters: FileFilter[]
  ): Promise<string | null> => {
    return ipc.dialog.openFile(filters)
  }, [ipc])

  // 两参形状保持不变（内部组装门面要求的对象参数，filters 现在真正透传）
  const saveFile = useCallback(async (
    defaultPath: string,
    filters?: FileFilter[]
  ): Promise<string | null> => {
    return ipc.dialog.saveFile({ defaultPath, filters })
  }, [ipc])

  return {
    openDirectory,
    openFile,
    saveFile
  }
}

// 主题 Hook
export function useTheme() {
  const ipc = getIPC()

  const setThemeMode = useCallback(async (mode: 'dark' | 'light'): Promise<boolean> => {
    return ipc.theme.set(mode)
  }, [ipc])

  return {
    setThemeMode
  }
}

// 写作统计 Hook
export function useStats() {
  const ipc = getIPC()

  const getStats = useCallback(async (projectPath: string): Promise<StatsData | null> => {
    return ipc.stats.get(projectPath)
  }, [ipc])

  const saveStats = useCallback(async (
    projectPath: string,
    stats: StatsData
  ): Promise<boolean> => {
    return ipc.stats.save({ projectPath, stats })
  }, [ipc])

  return {
    getStats,
    saveStats
  }
}

// 文档导出 Hook
export function useExport() {
  const ipc = getIPC()

  const exportDocument = useCallback(async (
    format: ExportFormat,
    params: ExportParams
  ): Promise<boolean> => {
    return ipc.export[format](params)
  }, [ipc])

  return {
    exportDocument
  }
}
