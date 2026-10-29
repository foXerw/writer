// ai-types 纯函数契约测试（M4a Task 2）：maskKey 掩码边界 + isConfigured 判定。
// maskKey 是「密钥永不过 IPC」的渲染层最后防线形状，边界（空串/12 全遮/13 部分遮）必须钉死
//（M4c-2 结转微批 #2 裁定：全遮阈值 8 → 12——9~12 字符旧形态泄露 ≥3/4 明文，防反推名存实亡）。
import { describe, expect, it } from 'vitest'
import type { AiProtocol, AiSettings } from './ai-types'
import { isConfigured, maskKey } from './ai-types'

function settings(over: Partial<AiSettings> = {}): AiSettings {
  return {
    protocol: 'openai',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-abcdef1234567890',
    defaultModel: 'gpt-test',
    models: {},
    ...over
  }
}

describe('maskKey', () => {
  it('空串 → 空串（未设置密钥不显示占位点）', () => {
    expect(maskKey('')).toBe('')
  })

  it('短密钥（1~12 字符，含 12 边界）→ 统一 ••••，绝不泄露任何明文片段', () => {
    expect(maskKey('a')).toBe('••••')
    expect(maskKey('abcdefg')).toBe('••••')
    expect(maskKey('abcdefgh')).toBe('••••') // 恰 8 字符：旧阈值边界，仍全遮
    expect(maskKey('abcdefghi')).toBe('••••') // 9 字符：旧形态泄露 9 中 7 位（abc…fghi）——防反推窗口，新阈值下必须全遮
    expect(maskKey('abcdefghijkl')).toBe('••••') // 恰 12 字符：新边界，仍全遮
  })

  it('13 字符起 → 前3…后4（真实 provider 密钥 DeepSeek ~35 / OpenAI 50+ 不受影响）', () => {
    expect(maskKey('abcdefghijklm')).toBe('abc…jklm') // 恰 13 字符：新边界，部分遮
    expect(maskKey('sk-abcdef1234567890')).toBe('sk-…7890')
  })

  it('掩码结果不含完整密钥的任何中段字符', () => {
    const key = 'sk-supersecret-token-9999'
    const masked = maskKey(key)
    expect(masked).toBe('sk-…9999')
    expect(masked).not.toContain('supersecret')
  })
})

describe('isConfigured', () => {
  it('三项齐全 → true', () => {
    expect(isConfigured(settings())).toBe(true)
  })

  it('baseUrl 空串 → false', () => {
    expect(isConfigured(settings({ baseUrl: '' }))).toBe(false)
  })

  it('apiKey 空串 → false（有 key 才算配置完成）', () => {
    expect(isConfigured(settings({ apiKey: '' }))).toBe(false)
  })

  it('protocol 空（运行时脏数据，越类型传入）→ false', () => {
    expect(isConfigured(settings({ protocol: '' as unknown as AiProtocol }))).toBe(false)
  })
})
