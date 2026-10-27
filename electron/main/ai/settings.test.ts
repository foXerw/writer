// 主进程 AI 设置保险库测试（M4a Task 2）。
// vi.mock('electron') 把 app.getPath('userData') 指到临时目录（project.test.ts 先例），
// 每个用例独享 tmp 目录，互不污染。安全不变量在此钉死：
// ① saveSettings/loadSettings 的返回值形状里绝不出现明文 apiKey（只有掩码视图）；
// ② 坏文件 console.warn 不抛，且 warn/throw 的文案绝不回显文件内容；
// ③ apiKey undefined|'' 的 patch = 保留旧密钥（UI 用空串表达「不修改」）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AiSettings, AiSettingsView } from '../../../src/common/ai-types'

// 必须在 vi.mock 工厂里可读 → 用 hoisted 持有当前 tmp 目录（每次 beforeEach 换新的）
const holder = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') throw new Error(`测试替身只提供 userData，收到: ${name}`)
      return holder.dir
    }
  }
}))

import { loadSettings, saveSettings, toSettingsView } from './settings'

const FILE = (): string => join(holder.dir, 'ai-settings.json')

beforeEach(() => {
  holder.dir = mkdtempSync(join(tmpdir(), 'perfect-novel-ai-settings-'))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  rmSync(holder.dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('loadSettings', () => {
  it('文件缺失 → 返回完整默认值（不抛）', () => {
    const s = loadSettings()
    expect(s).toEqual({
      protocol: 'openai',
      baseUrl: '',
      apiKey: '',
      defaultModel: '',
      models: {}
    })
  })

  it('坏文件（非法 JSON）→ 回退默认、console.warn、绝不抛；warn 文案不回显文件内容', () => {
    const SENTINEL = 'SENTINEL-SECRET-FILE-CONTENT-DO-NOT-ECHO'
    writeFileSync(FILE(), `{ not json [[ ${SENTINEL} ]}`, 'utf-8')

    const s = loadSettings() // 不抛
    expect(s.protocol).toBe('openai')
    expect(s.apiKey).toBe('')

    const warnText = vi.mocked(console.warn).mock.calls.flat().map(String).join(' ')
    expect(warnText).toContain('ai-settings') // 提示指向哪个文件
    expect(warnText).not.toContain(SENTINEL) // 绝不回显文件内容
    expect(warnText).not.toContain('{ not json')
  })

  it('结构损坏（类型漂移/字段缺失）→ 逐字段回退默认，不整盘信任磁盘', () => {
    writeFileSync(
      FILE(),
      JSON.stringify({ protocol: 'midi', baseUrl: 42, models: 'nope', defaultModel: 'm' }),
      'utf-8'
    )
    const s = loadSettings()
    expect(s.protocol).toBe('openai') // 非法枚举回退
    expect(s.baseUrl).toBe('') // 非字符串回退
    expect(s.models).toEqual({})
    expect(s.defaultModel).toBe('m')
    expect(s.apiKey).toBe('')
  })

  it('合法文件 → 原样读出', () => {
    writeFileSync(
      FILE(),
      JSON.stringify({
        protocol: 'anthropic',
        baseUrl: 'https://x',
        apiKey: 'sk-key-12345678',
        defaultModel: 'claude-test',
        models: { organize: 'o-model' }
      }),
      'utf-8'
    )
    const s = loadSettings()
    expect(s.protocol).toBe('anthropic')
    expect(s.apiKey).toBe('sk-key-12345678')
    expect(s.models).toEqual({ organize: 'o-model' })
  })
})

describe('saveSettings 合并语义', () => {
  it('空 patch → 返回掩码视图；磁盘落成默认值；视图对象绝不带 apiKey 属性', () => {
    const view = saveSettings({})
    expect(view).toEqual({
      protocol: 'openai',
      baseUrl: '',
      hasKey: false,
      maskedKey: '',
      defaultModel: '',
      models: {}
    })
    expect('apiKey' in view).toBe(false)
    expect('maskedKey' in (loadSettings() as AiSettings)).toBe(false) // 磁盘存的是完整对象而非视图
    expect(readFileSync(FILE(), 'utf-8')).toContain('"apiKey"')
  })

  it('apiKey undefined 与 空串 都=保留旧密钥（UI「不修改」语义）', () => {
    saveSettings({ apiKey: 'sk-original-123456' })
    const v1 = saveSettings({ baseUrl: 'https://changed.example' }) // apiKey 缺省
    expect(loadSettings().apiKey).toBe('sk-original-123456')
    const v2 = saveSettings({ apiKey: '' }) // apiKey 空串
    expect(loadSettings().apiKey).toBe('sk-original-123456')
    expect(v1.baseUrl).toBe('https://changed.example')
    expect(v2.hasKey).toBe(true)
    expect(v2.maskedKey).toBe('sk-…3456') // 前3…后4
  })

  it('apiKey 非空 → 整体替换；视图返回新掩码', () => {
    saveSettings({ apiKey: 'sk-old-abcdef1111' })
    const view = saveSettings({ apiKey: 'sk-new-token-22222' })
    expect(loadSettings().apiKey).toBe('sk-new-token-22222')
    expect(view.maskedKey).toBe('sk-…2222')
    expect(JSON.stringify(view)).not.toContain('sk-new-token-22222')
  })

  it('models 部分合并：只覆盖给了值的键，未给（undefined）的保留旧值', () => {
    saveSettings({ models: { organize: 'org-a', completion: 'cmp-a', review: 'rev-a' } })
    const view = saveSettings({ models: { organize: 'org-b' } })
    expect(loadSettings().models).toEqual({
      organize: 'org-b',
      completion: 'cmp-a',
      review: 'rev-a'
    })
    expect(view.models).toEqual({ organize: 'org-b', completion: 'cmp-a', review: 'rev-a' })
  })

  it('协议/BaseUrl/默认模型逐字段覆盖，未传字段保持不变', () => {
    saveSettings({ protocol: 'anthropic', baseUrl: 'https://a', defaultModel: 'm1' })
    const view = saveSettings({ baseUrl: 'https://b' })
    expect(view.protocol).toBe('anthropic')
    expect(view.baseUrl).toBe('https://b')
    expect(view.defaultModel).toBe('m1')
  })

  it('非法 protocol patch → 拒绝写入，保留旧值（越界防护）', () => {
    saveSettings({ protocol: 'openai' })
    const view = saveSettings({ protocol: 'midi' as never })
    expect(view.protocol).toBe('openai')
    expect(loadSettings().protocol).toBe('openai')
  })

  it('写盘失败 → 抛错，且错误信息不回显文件内容', () => {
    // 触发：ai-settings.json 路径被同名目录占据 → writeFileSync EISDIR
    mkdirSync(FILE())
    let err: unknown
    try {
      saveSettings({ apiKey: 'sk-super-secret-do-not-echo' })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(Error)
    const text = String((err as Error).message)
    expect(text).toContain('AI_SETTINGS_WRITE_FAILED')
    expect(text).not.toContain('super-secret')
  })
})

describe('toSettingsView', () => {
  it('长密钥 → 前3…后4；短密钥 → ••••；空密钥 → 空串 + hasKey:false', () => {
    const mk = (apiKey: string): AiSettingsView =>
      toSettingsView({
        protocol: 'openai',
        baseUrl: '',
        apiKey,
        defaultModel: '',
        models: {}
      })
    expect(mk('').maskedKey).toBe('')
    expect(mk('').hasKey).toBe(false)
    expect(mk('short').maskedKey).toBe('••••')
    expect(mk('sk-abcdefgh1234').maskedKey).toBe('sk-…1234')
    expect(mk('sk-abcdefgh1234').hasKey).toBe(true)
  })
})
