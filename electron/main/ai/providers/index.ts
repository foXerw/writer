// Provider 注册表（M4a Task 3）：Task 4 chatService 的唯一入口——按 protocol 取适配器。
// 本目录是唯一对 AI 供应商发 HTTP 的地方；modules/ai.ts 的接线归 Task 6。

import type { AiSettings } from '../../../../src/common/ai-types'
import type { AiProvider } from './types'
import { AiCallError } from './types'
import { anthropicProvider } from './anthropic'
import { openaiProvider } from './openai'

export function getProvider(settings: AiSettings): AiProvider {
  switch (settings.protocol) {
    case 'openai':
      return openaiProvider
    case 'anthropic':
      return anthropicProvider
    default:
      throw new AiCallError('provider', `未知的 AI 协议：${String(settings.protocol ?? '(空)')}`)
  }
}

export { openaiProvider, anthropicProvider }
export { AiCallError, extractJsonLoose, capMessage } from './types'
export type {
  AiProvider,
  ChatRequestInput,
  ProviderChatOptions,
  ProviderChatResult,
  ProviderUsage
} from './types'
export { http } from './http'
