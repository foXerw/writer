import { registerThemeHandlers } from './modules/theme'
import { registerProjectHandlers } from './modules/project'
import { registerFileHandlers } from './modules/file'
import { registerChapterHandlers } from './modules/chapter'
import { registerVolumeHandlers } from './modules/volume'
import { registerDialogHandlers } from './modules/dialog'
import { registerCharacterHandlers } from './modules/character'
import { registerSettingHandlers } from './modules/setting'
import { registerNarrativeHandlers } from './modules/narrative'
import { registerStatsHandlers } from './modules/stats'
import { registerExportHandlers } from './modules/export'

// 聚合入口：按原有顺序注册全部 IPC 通道。
// 保持原有语义——main/index.ts `import './ipc/handlers'` 时（早于 app.whenReady）即完成注册，
// 因此在此处模块作用域直接调用，而非延迟导出。
export function registerAllIpcHandlers(): void {
  registerThemeHandlers()
  registerProjectHandlers()
  registerFileHandlers()
  registerChapterHandlers()
  registerVolumeHandlers()
  registerDialogHandlers()
  registerCharacterHandlers()
  registerSettingHandlers()
  registerNarrativeHandlers()
  registerStatsHandlers()
  registerExportHandlers()
}

registerAllIpcHandlers()
