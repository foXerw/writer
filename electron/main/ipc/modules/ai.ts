// AI IPC 模块（M4a Task 2 设置保险库三通道 + Task 4 对话/用量通道）。
// 安全纪律：getSettings/setSettings 的返回值只允许是 toSettingsView 产出的掩码视图——
// 本文件任何 handler 都不得把 loadSettings() 的原始 AiSettings（含明文 apiKey）直接 return。
// testConnection 是诚实占位（Task 3 provider 落地后由 Task 6 接真实探测）。
//
// 对话通道分工（Task 4）：受理校验/在途表/事件发射全部在 chatService.ts，本文件只做
// ipcMain 接线；ai:chat 的返回值只表达「已受理」，正文/结果/失败永远走 ai:chunk/ai:done/ai:error
// 事件（event.sender 定向，不全局广播）。受理前失败以同步 reject 回渲染层（message 带 `[kind]` 前缀）。
import { ipcMain } from 'electron'
import type { AiChatRequest, AiSettingsPatch } from '../../../../src/common/ai-types'
import { loadSettings, saveSettings, toSettingsView } from '../../ai/settings'
import { cancelChat, startChat } from '../../ai/chatService'
import { readUsageSummary } from '../../ai/usage'

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

  // ==================== AI 对话相关（Task 4） ====================

  ipcMain.handle('ai:chat', (event, request: AiChatRequest) => {
    return startChat(event.sender, request)
  })

  ipcMain.handle('ai:cancel', (_event, requestId: string) => {
    return cancelChat(String(requestId))
  })

  ipcMain.handle('ai:getUsage', (_event, projectPath: string) => {
    return readUsageSummary(String(projectPath))
  })
}
