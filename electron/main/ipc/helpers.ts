// IPC 模块共用的跨域小函数

// 格式化文件路径
export function formatFilePath(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}
