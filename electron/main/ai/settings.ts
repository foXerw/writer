// 主进程 AI 设置保险库（M4a Task 2）。
//
// 唯一持有明文 apiKey 的模块：文件 userData/ai-settings.json 只在主进程读写，
// 对外（IPC/渲染层）一律只暴露 AiSettingsView 掩码视图——toSettingsView 是唯一出口形状。
//
// 合并语义（与 src/common/ai-types.ts 的 AiSettingsPatch 契约一致）：
// - apiKey 缺省 | 空串 = 保留旧密钥（UI 发送空串即「不修改」）；非空串 = 整体替换；
// - models 按键部分合并：给了值的键覆盖，未给的键保留旧值，空串 = 清除该覆盖；
// - 非法 protocol / 类型漂移的字段一律拒绝（保留旧值），绝不整盘信任磁盘/入参。
//
// 容错与噪音纪律：load 坏文件 console.warn 回退默认、绝不抛；warn 与 throw 文案
// 只含错误名/errno code，绝不回显文件内容（防密钥经日志面侧漏）。

import { app } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { AiModels, AiProtocol, AiSettings, AiSettingsPatch, AiSettingsView } from '../../../src/common/ai-types'
import { maskKey } from '../../../src/common/ai-types'

const SETTINGS_FILE_NAME = 'ai-settings.json'

const DEFAULT_SETTINGS: AiSettings = {
  protocol: 'openai',
  baseUrl: '',
  apiKey: '',
  defaultModel: '',
  models: {}
}

const VALID_PROTOCOLS: readonly AiProtocol[] = ['openai', 'anthropic']
const MODEL_KEYS: readonly (keyof AiModels)[] = ['organize', 'completion', 'review']

function settingsFilePath(): string {
  return path.join(app.getPath('userData'), SETTINGS_FILE_NAME)
}

function isString(v: unknown): v is string {
  return typeof v === 'string'
}

/** 磁盘/入参 JSON → 合法 AiSettings：逐字段校验回退，缺什么补什么（越界防护）。 */
function coerceSettings(raw: unknown): AiSettings {
  const o = (raw ?? {}) as Record<string, unknown>
  const models: AiModels = {}
  if (o.models && typeof o.models === 'object' && !Array.isArray(o.models)) {
    const m = o.models as Record<string, unknown>
    for (const key of MODEL_KEYS) {
      if (isString(m[key]) && m[key] !== '') models[key] = m[key]
    }
  }
  return {
    protocol: VALID_PROTOCOLS.includes(o.protocol as AiProtocol)
      ? (o.protocol as AiProtocol)
      : DEFAULT_SETTINGS.protocol,
    baseUrl: isString(o.baseUrl) ? o.baseUrl : DEFAULT_SETTINGS.baseUrl,
    apiKey: isString(o.apiKey) ? o.apiKey : DEFAULT_SETTINGS.apiKey,
    defaultModel: isString(o.defaultModel) ? o.defaultModel : DEFAULT_SETTINGS.defaultModel,
    models
  }
}

/** 读盘并规整；缺文件/坏文件 → warn（不回显内容）+ 默认值，绝不抛。 */
export function loadSettings(): AiSettings {
  const file = settingsFilePath()
  let text: string
  try {
    if (!fs.existsSync(file)) return structuredCloneOfDefaults()
    text = fs.readFileSync(file, 'utf-8')
  } catch (err) {
    console.warn(
      `[ai/settings] 读取 ${SETTINGS_FILE_NAME} 失败（errno=${String((err as NodeJS.ErrnoException).code ?? 'UNKNOWN')}），已回退默认设置`
    )
    return structuredCloneOfDefaults()
  }
  try {
    return coerceSettings(JSON.parse(text))
  } catch {
    console.warn(`[ai/settings] ${SETTINGS_FILE_NAME} 不是合法 JSON，已回退默认设置（文件内容未记录）`)
    return structuredCloneOfDefaults()
  }
}

function structuredCloneOfDefaults(): AiSettings {
  return { ...DEFAULT_SETTINGS, models: {} }
}

/** 完整设置 → 跨 IPC 唯一许可的掩码视图。明文 apiKey 在此被丢弃。 */
export function toSettingsView(s: AiSettings): AiSettingsView {
  return {
    protocol: s.protocol,
    baseUrl: s.baseUrl,
    hasKey: s.apiKey.length > 0,
    maskedKey: maskKey(s.apiKey),
    defaultModel: s.defaultModel,
    models: { ...s.models }
  }
}

/**
 * 合并保存：patch 语义见文件头。返回落盘后的掩码视图（调用方拿不到明文）。
 * 写盘失败抛 Error('AI_SETTINGS_WRITE_FAILED: …')——保存失败必须让 UI 知道。
 */
export function saveSettings(patch: AiSettingsPatch): AiSettingsView {
  const base = loadSettings()
  const p = (patch ?? {}) as Record<string, unknown>

  const merged: AiSettings = {
    protocol: VALID_PROTOCOLS.includes(p.protocol as AiProtocol)
      ? (p.protocol as AiProtocol)
      : base.protocol,
    baseUrl: isString(p.baseUrl) ? p.baseUrl : base.baseUrl,
    // 空串/缺省 = 保留旧密钥；非空串 = 整体替换
    apiKey: isString(p.apiKey) && p.apiKey !== '' ? p.apiKey : base.apiKey,
    defaultModel: isString(p.defaultModel) ? p.defaultModel : base.defaultModel,
    models: mergeModels(base.models, p.models)
  }

  const file = settingsFilePath()
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(merged, null, 2), 'utf-8')
  } catch (err) {
    // 只带 errno code，不带文件内容/密钥
    throw new Error(
      `AI_SETTINGS_WRITE_FAILED: 无法写入 AI 设置文件（errno=${String((err as NodeJS.ErrnoException).code ?? 'UNKNOWN')}）`
    )
  }
  return toSettingsView(merged)
}

function mergeModels(base: AiModels, raw: unknown): AiModels {
  if (raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...base }
  }
  const patchM = raw as Record<string, unknown>
  const out: AiModels = { ...base }
  for (const key of MODEL_KEYS) {
    if (isString(patchM[key])) {
      // 空串 = 清除该功能覆盖；非空 = 覆盖
      if (patchM[key] === '') delete out[key]
      else out[key] = patchM[key] as string
    }
    // 未给（undefined）→ 保留旧值
  }
  return out
}
