// 中文正确的字数统计口径（主进程与渲染层共用）。
// 规则：先剥离 markdown 语法字符，再统计
//   总字数 = CJK 汉字个数（每个计 1） + 连续拉丁字母/数字串个数（[A-Za-z0-9]+，每串计 1）。
// 中英文标点、空白一律不计；空串/纯空白返回 0。
// 定案示例：countWords('第123章') === 3（第、章各 1，123 连续数字串计 1）。

// markdown 语法字符：# * ` > ~ _ [ ] ( )
const MARKDOWN_SYNTAX_RE = /[#*`>~_[\]()]/g
// CJK 汉字：扩展 A（㐀-䶿）、基本区（一-鿿）、兼容表意文字（豈-﫿）
const CJK_CHAR_RE = /[㐀-䶿一-鿿豈-﫿]/g
// 连续拉丁字母/数字串（大小写与数字同串合并计 1）
const LATIN_RUN_RE = /[A-Za-z0-9]+/g

export function countWords(text: string): number {
  if (!text) return 0
  const stripped = text.replace(MARKDOWN_SYNTAX_RE, '')
  const cjkCount = stripped.match(CJK_CHAR_RE)?.length ?? 0
  const latinRunCount = stripped.match(LATIN_RUN_RE)?.length ?? 0
  return cjkCount + latinRunCount
}
