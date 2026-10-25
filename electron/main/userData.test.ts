import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { migrateUserData } from './userData'

describe('migrateUserData (novel-writer -> perfect-novel)', () => {
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

  it('newDir 不存在：递归搬运旧内容，返回 migrated，旧目录保留', () => {
    mkdirSync(join(oldDir, 'sub'), { recursive: true })
    writeFileSync(join(oldDir, 'theme.json'), '{"mode":"dark"}')
    writeFileSync(join(oldDir, 'sub', 'window-state.json'), '{"x":10,"y":20}')

    const result = migrateUserData(oldDir, newDir)

    expect(result).toBe('migrated')
    expect(readFileSync(join(newDir, 'theme.json'), 'utf8')).toBe('{"mode":"dark"}')
    expect(readFileSync(join(newDir, 'sub', 'window-state.json'), 'utf8')).toBe('{"x":10,"y":20}')
    // 搬运而非搬家：oldDir 不删除
    expect(existsSync(join(oldDir, 'theme.json'))).toBe(true)
  })

  it('newDir 已存在：返回 skipped，且绝不覆盖 newDir 内已有文件', () => {
    mkdirSync(oldDir, { recursive: true })
    mkdirSync(newDir, { recursive: true })
    writeFileSync(join(oldDir, 'theme.json'), '{"mode":"dark"}')
    writeFileSync(join(newDir, 'theme.json'), 'SENTINEL-KEEP-ME')

    const result = migrateUserData(oldDir, newDir)

    expect(result).toBe('skipped')
    // 原文件内容保持，未被旧数据覆盖
    expect(readFileSync(join(newDir, 'theme.json'), 'utf8')).toBe('SENTINEL-KEEP-ME')
    // 整体跳过：不做逐文件合并
    expect(existsSync(join(newDir, 'window-state.json'))).toBe(false)
  })

  it('oldDir 不存在：返回 skipped，不创建 newDir', () => {
    const result = migrateUserData(oldDir, newDir)

    expect(result).toBe('skipped')
    expect(existsSync(newDir)).toBe(false)
  })
})
