// AI 失败中文归因文案（M4b Task 4 裁定 9：自 AiSettingsSection 的 TEST_FAILURE_TEXT 抽出——
// kind 词表单一权威，设置页「测试连接」与 organize 管线「整理本章」共用同一张表，
// 将来 completion/review 的 UI 面也只引它，不再各抄一份）。
// 键 = AiErrorEvent['kind'] 穷举（Record 类型保证词表演进时编译期强制补齐）。
import type { AiErrorEvent } from '@/common/ai-types'

export const AI_ERROR_TEXT: Record<AiErrorEvent['kind'], string> = {
  auth: '密钥或地址被拒（401/403）',
  network: '网络不通或地址错误',
  timeout: '连接超时',
  'not-configured': '请先完成配置',
  provider: '服务返回错误',
  cancelled: '已取消',
  busy: '已有请求在途'
}

/** kind → 中文标签；detail（服务端/通道原文）非空时拼在标签后，8s 长展示档（同设置页手感）。 */
export function aiErrorToast(kind: AiErrorEvent['kind'], detail?: string): string {
  const label = AI_ERROR_TEXT[kind]
  return detail ? `${label}：${detail}` : label
}
