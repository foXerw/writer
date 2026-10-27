// AI IPC 模块（M4a Task 2：设置保险库三通道）。
// 安全纪律：getSettings/setSettings 的返回值只允许是 toSettingsView 产出的掩码视图——
// 本文件任何 handler 都不得把 loadSettings() 的原始 AiSettings（含明文 apiKey）直接 return。
// testConnection 是诚实占位（Task 3 provider 落地后由 Task 6 接真实探测）。
import { ipcMain } from 'electron'
import type { AiSettingsPatch } from '../../../../src/common/ai-types'
import { loadSettings, saveSettings, toSettingsView } from '../../ai/settings'

export function registerAiHandlers(): void {
  // ==================== AI 设置相关 ====================

  ipcMain.handle('ai:getSettings', () => {
    return toSettingsView(loadSettings())
  })

  ipcMain.handle('ai:setSettings', (_event, patch: AiSettingsPatch) => {
    return saveSettings(patch)
  })

  ipcMain.handle('ai:testConnection', () => {
    // Task 2 占位：provider 尚未就绪，不假装成功
    throw new Error('AI_PROVIDER_NOT_READY: 连接测试将在 provider 就绪后启用')
  })
}
