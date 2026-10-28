// book:* 书内 AI 派生数据 IPC 层（M4b Task 4）：单通道薄委托到 bookStore/aiData，
// 本文件零文件系统直操（对齐 proposal/narrative 纪律）。参数走 {projectPath} 对象形状
// （M4b 新通道组纪律）。容错全在仓库层（缺→空、坏→warn+skip），通道不做二次判断。
import { ipcMain } from 'electron'
import type { AiDataSnapshot } from '../../../../src/common/ipc'
import { readAiData } from '../../bookStore/aiData'

export function registerBookDataHandlers(): void {
  ipcMain.handle(
    'book:readAiData',
    (_e, params: { projectPath: string }): AiDataSnapshot => readAiData(params.projectPath)
  )
}
