// AI 服务层共享类型（主进程/渲染进程共用，M4a Task 2）。
//
// 安全不变量（Task 1 密钥分层的延续）：
// - 明文 apiKey 只存在于主进程（userData/ai-settings.json）；
// - 跨 IPC 进入渲染进程的形状永远是 AiSettingsView（掩码视图，永不含明文 key）；
// - AiSettingsPatch.apiKey 的空串/缺省语义 = 「不修改」（UI 无法也无需回传旧密钥）。
//
// Task 3（providers）与 Task 4（chatService）直接消费本文件的对话/用量类型。

export type AiProtocol = 'openai' | 'anthropic'
export type AiFeature = 'organize' | 'completion' | 'review'
export interface AiModels {
  organize?: string
  completion?: string
  review?: string
}
/** 完整设置（仅主进程内部流转；绝不作为 IPC 返回值） */
export interface AiSettings {
  protocol: AiProtocol
  baseUrl: string
  apiKey: string
  defaultModel: string
  models: AiModels
}
/** 掩码视图，永不含明文 key */
export interface AiSettingsView {
  protocol: AiProtocol
  baseUrl: string
  hasKey: boolean
  maskedKey: string
  defaultModel: string
  models: AiModels
}
/** apiKey 空串/缺省 = 不改 */
export interface AiSettingsPatch {
  protocol?: AiProtocol
  baseUrl?: string
  apiKey?: string
  defaultModel?: string
  models?: AiModels
}
export interface AiUsageRecord {
  ts: string
  feature: AiFeature
  model: string
  promptTokens: number
  completionTokens: number
  cachedTokens?: number
}
export interface AiChatRequest {
  requestId: string
  projectPath?: string
  feature: AiFeature
  model?: string
  messages: AiMessage[]
  temperature?: number
  maxTokens?: number
}
export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}
export interface AiChunkEvent {
  requestId: string
  text: string
}
export interface AiDoneEvent {
  requestId: string
  usage: { promptTokens: number; completionTokens: number; cachedTokens?: number }
}
export interface AiErrorEvent {
  requestId: string
  kind:
    | 'not-configured'
    | 'auth'
    | 'network'
    | 'timeout'
    | 'provider'
    | 'cancelled'
    | 'busy'
  message: string
}

/**
 * 密钥掩码：'' → ''；≤8 → '••••'（短密钥全遮防反推）；否则 `前3…后4`。
 * 纯函数、无副作用——渲染层与主进程共用同一形状真相。
 */
export function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '••••'
  return `${key.slice(0, 3)}…${key.slice(-4)}`
}

/** 三项齐全（protocol 真值 && baseUrl 非空 && apiKey 非空）才算可用 */
export function isConfigured(s: AiSettings): boolean {
  return Boolean(s.protocol) && Boolean(s.baseUrl) && Boolean(s.apiKey)
}
