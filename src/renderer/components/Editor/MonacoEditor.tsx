import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
import type { editor } from 'monaco-editor'
import { useSettingsStore } from '../../stores'
import { countWords } from '@/common/wordCount'

// 动态导入 Monaco（避免 SSR 问题）
let monaco: typeof import('monaco-editor') | null = null

// 正文排印字体：思源宋体族优先（macOS Songti SC / Windows SimSun 兜底，西文 Georgia）
const SERIF_FONT_FAMILY = "'Noto Serif SC','Source Han Serif SC','Songti SC','SimSun',Georgia,serif"

// 行高随字号派生：1.9 倍留白，正文才有纸面呼吸感
function createLineHeight(fontSize: number): number {
  return Math.round(fontSize * 1.9)
}

// 写作主题配置
const novelDarkTheme = {
  base: 'vs-dark' as const,
  inherit: true,
  rules: [
    { token: '', foreground: 'd4d4d4' },
    // 兜底：取消 monospace 主题对文本 token 的粗体倾向，正文回到字重正常的宋体
    { token: 'text', fontStyle: 'normal' },
    { token: 'heading', foreground: '569cd6', fontStyle: 'bold' },
    { token: 'emphasis', fontStyle: 'italic' },
    { token: 'strong', fontStyle: 'bold' },
    { token: 'keyword', foreground: 'c586c0' },
    { token: 'string', foreground: 'ce9178' },
    { token: 'comment', foreground: '6a9955' }
  ],
  colors: {
    // editor.background 对齐 global.css --color-paper（dark #1f1e1c）
    'editor.background': '#1f1e1c',
    'editor.foreground': '#d4d4d4',
    // 暖纸底上的行高亮/选区改暖中性，保证与正文仍可区分
    'editor.lineHighlightBackground': '#282723',
    'editor.selectionBackground': '#3a4a5e',
    'editorCursor.foreground': '#e6e2d6',
    'editorLineNumber.foreground': '#858585',
    'editorLineNumber.activeForeground': '#c6c6c6',
    'editor.inactiveSelectionBackground': '#3a3d41',
    'editorIndentGuide.background': '#404040',
    'editorIndentGuide.activeBackground': '#707070',
    // 编辑器滚动条配色对齐 global.css 的 ::-webkit-scrollbar token（dark 档）：
    // Monaco 的 slider 颜色走 CSS 变量（--vscode-scrollbarSlider-*），只能经主题色注入——
    // 用样式表硬覆盖会撞上内联/变量层，被迫用强制声明（项目门禁禁止）
    'scrollbar.background': '#00000000',
    // slider 三档镜像 global.css webkit 滚动条 token（dark 档），monaco 只吃字面量色值——
    // 注释钉死对应关系，改 token 时同步这里，防两套观感漂移：
    'scrollbarSlider.background': '#424242',        // ↔ --color-scrollbar-thumb
    'scrollbarSlider.hoverBackground': '#6e6e6e',   // ↔ ::-webkit-scrollbar-thumb:hover 的 --color-text-tertiary
    'scrollbarSlider.activeBackground': '#8a8a8a'   // hover 档再亮一级（webkit 无 active 档，取同向梯度）
  }
}

const novelLightTheme = {
  base: 'vs' as const,
  inherit: true,
  rules: [
    { token: '', foreground: '141414' },
    { token: 'text', fontStyle: 'normal' },
    { token: 'heading', foreground: '1677ff', fontStyle: 'bold' },
    { token: 'emphasis', fontStyle: 'italic' },
    { token: 'strong', fontStyle: 'bold' },
    { token: 'keyword', foreground: 'c41d7f' },
    { token: 'string', foreground: '389e0d' },
    { token: 'comment', foreground: '8c8c8c' },
  ],
  colors: {
    // editor.background 对齐 global.css --color-paper（light #faf8f2）
    'editor.background': '#faf8f2',
    'editor.foreground': '#141414',
    // 纸底偏暖，高亮/选区同步微调避免灰白脱节
    'editor.lineHighlightBackground': '#f2eee3',
    'editor.selectionBackground': '#d6e4f0',
    'editorCursor.foreground': '#1677ff',
    'editorLineNumber.foreground': 'bfbfbf',
    'editorLineNumber.activeForeground': '595959',
    'editor.inactiveSelectionBackground': '#e6f4ff',
    'editorIndentGuide.background': '#f0f0f0',
    'editorIndentGuide.activeBackground': '#d9d9d9',
    // 编辑器滚动条配色对齐 global.css 的 ::-webkit-scrollbar token（light 档），同 dark 主题注释
    'scrollbar.background': '#00000000',
    'scrollbarSlider.background': '#c1c1c1',
    'scrollbarSlider.hoverBackground': '#8c8c8c',
    'scrollbarSlider.activeBackground': '#757575'
  },
}

interface MonacoEditorProps {
  value: string
  language?: string
  theme?: 'vs-dark' | 'vs-light' | 'novel-dark'
  onChange?: (value: string) => void
  onSave?: () => void
  readOnly?: boolean
  wordCount?: boolean
  focusMode?: boolean
  typewriterMode?: boolean
  fontSize?: number
  wordWrap?: boolean
  showLineNumbers?: boolean
  /** 可编辑排印列最大宽度（px），正文在此列内居中 */
  maxWidthPx?: number
  /**
   * ghost 存在时按 Tab（已拦截默认缩进）→ 采纳补全。无 ghost 时本回调不触发、Tab 行为原样。
   * （M5 Task 4 只提供键位表面，采纳语义由 Task 5 编排层实现。）
   */
  onAcceptGhost?: () => void
  /** ghost 存在时按 Esc（已拦截）→ 关闭 ghost。无 ghost 时 Esc 不受任何影响（命令面板等照常）。 */
  onDismissGhost?: () => void
  /** 编辑器内输入法 compositionstart 信号——Task 5 用它中止/抑制补全，防 IME 合成期串字。 */
  onCompositionStart?: () => void
  /**
   * 输入法 compositionend（上屏/取消组合窗）信号。Task 5 必须消费它来解禁 composing 闸门：
   * 状态机「compositionEnd 只解禁不复臂」，缺这条腿 composing 会永久为真——第一次用输入法
   * 之后补全就死了。与 onCompositionStart 成对出现不是冗余，是闸门的两半。
   */
  onCompositionEnd?: () => void
  /**
   * 光标位置变化信号（Task 5 消费）：suffixEmpty = 光标后是否已无正文（文末判定）。
   * 纯键入同样会触发本回调（光标前移），消费方自己按相位甄别（布防链以 contentChanged 为准）。
   */
  onCursorChange?: (suffixEmpty: boolean) => void
  /** 编辑器就绪信号（monaco 实例创建完成、ghost 装饰层可用）。Task 5 用它放行布防——
   *  异步创建窗口期句柄已在但 handle 全为空操作，此时起补全会装配出空上下文。 */
  onEditorReady?: () => void
  /** 焦点离开编辑器（focusout 且新焦点不在容器内）。Task 5 用它 dismiss：鬼影不该跨焦点存活。 */
  onEditorBlur?: () => void
}

export interface MonacoEditorHandle {
  revealLineInCenter: (lineNumber: number) => void
  /** 视图态快照（光标/滚动/选区，monaco saveViewState 原样透传；编辑器未就绪 → null）。 */
  saveViewState: () => unknown | null
  /**
   * 恢复视图态。monaco 是异步动态导入创建——组件刚挂载、编辑器尚未就绪时暂存到 pendingRef，
   * 创建完成即应用（同一提交内不丢光标；跨视图切换的恢复语义见 Workspace 裁定 3）。
   */
  restoreViewState: (viewState: unknown) => void
  /**
   * 在光标位设置/更新 ghost 灰字（M5 实时补全，Task 4）。流式追加就反复调本方法：
   * 单 decoration 复用、只改其内容，不动真实光标、不滚动、不重建编辑器。空串 = 清除。
   */
  setGhost: (text: string) => void
  /** 移除 ghost 灰字（幂等，无 ghost 时为空操作）。 */
  clearGhost: () => void
  /** 当前 ghost 文本，无 ghost 返回空串——Tab/Esc 键位判定的唯一依据。 */
  getGhost: () => string
  /**
   * 以光标切开的正文窗口：before/after 为全文两段、cursorOffset 为 UTF-16 偏移。
   * 码点安全切片由上层（Task 1/5）负责，这里只给裸偏移；编辑器未就绪 → 全空窗口。
   */
  getProseWindow: () => { before: string; after: string; cursorOffset: number }
  /** 在光标（或选区）处插入文本，executeEdits 保留 undo 栈；插入后光标落在插入文本之后。 */
  insertAtCursor: (text: string) => void
}

// Monaco Editor 容器组件
const MonacoEditor = forwardRef<MonacoEditorHandle, MonacoEditorProps>(function MonacoEditor({
  value,
  language = 'markdown',
  onChange,
  onSave,
  readOnly = false,
  wordCount = true,
  focusMode = false,
  typewriterMode = false,
  fontSize = 16,
  wordWrap = true,
  showLineNumbers = false,
  maxWidthPx = 760,
  onAcceptGhost,
  onDismissGhost,
  onCompositionStart,
  onCompositionEnd,
  onCursorChange,
  onEditorReady,
  onEditorBlur
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  // 未就绪期的恢复暂存（restoreViewState 的异步补丁通道；应用一次即清）
  const pendingViewStateRef = useRef<editor.ICodeEditorViewState | null>(null)
  // ghost 文本缓存（'' = 无 ghost）：Tab/Esc 键位判定与 getGhost 的唯一依据，与 decoration 同步维护
  const ghostTextRef = useRef('')
  // ghost 单元素装饰集合：随编辑器创建一次，流式更新只改这一条的内容（键位/滚动全程不动）
  const ghostDecorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  // 底部状态条字数（countWords 口径），从初始 value 起算，编辑/切章时更新
  const [currentWordCount, setCurrentWordCount] = useState(() => countWords(value))
  // 就绪/光标信号的「每渲染镜像 ref」：这两个回调在 deps-[] 的编辑器创建 effect 内被调用，
  // 直接引用 props 会吃挂载期闭包旧值——镜像后监听器恒读最新回调（Workspace saveRef 惯用法）。
  // （键位/IME 监听不吃镜像：键位 effect 本就随回调标识重挂，见下方。）
  const onCursorChangeRef = useRef(onCursorChange)
  onCursorChangeRef.current = onCursorChange
  const onEditorReadyRef = useRef(onEditorReady)
  onEditorReadyRef.current = onEditorReady
  const onEditorBlurRef = useRef(onEditorBlur)
  onEditorBlurRef.current = onEditorBlur
  const themeMode = useSettingsStore((s) => s.themeMode)

  useImperativeHandle(ref, () => ({
    revealLineInCenter: (lineNumber: number) => {
      editorRef.current?.revealLineInCenter(lineNumber)
    },
    saveViewState: () => editorRef.current?.saveViewState() ?? null,
    restoreViewState: (viewState: unknown) => {
      const vs = viewState as editor.ICodeEditorViewState
      if (editorRef.current) editorRef.current.restoreViewState(vs)
      else pendingViewStateRef.current = vs
    },
    setGhost: (text: string) => {
      // ghostText 先行更新：即便编辑器尚未就绪，键位判定（捕获层读 ghostTextRef）也与后续 decoration 一致
      ghostTextRef.current = text
      const instance = editorRef.current
      const collection = ghostDecorationsRef.current
      if (!instance || !collection) return
      if (!text) {
        collection.set([])
        return
      }
      const position = instance.getPosition()
      if (!position) {
        collection.set([])
        return
      }
      // 单 decoration 复用：对同一集合反复 set，monaco 原地 diff 更新 after 内容——
      // 真实光标与滚动位置全程不动、编辑器绝不重建（流式逐 token 调本方法的两个不变量）
      collection.set([{
        range: {
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: position.lineNumber,
          endColumn: position.column
        },
        options: {
          // 光标后置灰字，样式走 global.css .completion-ghost（token 色，双主题天然自适应）。
          // showIfCollapsed 必开（0.55.1 源码 textModel.js 实锤）：ghost 的锚定 range 是光标位
          // 零宽折叠区间，而 injected-text 装饰树的全部查询（getInjectedTextInInterval/
          // getAllInjectedText）都带 `.filter(i => i.options.showIfCollapsed || !i.range.isEmpty())`
          // ——不加此键，折叠 range 的 after 内容永远进不了 viewModel 投影，灰字整层不渲染。
          showIfCollapsed: true,
          after: { content: text, inlineClassName: 'completion-ghost' }
        }
      }])
    },
    clearGhost: () => {
      ghostTextRef.current = ''
      ghostDecorationsRef.current?.set([])
    },
    getGhost: () => ghostTextRef.current,
    getProseWindow: () => {
      const instance = editorRef.current
      const model = instance?.getModel()
      const position = instance?.getPosition()
      if (!model || !position) return { before: '', after: '', cursorOffset: 0 }
      const full = model.getValue()
      // 裸 UTF-16 偏移切片（码点安全由 Task 1/5 上层处理）：before/after 拼回恒等全文
      const cursorOffset = model.getOffsetAt(position)
      return {
        before: full.slice(0, cursorOffset),
        after: full.slice(cursorOffset),
        cursorOffset
      }
    },
    insertAtCursor: (text: string) => {
      const instance = editorRef.current
      if (!instance || !text) return
      const selection = instance.getSelection()
      if (!selection) return
      // T4 评审 carry-in (a)：原实现把 range 设为整个选区——「在光标插入」在选区非折叠时
      // 会把选中正文换成 ghost（吞字）且落点计算用 end* 端点，反向选区下算错。
      // ghost 采纳语义 = 在光标（选区活动端）插入、绝不动选中内容：先折叠到 getPosition()。
      const caret = selection.getPosition()
      const range = {
        startLineNumber: caret.lineNumber,
        startColumn: caret.column,
        endLineNumber: caret.lineNumber,
        endColumn: caret.column
      }
      // executeEdits 走 monaco 正常编辑管线：undo 栈保留（一次插入一条撤销记录）
      instance.executeEdits('m5-completion', [{
        range,
        text,
        forceMoveMarkers: true
      }])
      // executeEdits 的光标映射不保证落在插入文本之后，显式定位（补全采纳的直觉语义：光标到词尾）
      const lines = text.split('\n')
      const endLineNumber = lines.length === 1 ? caret.lineNumber : caret.lineNumber + lines.length - 1
      const endColumn = lines.length === 1 ? caret.column + lines[0].length : lines[lines.length - 1].length + 1
      const end = { lineNumber: endLineNumber, column: endColumn }
      instance.setPosition(end)
      // M5 T6 冒烟实证缺陷：视口底部采纳较长 ghost（≥一行换行增量）后，executeEdits/setPosition
      // 都不触发滚动——光标连同下一发自动再布的 ghost 装饰落在视口外，monaco 虚拟渲染直接不画
      // （用户视角=「采纳后再也不弹」）。采纳即所见：仅在-outsider 时 reveal，绝不抢已有焦点视图的滚动。
      instance.revealPositionInCenterIfOutsideViewport(end)
    }
  }), [])

  // 打字机模式：保持光标在屏幕中央
  const centerCursorInTypewriterMode = useCallback(() => {
    if (!editorRef.current) return
    const position = editorRef.current.getPosition()
    if (!position) return
    editorRef.current.revealLineInCenter(position.lineNumber)
  }, [])

  // 监听光标位置变化（打字机模式）
  useEffect(() => {
    if (!editorRef.current || !monaco) return

    const editor = editorRef.current

    if (typewriterMode) {
      // 首次居中
      centerCursorInTypewriterMode()

      // 监听光标位置变化
      const disposable = editor.onDidChangeCursorPosition(() => {
        centerCursorInTypewriterMode()
      })

      return () => {
        disposable.dispose()
      }
    }
  }, [typewriterMode, centerCursorInTypewriterMode])

  useEffect(() => {
    let mounted = true

    const initMonaco = async () => {
      try {
        // 动态导入 Monaco
        monaco = await import('monaco-editor')

        if (!mounted || !containerRef.current) return

        // 注册写作主题
        monaco.editor.defineTheme('novel-dark', novelDarkTheme)
        monaco.editor.defineTheme('novel-light', novelLightTheme)

        // 创建编辑器
        const editor = monaco.editor.create(containerRef.current, {
          value,
          language,
          theme: themeMode === 'light' ? 'novel-light' : 'novel-dark',
          fontSize,
          fontFamily: SERIF_FONT_FAMILY,
          lineHeight: createLineHeight(fontSize),
          wordWrap: wordWrap ? 'on' : 'off',
          minimap: { enabled: false },
          lineNumbers: showLineNumbers ? 'on' : 'off',
          folding: false,
          lineDecorationsWidth: 0,
          lineNumbersMinChars: 0,
          renderLineHighlight: 'none',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          cursorStyle: 'line',
          cursorBlinking: typewriterMode ? 'solid' : 'smooth',
          cursorSmoothCaretAnimation: typewriterMode ? 'off' : 'on',
          smoothScrolling: !typewriterMode,
          contextmenu: !focusMode,
          bracketPairColorization: { enabled: false },
          guides: {
            bracketPairs: false,
            indentation: false
          },
          renderWhitespace: 'none',
          // unicode 高亮口径（UI 验收批次 #3 / R1-I1 → 结转微批 #4 收窄为以下两键）：
          // - nonBasicASCII + ambiguousCharacters = 中文正文全角字符误报（黄框被当成异常光标），
          //   关；黄框 artifact 由这两档全局消除，与 token 作用域开关无关。
          // - invisibleCharacters 保持默认开启：零宽空格/控制符是粘贴进稿件的真实隐患，
          //   与普通全角标点不相交——这一档要留。
          // - includeComments/includeStrings 两键已删（核对 monaco 0.55.1 源码
          //   unicodeHighlighter.js：getDecoration(!includeComments, !includeStrings) 会把注释/
          //   字符串 token 作用域豁免**全部**档位的告警、含 invisibleCharacters——旧 false 曾让
          //   markdown 的 ```/~~~ 围栏、四空格代码块、链接目标等 string 作用域成零宽字符盲区）。
          //   删键后 includeStrings 恢复默认 true，字符串盲区闭合；注意 includeComments 的默认值
          //   是 inUntrustedWorkspace 哨兵、standalone 恒 trusted 下解析为 false（HTML 注释/
          //   引用标记等注释作用域仍豁免）。M4c-2 裁定的「显式 includeComments: true」本批
          //   （M5 Task 4 carry-in）落地：注释域零宽字符盲区就此闭合；ambiguous/nonBasic 维持
          //   false 不动，CJK 黄框不回退。
          unicodeHighlight: {
            nonBasicASCII: false,
            ambiguousCharacters: false,
            includeComments: true
          },
          // 滚动条对齐应用观感（UI 验收批次 #4）：悬停/滚动才出现、更细、无阴影箭头
          scrollbar: {
            vertical: 'auto',
            horizontal: 'hidden',
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 0,
            useShadows: false,
            verticalHasArrows: false,
            horizontalHasArrows: false
          },
          readOnly
        })

        editorRef.current = editor

        // ghost 单元素装饰集合随编辑器创建一次（M5 Task 4）：此后 setGhost/clearGhost 只更新这一条
        ghostDecorationsRef.current = editor.createDecorationsCollection([])

        // 跨视图切换的延迟恢复：挂载完成前 restoreViewState 暂存的视图态，创建即应用（一次即清）
        if (pendingViewStateRef.current) {
          editor.restoreViewState(pendingViewStateRef.current)
          pendingViewStateRef.current = null
        }

        // 快捷键：保存
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
          onSave?.()
        })

        // 快捷键：粗体
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyB, () => {
          const model = editor.getModel()
          if (model) {
            const selection = editor.getSelection()
            if (selection && !selection.isEmpty()) {
              const selectedText = model.getValueInRange(selection)
              editor.executeEdits('', [{
                range: selection,
                text: `**${selectedText}**`,
                forceMoveMarkers: true
              }])
            }
          }
        })

        // 快捷键：斜体
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyI, () => {
          const model = editor.getModel()
          if (model) {
            const selection = editor.getSelection()
            if (selection && !selection.isEmpty()) {
              const selectedText = model.getValueInRange(selection)
              editor.executeEdits('', [{
                range: selection,
                text: `*${selectedText}*`,
                forceMoveMarkers: true
              }])
            }
          }
        })

        // 监听内容变化
        editor.onDidChangeModelContent(() => {
          const newValue = editor.getValue()
          onChange?.(newValue)
          setCurrentWordCount(countWords(newValue))
        })

        // 光标位置变化 → Task 5 的 cursorMoved 信号（M5 Task 5 接线）：
        // suffixEmpty = 文末判定（光标后无任何正文才可出 ghost——修订态拦截在状态机一侧，
        // 这里只提供事实）。恒经镜像 ref 调用：本 effect deps 为 []，直引 props 会吃挂载期旧闭包。
        editor.onDidChangeCursorPosition((e) => {
          const model = editor.getModel()
          if (!model) return
          const offset = model.getOffsetAt(e.position)
          onCursorChangeRef.current?.(offset >= model.getValueLength())
        })

        setIsLoading(false)
        // 就绪信号最后发：ghost 装饰集合/监听器都已就位，Task 5 从此刻起才允许布防
        // （carry-in (c)：未就绪窗口不起补全）。
        onEditorReadyRef.current?.()
      } catch (error) {
        console.error('Failed to load Monaco:', error)
      }
    }

    initMonaco()

    return () => {
      mounted = false
      if (editorRef.current) {
        editorRef.current.dispose()
      }
      // 装饰集合随编辑器同归（monaco 在 editor.dispose 里销毁），这里只掐引用防悬挂
      ghostDecorationsRef.current = null
      ghostTextRef.current = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 编辑器仅挂载时初始化一次
  }, [])

  // 更新内容
  useEffect(() => {
    if (editorRef.current && value !== editorRef.current.getValue()) {
      editorRef.current.setValue(value)
    }
  }, [value])

  // 更新语言
  useEffect(() => {
    if (editorRef.current && monaco) {
      const model = editorRef.current.getModel()
      if (model) {
        monaco.editor.setModelLanguage(model, language)
      }
    }
  }, [language])

  // 合并的选项更新 effect：readOnly / 专注 / 打字机 / 字号（含派生行高）/ 换行 / 行号
  // 一次 updateOptions 覆盖原先 6 个各自为政的 effect；lineHeight 必须随 fontSize 联动，故同批派生
  useEffect(() => {
    if (!editorRef.current) return
    editorRef.current.updateOptions({
      readOnly,
      contextmenu: !focusMode,
      renderWhitespace: 'none',
      cursorBlinking: typewriterMode ? 'solid' : 'smooth',
      cursorSmoothCaretAnimation: typewriterMode ? 'off' : 'on',
      smoothScrolling: !typewriterMode,
      fontSize,
      lineHeight: createLineHeight(fontSize),
      wordWrap: wordWrap ? 'on' : 'off',
      lineNumbers: showLineNumbers ? 'on' : 'off'
    })
  }, [readOnly, focusMode, typewriterMode, fontSize, wordWrap, showLineNumbers])

  // 跟随全局主题切换编辑器主题
  useEffect(() => {
    if (monaco) {
      monaco.editor.setTheme(themeMode === 'light' ? 'novel-light' : 'novel-dark')
    }
  }, [themeMode])

  // ghost 键位 + IME 信号（M5 Task 4；消费方为 Task 5 编排层）：
  // - keydown 挂容器**捕获相**——monaco 的键位分发（StandaloneKeybindingService）监听同一容器的
  //   冒泡相，捕获相 stopPropagation 即让它完整收不到 Tab/Esc，比 addCommand 更干净：addCommand
  //   注册即顶掉内置 Tab，无 ghost 时反而要手工复现默认缩进。无 ghost 一律放行（缩进、命令面板
  //   的 Esc 等全局行为原样保留，绝不吞键）。
  // - Tab/Esc 只回调不清理 ghost：去留是编排层的职责（采纳要插字、关闭要冷却）。
  // - compositionstart 冒泡至容器即上报：输入法开合成窗时 Task 5 中止/抑制补全，防合成串字。
  // 依赖含三个回调：props 换引用即重挂监听，捕获层始终读到最新回调（不吃挂载期闭包旧值）。
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!ghostTextRef.current) return
      // T4 评审 carry-in (b)：只接管裸键——Shift+Tab（反向缩进）、Ctrl/Cmd 组合、Alt/AltGr
      // 输入等一律放行（行业 ghost 约定只绑裸 Tab/Esc，吞掉组合键是回归事故源）。
      // 放行时不 preventDefault/stopPropagation，monaco 键位分发与全局快捷键照常。
      if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return
      if (event.key === 'Tab') {
        event.preventDefault()
        event.stopPropagation()
        onAcceptGhost?.()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onDismissGhost?.()
      }
    }
    const handleCompositionStart = () => {
      onCompositionStart?.()
    }
    // compositionend（上屏/取消）与 start 成对：Task 5 的状态机 composing 闸门必须有解禁腿
    const handleCompositionEnd = () => {
      onCompositionEnd?.()
    }
    // focusout 冒泡到容器即「焦点离开编辑器」候选；monaco 内部节点间转焦（textarea↔滚动条）
    // 不算离开——relatedTarget 仍在容器内就放行，否则打字中途都会误 dismiss。
    const handleFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget
      if (next instanceof Node && el.contains(next)) return
      onEditorBlurRef.current?.()
    }
    el.addEventListener('keydown', handleKeyDown, true)
    el.addEventListener('compositionstart', handleCompositionStart)
    el.addEventListener('compositionend', handleCompositionEnd)
    el.addEventListener('focusout', handleFocusOut)
    return () => {
      el.removeEventListener('keydown', handleKeyDown, true)
      el.removeEventListener('compositionstart', handleCompositionStart)
      el.removeEventListener('compositionend', handleCompositionEnd)
      el.removeEventListener('focusout', handleFocusOut)
    }
  }, [onAcceptGhost, onDismissGhost, onCompositionStart, onCompositionEnd])

  return (
    <div className="editor-shell" style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--color-paper)' }}>
      {/* 排印容器：可编辑列居中、两侧留纸面空白，正文像一页纸 */}
      <div
        ref={containerRef}
        className="editor-print-column"
        // width:100% 必须显式给出：flex column 子项上的 margin:'0 auto'（交叉轴 auto 边距）
        // 会禁用默认 align-items:stretch，宽度退化为 fit-content——而 Monaco 内部 DOM 全部
        // 绝对定位，in-flow 内容为零 → 容器塌缩成几 px（真机 bug：编辑器隐身、无法聚焦输入）。
        // 显式 100% → 按 shell 宽度解析，maxWidth 截断到排印列宽，auto 边距再将其居中。
        style={{ height: '100%', width: '100%', minHeight: 0, flex: 1, maxWidth: maxWidthPx, margin: '0 auto' }}
      />
      {isLoading && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--color-paper)',
          color: 'var(--color-text-secondary)'
        }}>
          加载编辑器...
        </div>
      )}
      {wordCount && (
        <div
          className="editor-status-bar"
          style={{
            height: 24,
            lineHeight: '24px',
            padding: '0 var(--space-4)',
            background: 'var(--color-bg-elevated)',
            borderTop: '1px solid var(--color-border)',
            color: 'var(--color-text-tertiary)',
            fontSize: 'var(--font-xs)',
            textAlign: 'right',
            letterSpacing: '0.02em',
            flexShrink: 0
          }}
        >
          字数 {currentWordCount.toLocaleString()}
        </div>
      )}
    </div>
  )
})

export default MonacoEditor
