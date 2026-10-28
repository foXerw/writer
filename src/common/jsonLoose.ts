// 宽容 JSON 解析（M4b Task 4 裁定 3：自 electron/main/ai/providers/types.ts 逐字迁移至此——
// 主/渲染共用，单一来源，providers 侧不再 re-export）。
// AI 输出常在 JSON 前后裹寒暄/围栏，供应商又各自对「只输出 JSON」的遵从度不一：本模块把
// 「从一段任意文本里抠出一个 JSON 对象」做成确定性纯函数，organize 提案解析（T4 useOrganize）
// 与未来 completion/review 消费点共用。
//
// 错误类型说明（迁移带来的唯一形状变化）：原抛出主进程的 AiCallError（src/common 不得依赖
// electron/main，层级倒转禁止），改为下方 JsonExtractError——kind 复用 AiErrorEvent 词表、
// 固定文案与「绝不回显原文」纪律逐字保留（原文可能引用书中内容，隐私红线）。

import type { AiErrorEvent } from './ai-types'

/**
 * 宽容解析失败错误。kind 沿用 AiErrorEvent['kind'] 词表（当前实现只产 'provider'），
 * 调用方按 kind 归因、按 message 展示——message 是固定文案，永不含原文。
 */
export class JsonExtractError extends Error {
  readonly kind: AiErrorEvent['kind']

  constructor(kind: AiErrorEvent['kind'], message: string) {
    super(message)
    this.name = 'JsonExtractError'
    this.kind = kind
  }
}

const JSON_FAIL_MESSAGE = '无法解析模型输出的 JSON'

function tryParse(s: string): unknown {
  // 用异常区分「解析失败」与「解析出 undefined/null」
  return JSON.parse(s)
}

/**
 * 宽容解析模型输出的 JSON。四路（测试钉死）：
 * ① 裸 JSON 直接 parse；② ```json / ``` 围栏剥壳再 parse；
 * ③ 前后杂话 → 首个 '{' 起做字符串感知的平衡大括号扫描截取；
 * ④ 全部失败 → JsonExtractError kind 'provider'（固定文案，不回显原文，防止把怪内容再吐给用户）。
 */
export function extractJsonLoose(raw: string): unknown {
  const text = raw ?? ''
  try {
    return tryParse(text)
  } catch {
    /* fallthrough */
  }

  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  if (fence) {
    try {
      return tryParse(fence[1].trim())
    } catch {
      /* fallthrough */
    }
  }

  const slice = scanBalancedObject(text)
  if (slice !== undefined) {
    try {
      return tryParse(slice)
    } catch {
      /* fallthrough */
    }
  }

  throw new JsonExtractError('provider', JSON_FAIL_MESSAGE)
}

/** 从首个 '{' 开始扫描：跳过大括号计数，跳过字符串内部与转义；深度回零即闭合。 */
function scanBalancedObject(s: string): string | undefined {
  const start = s.indexOf('{')
  if (start < 0) return undefined
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return undefined
}
