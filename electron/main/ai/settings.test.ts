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
      models: {},
      completionEnabled: false
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

// M5 Task 3 补全开关（spec 发起人拍板 2：显式 opt-in，默认关）。
// 迁移红线：升级前写下的旧文件没有 completionEnabled 键，load 必须补 false，绝不默认开。
describe('completionEnabled 迁移与读取（M5 默认关）', () => {
  it('旧设置文件（无该键）→ load 迁移为 false（缺键绝不默认开）', () => {
    writeFileSync(
      FILE(),
      JSON.stringify({
        protocol: 'anthropic',
        baseUrl: 'https://x',
        apiKey: 'sk-key-12345678',
        defaultModel: 'claude-test',
        models: {}
      }),
      'utf-8'
    )
    expect(loadSettings().completionEnabled).toBe(false)
  })

  it('文件缺失 → 默认值含 completionEnabled:false', () => {
    expect(loadSettings().completionEnabled).toBe(false)
  })

  it('合法布尔值原样读出（true 可持久）', () => {
    writeFileSync(FILE(), JSON.stringify({ baseUrl: 'https://x', completionEnabled: true }), 'utf-8')
    expect(loadSettings().completionEnabled).toBe(true)
  })

  it('类型漂移（字符串/数字）→ 回退 false，不整盘信任磁盘', () => {
    writeFileSync(FILE(), JSON.stringify({ completionEnabled: 'yes' }), 'utf-8')
    expect(loadSettings().completionEnabled).toBe(false)
    writeFileSync(FILE(), JSON.stringify({ completionEnabled: 1 }), 'utf-8')
    expect(loadSettings().completionEnabled).toBe(false)
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
      models: {},
      completionEnabled: false // M5 Task 3：默认关的迁移红线也在整形状断言里钉死
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

  it('clearApiKey:true → 落盘空串，视图 hasKey:false / maskedKey 空（Task 2 复审裁定的显式清除路径）', () => {
    saveSettings({ apiKey: 'sk-will-be-cleared-9999' })
    expect(saveSettings({}).hasKey).toBe(true) // 前置：清除前确实在册
    const view = saveSettings({ clearApiKey: true })
    expect(loadSettings().apiKey).toBe('')
    expect(view.hasKey).toBe(false)
    expect(view.maskedKey).toBe('')
  })

  it('clearApiKey 与非空 apiKey 同现 → 清除优先（破坏性动作压过写入，杜绝既设又清歧义）', () => {
    saveSettings({ apiKey: 'sk-old-abcdef0000' })
    const view = saveSettings({ apiKey: 'sk-new-abcdef1111', clearApiKey: true })
    expect(loadSettings().apiKey).toBe('')
    expect(view.hasKey).toBe(false)
    expect(JSON.stringify(view)).not.toContain('sk-new-abcdef1111')
  })

  it('clearApiKey falsy（缺省/false/0）→ 保留与替换语义逐字不变', () => {
    saveSettings({ apiKey: 'sk-keep-me-12345678' })
    expect(saveSettings({ clearApiKey: false }).hasKey).toBe(true)
    expect(saveSettings({ clearApiKey: 0 as never }).hasKey).toBe(true)
    expect(saveSettings({ baseUrl: 'https://x.example' }).hasKey).toBe(true)
    expect(loadSettings().apiKey).toBe('sk-keep-me-12345678')
    // 严格 === true 才清除：'true' 字符串不得触发破坏
    expect(saveSettings({ clearApiKey: 'true' as never }).hasKey).toBe(true)
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

  it('patch {completionEnabled:true} 往返：视图透出 true、磁盘落成 true、再 load 为 true', () => {
    const v = saveSettings({ completionEnabled: true })
    expect(v.completionEnabled).toBe(true)
    expect(JSON.parse(readFileSync(FILE(), 'utf-8')).completionEnabled).toBe(true)
    expect(loadSettings().completionEnabled).toBe(true)
  })

  it('completionEnabled 未给（undefined）→ 保留旧值；显式 false → 关掉（布尔三态：缺省保留/真开/假关）', () => {
    saveSettings({ completionEnabled: true })
    expect(saveSettings({ baseUrl: 'https://keep' }).completionEnabled).toBe(true) // patch 不带该键
    expect(loadSettings().completionEnabled).toBe(true)
    expect(saveSettings({ completionEnabled: false }).completionEnabled).toBe(false) // 显式关必须能关掉
    expect(loadSettings().completionEnabled).toBe(false)
  })

  it('completionEnabled 非布尔 patch（字符串/数字）→ 拒绝写入，保留旧值（越界防护）', () => {
    saveSettings({ completionEnabled: true })
    expect(saveSettings({ completionEnabled: 'false' as never }).completionEnabled).toBe(true)
    expect(saveSettings({ completionEnabled: 0 as never }).completionEnabled).toBe(true)
    expect(loadSettings().completionEnabled).toBe(true)
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
        models: {},
        completionEnabled: false
      })
    expect(mk('').maskedKey).toBe('')
    expect(mk('').hasKey).toBe(false)
    expect(mk('short').maskedKey).toBe('••••')
    expect(mk('sk-abcdefgh1234').maskedKey).toBe('sk-…1234')
    expect(mk('sk-abcdefgh1234').hasKey).toBe(true)
  })

  it('completionEnabled 直通透出（纯布尔，无掩码语义，M5 Task 3）', () => {
    const base = { protocol: 'openai', baseUrl: '', apiKey: '', defaultModel: '', models: {} } as const
    expect(toSettingsView({ ...base, models: {}, completionEnabled: true }).completionEnabled).toBe(true)
    expect(toSettingsView({ ...base, models: {}, completionEnabled: false }).completionEnabled).toBe(false)
  })
})
