// AI IPC 模块（M4a Task 2 设置保险库三通道 + Task 4 对话/用量通道 + Task 6 真实连接测试）。
// 安全纪律：getSettings/setSettings 的返回值只允许是 toSettingsView 产出的掩码视图——
// 本文件任何 handler 都不得把 loadSettings() 的原始 AiSettings（含明文 apiKey）直接 return。
// testConnection（Task 6）：委托 provider.testConnection；成功只回 {ok, sample}（sample 是
// 模型名/连通性证据，不含密钥），失败一律以 `[kind] 文本` 前缀 reject——AiCallError 的 kind
// 属性跨不过 ipcMain.handle 序列化（对端只拿到 message），所以必须在这里重编前缀；
// 非 AiCallError 归 'provider'。渲染层用 useAI 的 parseKindTaggedError 解包（T4 契约）。
//
// 对话通道分工（Task 4）：受理校验/在途表/事件发射全部在 chatService.ts，本文件只做
// ipcMain 接线；ai:chat 的返回值只表达「已受理」，正文/结果/失败永远走 ai:chunk/ai:done/ai:error
// 事件（event.sender 定向，不全局广播）。受理前失败以同步 reject 回渲染层（message 带 `[kind]` 前缀）。
import { ipcMain } from 'electron'
import type { AiChatRequest, AiSettingsPatch } from '../../../../src/common/ai-types'
import { isConfigured } from '../../../../src/common/ai-types'
import { loadSettings, saveSettings, toSettingsView } from '../../ai/settings'
import { cancelChat, startChat } from '../../ai/chatService'
import { getProvider } from '../../ai/providers'
import { AiCallError } from '../../ai/providers/types'
import { readUsageSummary } from '../../ai/usage'

export function registerAiHandlers(): void {
  // ==================== AI 设置相关 ====================

  ipcMain.handle('ai:getSettings', () => {
    return toSettingsView(loadSettings())
  })

  ipcMain.handle('ai:setSettings', (_event, patch: AiSettingsPatch) => {
    return saveSettings(patch)
  })

  ipcMain.handle('ai:testConnection', async () => {
    const settings = loadSettings()
    if (!isConfigured(settings)) {
      // 前缀形状与渲染层 parseKindTaggedError 词表一致（T4 契约：kind 编进 message 头部）
      throw new Error('[not-configured] 请先在设置中配置协议、Base URL 与 API Key')
    }
    try {
      return await getProvider(settings).testConnection(settings, settings.defaultModel || undefined)
    } catch (err) {
      // kind 属性活不过 ipcMain.handle 序列化：在源头重编 `[kind] ` 前缀（同 chatService 受理前契约）
      if (err instanceof AiCallError) throw new Error(`[${err.kind}] ${err.message}`)
      throw new Error(`[provider] ${err instanceof Error ? err.message : String(err)}`)
    }
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
