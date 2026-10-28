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
/**
 * 功能全集（单源白名单，M4b Task 0）：受理校验/账本聚合/用量面板一律引它，不再各抄一份。
 * `as const` 保字面量元组：AiFeature 枚举与列表漂移时，includes/Record 消费点在 tsc 即报错。
 */
export const AI_FEATURES = ['organize', 'completion', 'review'] as const
/**
 * 功能中文标签唯一权威（T6 sweep：设置页「大纲整理/续写/审校」与用量面板「整理/补全/审阅」
 * 漂移收口——所有面向用户的 feature 名一律引本表，勿再各处手抄）。
 */
export const AI_FEATURE_LABELS: Record<AiFeature, string> = {
  organize: '整理',
  completion: '补全',
  review: '审阅'
}
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
/** apiKey 空串/缺省 = 不改；clearApiKey:true = 显式清除（M4a Task 2 复审裁定的清除路径） */
export interface AiSettingsPatch {
  protocol?: AiProtocol
  baseUrl?: string
  apiKey?: string
  /** true = 把已存密钥清空（落盘 ''）。与非空 apiKey 同现时清除优先（删除动作压过写入）。 */
  clearApiKey?: boolean
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
  /**
   * provider 调用空闲上限（毫秒）——计「距上一次流活动的静默时长」，非总时长
   * （语义见 providers/types.ProviderChatOptions.timeoutMs）。缺省/非法 → 主进程默认
   * 45_000；M4b organize 等长生成特性可按需显式放宽。
   */
  timeoutMs?: number
}
export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}
/** 用量计数（账本聚合的原子形状；tokens 单位为 token 数，非金额） */
export interface AiUsageCounter {
  calls: number
  prompt: number
  completion: number
  cached: number
}
/** ai:getUsage 返回形状（Task 4 usage.ts 聚合产出；跨 IPC 只含计数，绝不含正文/密钥） */
export interface AiUsageSummary {
  byFeature: Record<AiFeature, AiUsageCounter>
  total: AiUsageCounter
  byModel: Record<string, { prompt: number; completion: number }>
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
