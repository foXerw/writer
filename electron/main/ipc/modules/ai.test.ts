// ai:* handler 级测试（M4a Task 6）：testConnection 真接线的 IPC 侧证明——
// ① 未配置 → reject `[not-configured] …`（provider 不被触碰）；
// ② AiCallError 的 kind 在此重编 `[kind] ` 前缀（kind 属性跨不过 ipcMain.handle 序列化，
//    渲染层 parseKindTaggedError 只认 message 头部——前缀即协议，T4 契约）；
// ③ 非 AiCallError → `[provider] ` 前缀；④ 成功透传 {ok, sample}，provider 收到完整设置
//    （含明文 key——主进程内部）与 defaultModel||undefined；
// ⑤ 掩码不变量与 clearApiKey 在 handler 面复钉（返回形状永不含明文、清除后回 not-configured）。
// 模式：vi.mock('electron') 捕获注册（chapter.test.ts 先例）+ userData 指临时目录
// （settings.test.ts 先例）；providers 只换 getProvider（importOriginal 保留 AiCallError 类身份）。
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AiSettingsPatch, AiSettingsView } from '../../../../src/common/ai-types'
import { AiCallError } from '../../ai/providers/types'
import type { AiProvider } from '../../ai/providers/types'

const handlers = vi.hoisted(
  () => new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
)
const holder = vi.hoisted(() => ({
  dir: '',
  provider: null as AiProvider | null,
  getProviderCalls: [] as unknown[],
  testConnectionArgs: [] as [unknown, string | undefined][]
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void => {
      handlers.set(channel, listener)
    }
  },
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') throw new Error(`测试替身只提供 userData，收到: ${name}`)
      return holder.dir
    }
  }
}))

vi.mock('../../ai/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ai/providers')>()
  return {
    ...actual,
    getProvider: (settings: unknown) => {
      holder.getProviderCalls.push(settings)
      const provider = holder.provider
      if (!provider) throw new Error('测试未注入 provider')
      return {
        ...provider,
        testConnection: (s: Parameters<AiProvider['testConnection']>[0], m?: string) => {
          holder.testConnectionArgs.push([s, m])
          return provider.testConnection(s, m)
        }
      }
    }
  }
})

import { registerAiHandlers } from './ai'
import { loadSettings } from '../../ai/settings'

beforeAll(() => {
  registerAiHandlers()
})

beforeEach(() => {
  holder.dir = mkdtempSync(join(tmpdir(), 'perfect-novel-ai-ipc-'))
  holder.provider = null
  holder.getProviderCalls = []
  holder.testConnectionArgs = []
})

afterEach(() => {
  rmSync(holder.dir, { recursive: true, force: true })
})

function getHandler(channel: string) {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler 未注册: ${channel}`)
  return fn
}

const testConnection = (): Promise<unknown> =>
  getHandler('ai:testConnection')(null) as Promise<unknown>

const stubProvider = (over: Partial<AiProvider> = {}): AiProvider => ({
  chat: async () => {
    throw new Error('本任务不触 chat')
  },
  testConnection: async () => ({ ok: true as const, sample: 'models: stub-1' }),
  ...over
})

/** 经真实 setSettings 通道落一份可用配置（掩码视图返回）。 */
async function configure(over: Partial<AiSettingsPatch> = {}): Promise<AiSettingsView> {
  return (await getHandler('ai:setSettings')(null, {
    protocol: 'openai',
    baseUrl: 'https://api.test',
    apiKey: 'sk-handler-key-12345',
    defaultModel: 'gpt-test',
    ...over
  })) as AiSettingsView
}

describe('ai:testConnection 真接线', () => {
  it('未配置 → reject [not-configured] 前缀 + 指路文案；provider 不被触碰', async () => {
    await expect(testConnection()).rejects.toThrow(
      /^\[not-configured\] 请先在设置中配置协议、Base URL 与 API Key/
    )
    expect(holder.getProviderCalls).toHaveLength(0)
  })

  it('AiCallError.kind 在源头重编前缀：network/auth 直通渲染层可解包的形状', async () => {
    await configure()
    holder.provider = stubProvider({
      testConnection: async () => {
        throw new AiCallError('network', '网络请求失败：TypeError: Failed to fetch')
      }
    })
    await expect(testConnection()).rejects.toThrow(
      /^\[network\] 网络请求失败：TypeError: Failed to fetch$/
    )

    holder.provider = stubProvider({
      testConnection: async () => {
        throw new AiCallError('auth', 'HTTP 401: invalid_api_key')
      }
    })
    await expect(testConnection()).rejects.toThrow(/^\[auth\] HTTP 401: invalid_api_key$/)
  })

  it('非 AiCallError → [provider] 前缀（未知异常也必须带可分类标签出边界）', async () => {
    await configure()
    holder.provider = stubProvider({
      testConnection: async () => {
        throw new Error('socket hang up')
      }
    })
    await expect(testConnection()).rejects.toThrow(/^\[provider\] socket hang up$/)
  })

  it('成功透传 {ok, sample}；provider 收到完整设置（主进程内明文合法）+ defaultModel；无默认模型传 undefined', async () => {
    await configure()
    holder.provider = stubProvider({
      testConnection: async () => ({ ok: true as const, sample: 'models: gpt-4o-mini' })
    })
    await expect(testConnection()).resolves.toEqual({ ok: true, sample: 'models: gpt-4o-mini' })
    expect(holder.testConnectionArgs).toHaveLength(1)
    const [settingsPassed, modelPassed] = holder.testConnectionArgs[0]
    const passed = settingsPassed as { apiKey: string; baseUrl: string }
    expect(passed.apiKey).toBe('sk-handler-key-12345') // 明文只在主进程内流转
    expect(passed.baseUrl).toBe('https://api.test')
    expect(modelPassed).toBe('gpt-test')

    await configure({ defaultModel: '' })
    holder.testConnectionArgs = []
    await testConnection()
    expect(holder.testConnectionArgs[0][1]).toBeUndefined()
  })

  it('掩码不变量（handler 面复钉）：setSettings 返回绝不含明文；clearApiKey 清除后测试回 [not-configured]', async () => {
    const view = await configure()
    expect(view.hasKey).toBe(true)
    expect(JSON.stringify(view)).not.toContain('sk-handler-key-12345')

    holder.provider = stubProvider()
    await expect(testConnection()).resolves.toEqual({ ok: true, sample: 'models: stub-1' })

    const cleared = (await getHandler('ai:setSettings')(null, { clearApiKey: true })) as typeof view
    expect(cleared.hasKey).toBe(false)
    expect(loadSettings().apiKey).toBe('')
    await expect(testConnection()).rejects.toThrow(/^\[not-configured\]/)
    expect(holder.getProviderCalls).toHaveLength(1) // 清除后不再触碰 provider
  })
})
