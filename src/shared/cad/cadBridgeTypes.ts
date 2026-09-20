/**
 * CAD 外部软件（SolidWorks, Inventor, Creo 等）通过 Socket / IPC 联动的通信协议定义
 * 支持：
 * 1. 自动引入外部 CAD 生成的 STEP 基体模型
 * 2. 导出当前阀块的 STEP 实体模型
 * 3. 实时状态查询与双向联动心跳
 */

export type CadCommandType =
  | 'PING'
  | 'GET_STATUS'
  | 'IMPORT_STEP'
  | 'EXPORT_STEP'

export interface CadSocketMessage<T = unknown> {
  id?: string
  type: CadCommandType
  payload?: T
  timestamp?: number
}

export interface CadImportStepParams {
  /** 目标工程 ID，缺省则作用于当前激活工程或自动新建工程 */
  projectId?: string
  /** STEP 文本内容（UTF-8） */
  stepContent?: string
  /** STEP 二进制或 Base64 编码数据 */
  stepBase64?: string
  /** 外部 CAD 软件导出的 STEP 物理绝对路径 */
  stepFilePath?: string
  /** 文件名标识 (如 'manifold_body.step') */
  stepFileName?: string
  /** 外部 CAD 软件标识 */
  cadSoftware?: 'solidworks' | 'inventor' | 'creo' | 'nx' | 'catia' | 'generic'
  /** 是否在导入后自动重置相机视角（居中适配） */
  autoFitView?: boolean
}

export interface CadExportStepParams {
  /** 导出的工程 ID，缺省则导出当前激活工程 */
  projectId?: string
  /** 目标保存物理路径，若为空则返回 stepContent 供外部接收 */
  targetFilePath?: string
  /** 是否包含布尔切削后的所有孔腔（true 为最终成型体，false 仅为外形基体） */
  includeCavities?: boolean
}

export interface CadBridgeStatus {
  connected: boolean
  port: number
  activeProjects: number
  activeProjectId?: string | null
  currentCadSoftware?: string
}

export interface CadBridgeResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
}
