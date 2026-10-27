// parseKindTaggedError 的边界形状回归钉（Task 4 评审 FIX-1）。
// 教训与 bookErrors.ts 同源：electron ipcMain.handle 的 reject 到渲染层永远被包成
// `Error invoking remote method 'ai:chat': Error: <原 message>`——`[kind]` tag 不在位置 0，
// 纯 anchored 解析在生产形态下会把所有受理失败误路由成 provider。
// 本文件全部用**真实包装串**断言（chatService 进程内 throw 的形状只能算阴性对照组）。
import { describe, expect, it } from 'vitest'
import { parseKindTaggedError } from './useAI'

const WRAPPED_BUSY = `Error invoking remote method 'ai:chat': Error: [busy] 请求 r1 正在处理中`

describe('parseKindTaggedError（真实 IPC 包装形状）', () => {
  it('生产形态的 busy：剥包装 → kind 保真、message 无 wrapper 垃圾', () => {
    expect(parseKindTaggedError(WRAPPED_BUSY)).toEqual({ kind: 'busy', message: '请求 r1 正在处理中' })
  })

  it('包装里可选的 `Error: ` 段缺失也照剥（不同 electron 版本形状）', () => {
    expect(parseKindTaggedError(`Error invoking remote method 'ai:chat': [not-configured] AI 尚未配置（协议/BaseUrl/密钥需齐全）`))
      .toEqual({ kind: 'not-configured', message: 'AI 尚未配置（协议/BaseUrl/密钥需齐全）' })
  })

  it('进程内直抛（无包装）——原路径不回归', () => {
    expect(parseKindTaggedError('[provider] 对话请求形状不合法（requestId/messages）'))
      .toEqual({ kind: 'provider', message: '对话请求形状不合法（requestId/messages）' })
  })

  it('尾部 stack 行裁掉：`\\n    at …` 起整段丢弃（含 kind 命中与未命中两路）', () => {
    const stack = '\n    at Object.startChat (file:///app/electron/main/ai/chatService.js:42:1)\n    at WebContentsInvoke (node:electron/js2c)'
    expect(parseKindTaggedError(`Error invoking remote method 'ai:chat': Error: [cancelled] AI 请求已被取消${stack}`))
      .toEqual({ kind: 'cancelled', message: 'AI 请求已被取消' })
    expect(parseKindTaggedError(`Error invoking remote method 'ai:chat': Error: 磁盘炸了${stack}`))
      .toEqual({ kind: 'provider', message: '磁盘炸了' })
  })

  it('解包后仍锚定：正文中途出现 `[busy] ` 字样不被误路由（不做全文扫描是契约）', () => {
    const r = parseKindTaggedError(`Error invoking remote method 'ai:chat': Error: 失败原因见 [busy] 备注里的旧值`)
    expect(r).toEqual({ kind: 'provider', message: '失败原因见 [busy] 备注里的旧值' })
  })

  it('非错误文案直通：无包装无 tag → provider + 原文', () => {
    expect(parseKindTaggedError('weird')).toEqual({ kind: 'provider', message: 'weird' })
  })
})
