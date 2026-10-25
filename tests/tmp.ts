// 测试专用：为「一本书」建独立临时目录，afterAll 统一递归清理。
// docStore.test.ts 与 format.test.ts 共用（vitest 每个测试文件独立模块图，互不污染）。
import { afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const createdDirs: string[] = []

/** 新建一个临时书目录，返回绝对路径；测试文件结束自动删除。 */
export function mkTmpBook(): string {
  const dir = mkdtempSync(join(tmpdir(), 'perfect-novel-book-'))
  createdDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})
