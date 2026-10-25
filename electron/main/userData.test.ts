import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { migrateUserData } from './userData'

describe('migrateUserData (novel-writer -> perfect-novel, marker + merge-copy)', () => {
  let root: string
  let oldDir: string
  let newDir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'perfect-novel-mig-'))
    oldDir = join(root, 'novel-writer')
    newDir = join(root, 'perfect-novel')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('newDir 不存在：递归搬运旧内容，返回 migrated，写 .migrated 标记，旧目录保留', () => {
    mkdirSync(join(oldDir, 'sub'), { recursive: true })
    writeFileSync(join(oldDir, 'theme.json'), '{"mode":"dark"}')
    writeFileSync(join(oldDir, 'sub', 'window-state.json'), '{"x":10,"y":20}')

    const result = migrateUserData(oldDir, newDir)

    expect(result).toBe('migrated')
    expect(readFileSync(join(newDir, 'theme.json'), 'utf8')).toBe('{"mode":"dark"}')
    expect(readFileSync(join(newDir, 'sub', 'window-state.json'), 'utf8')).toBe('{"x":10,"y":20}')
    // 搬运而非搬家：oldDir 不删除
    expect(existsSync(join(oldDir, 'theme.json'))).toBe(true)
    // 成功：标记文件写入，内容为可解析的 ISO 时间戳
    const marker = readFileSync(join(newDir, '.migrated'), 'utf8')
    expect(Number.isNaN(Date.parse(marker))).toBe(false)
  })

  it('.migrated 标记已存在：返回 skipped，不做任何搬运（幂等，重启不重复迁移）', () => {
    mkdirSync(oldDir, { recursive: true })
    mkdirSync(newDir, { recursive: true })
    writeFileSync(join(newDir, '.migrated'), '2026-10-25T00:00:00.000Z')
    writeFileSync(join(oldDir, 'theme.json'), '{"mode":"dark"}')

    const result = migrateUserData(oldDir, newDir)

    expect(result).toBe('skipped')
    expect(existsSync(join(newDir, 'theme.json'))).toBe(false)
  })

  it('newDir 被 Chromium 预建（Local State）：合并搬运全部旧数据，绝不覆盖已有文件，返回 migrated', () => {
    // 真实事故场景：whenReady 前 Chromium 已预建 newDir 并写入 Local State；
    // 旧用户数据（theme.json、窗口几何、Local Storage 里的 zustand 持久化）必须全部合并进来。
    mkdirSync(join(oldDir, 'Local Storage'), { recursive: true })
    writeFileSync(join(oldDir, 'theme.json'), '{"mode":"dark"}')
    writeFileSync(join(oldDir, 'Local Storage', 'data'), 'persisted-store')
    mkdirSync(newDir, { recursive: true })
    writeFileSync(join(newDir, 'Local State'), 'CHROMIUM-SENTINEL-KEEP-ME')

    const result = migrateUserData(oldDir, newDir)

    expect(result).toBe('migrated')
    expect(readFileSync(join(newDir, 'theme.json'), 'utf8')).toBe('{"mode":"dark"}')
    expect(readFileSync(join(newDir, 'Local Storage', 'data'), 'utf8')).toBe('persisted-store')
    // Chromium 预写文件原样保留
    expect(readFileSync(join(newDir, 'Local State'), 'utf8')).toBe('CHROMIUM-SENTINEL-KEEP-ME')
    expect(existsSync(join(newDir, '.migrated'))).toBe(true)
    // 旧目录保留
    expect(existsSync(join(oldDir, 'theme.json'))).toBe(true)
  })

  it('newDir 已存在同名文件（无标记）：该条目跳过不覆盖，其余条目合并进来，返回 migrated', () => {
    mkdirSync(join(oldDir, 'sub'), { recursive: true })
    mkdirSync(newDir, { recursive: true })
    writeFileSync(join(oldDir, 'theme.json'), '{"mode":"dark"}')
    writeFileSync(join(oldDir, 'sub', 'window-state.json'), '{"x":10,"y":20}')
    writeFileSync(join(newDir, 'theme.json'), 'SENTINEL-KEEP-ME')

    const result = migrateUserData(oldDir, newDir)

    expect(result).toBe('migrated')
    // 同名条目：原文件内容保持，未被旧数据覆盖
    expect(readFileSync(join(newDir, 'theme.json'), 'utf8')).toBe('SENTINEL-KEEP-ME')
    // 其余条目：合并复制
    expect(readFileSync(join(newDir, 'sub', 'window-state.json'), 'utf8')).toBe('{"x":10,"y":20}')
    expect(existsSync(join(newDir, '.migrated'))).toBe(true)
  })

  it('oldDir 不存在：返回 skipped，不创建 newDir', () => {
    const result = migrateUserData(oldDir, newDir)

    expect(result).toBe('skipped')
    expect(existsSync(newDir)).toBe(false)
  })

  it('复制过程抛异常：返回 skipped 且不写标记（下次启动以合并语义重试）', () => {
    // 触发方式：旧目录里 'theme.json' 是目录（内含待复制文件）、新目录里同名条目是文件
    // → 复制子文件时目标父路径不是目录，copyFileSync 抛错，迁移中断。
    mkdirSync(join(oldDir, 'theme.json'), { recursive: true })
    writeFileSync(join(oldDir, 'theme.json', 'inner.txt'), 'nested')
    writeFileSync(join(oldDir, 'window-state.json'), '{"x":10}')
    mkdirSync(newDir, { recursive: true })
    writeFileSync(join(newDir, 'theme.json'), 'I-am-a-file')

    const result = migrateUserData(oldDir, newDir)

    expect(result).toBe('skipped')
    expect(existsSync(join(newDir, '.migrated'))).toBe(false)
  })
})
