// 主进程书籍错误前缀 → 用户可读文案（Task 10-E v2 词表清扫）。
// 唯一真源：ProjectDialog（create/open 失败弹窗）与 Workspace（最近项目补开失败 toast）共用，
// 避免两条 open 路径（A-seam 统一后）各自维护一份会漂移的翻译表。
// 匹配用 includes：IPC 拒绝会被 electron 包一层「Error invoking remote method …」前缀，
// 裸 startsWith 在渲染层不可靠；这三枚令牌串本身足够独特，误撞概率可忽略。

export interface BookErrorCopy {
  title: string
  content: string
}

export function describeBookError(raw: string): BookErrorCopy {
  if (raw.includes('BOOK_EXISTS')) {
    return {
      title: '该位置已存在一本书',
      content: '目标文件夹里已经有一本书（检测到 book.json），应用不会覆盖它。请更换项目名称或选择其他位置。'
    }
  }
  if (raw.includes('CORRUPT_BOOK')) {
    return {
      title: '书籍数据已损坏',
      content: '书籍数据已损坏，应用未做任何修改。请从书目录内的 .migration-backup 或其他备份恢复后重试。'
    }
  }
  if (raw.includes('INVALID_PROJECT')) {
    return {
      title: '无效的项目文件夹',
      content:
        '该文件夹不是有效的完美小说书籍目录：未找到 book.json（新版）或 .novelwriter.json（旧版，打开时自动升级）。请选择本项目创建的书籍文件夹。'
    }
  }
  return { title: '操作失败', content: raw }
}
