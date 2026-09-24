/**
 * CAD 外部协同连接器 (Connector) 通信协议与数据契约定义 (JSON-RPC 2.0 / WebSocket)
 * 遵循 PRD-003 与 PRD-CONNECTORS-001 规范
 */

export type CadSoftwareType = 'SOLIDWORKS' | 'CREO' | 'NX' | 'INVENTOR' | 'CATIA' | 'AUTOCAD'

// ==========================================
// JSON-RPC 2.0 基础协议定义
// ==========================================

export interface JsonRpcRequest<T = unknown> {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: T
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0'
  id: string | number
  result?: T
  error?: JsonRpcError
}

export interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

export interface JsonRpcNotification<T = unknown> {
  jsonrpc: '2.0'
  method: string
  params?: T
}

// ==========================================
// 核心业务报文参数契约
// ==========================================

export interface CadActiveDocSummary {
  docGuid: string
  docPath: string
  hasSureFlowData: boolean
}

/** 握手注册 CLIENT_HELLO */
export interface ClientHelloParams {
  cadType: CadSoftwareType
  cadVersion: string
  pluginVersion: string
  pid: number
  activeDocuments?: CadActiveDocSummary[]
}

export interface ClientHelloResult {
  status: 'ACCEPTED' | 'REJECTED'
  serverVersion: string
  supportedFormats: string[]
}

/** 新建阀块 DOC_NEW_PROJECT */
export interface DocNewProjectParams {
  cadType: CadSoftwareType
  pid: number
  docGuid: string
  docName?: string
  docPath?: string
  /** 可选：当从已有的 SolidWorks IBody2 实体导出作为基体时，传入 STEP AP214 文本 */
  stepContent?: string
  /** 可选：STEP AP214 二进制数据的 Base64 编码 */
  stepBase64?: string
  /** 可选：基体实体名称 */
  baseBodyName?: string
  /** 是否使用选中的已有实体作为基体 (若为 true 则 SureFlow 端基体只读不可修改) */
  isCustomBaseBody?: boolean
}

export interface DocNewProjectResult {
  projectId: string
  status: 'OPENED' | 'ALREADY_EXISTS'
}

/** 打开/恢复已有阀块 DOC_OPEN_PROJECT */
export interface DocOpenProjectParams {
  cadType: CadSoftwareType
  pid: number
  docGuid: string
  docName?: string
  docPath?: string
  /** .sfb 完整二进制压缩流 Base64 编码 */
  sfbBase64: string
}

export interface DocOpenProjectResult {
  projectId: string
  status: 'RESTORED' | 'FOCUSED'
}

/** 激活已有设计 DOC_ACTIVATE_PROJECT */
export interface DocActivateProjectParams {
  cadType: CadSoftwareType
  pid: number
  docGuid: string
  docName?: string
  projectId?: string
}

export interface DocActivateProjectResult {
  projectId?: string
  status: 'FOCUSED' | 'NOT_FOUND'
}

/** 保存并同步实体至 CAD DOC_SAVE_PROJECT */
export interface DocSaveProjectParams {
  docGuid: string
  /** .sfb 完整二进制压缩流 Base64 编码 */
  sfbBase64: string
  /** 实体几何体 */
  geometry: {
    format: 'STEP_AP214' | 'STEP_AP242' | 'PARASOLID_X_T'
    dataBase64: string
  }
  /** 项目统计信息 */
  statistics?: {
    cavityCount: number
    channelCount: number
    blockDimensions?: [number, number, number]
  }
}

export interface DocSaveProjectResult {
  success: boolean
  featuresUpdated?: string[]
  elapsedMs?: number
  message?: string
}

/** 摄像机视角同步参数 SYNC_CAMERA_VIEW */
export interface SyncCameraViewParams {
  docGuid?: string
  projectId?: string
  position: [number, number, number]
  target: [number, number, number]
  up: [number, number, number]
  zoom?: number
  viewHeight?: number
  projectionType?: 'ORTHOGRAPHIC' | 'PERSPECTIVE'
  rotationMatrix?: number[]
}

export interface SyncCameraViewResult {
  success: boolean
  message?: string
}

/** CAD 宿主主动断开连接事件 CAD_DISCONNECTED */
export interface CadDisconnectedEvent {
  cadType: CadSoftwareType
  pid: number
  docGuid?: string
  reason: 'HEARTBEAT_TIMEOUT' | 'SOCKET_CLOSED' | 'PROCESS_TERMINATED' | 'USER_DISCONNECTED'
  timestamp: number
}

/** 会话绑定状态 (在前端 store 中维护) */
export interface CadIntegrationSession {
  cadType: CadSoftwareType
  processId: number
  docGuid: string
  docName?: string
  docPath?: string
  isDirtyInCad?: boolean
  isCustomBaseBody?: boolean
  baseBodyName?: string
  connectionStatus: 'CONNECTED' | 'DISCONNECTED'
}

// ==========================================
// 兼容旧版 STEP 导入导出契约
// ==========================================

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
  projectId?: string
  docGuid?: string
  stepContent?: string
  stepBase64?: string
  stepFilePath?: string
  stepFileName?: string
  /** 外部 CAD 软件类型，遵循统一的 CadSoftwareType 契约规范 */
  cadType?: CadSoftwareType
  autoFitView?: boolean
}

export interface CadExportStepParams {
  projectId?: string
  targetFilePath?: string
  includeCavities?: boolean
}

export interface CadBridgeStatus {
  connected: boolean
  port: number
  activeProjects: number
  activeProjectId?: string | null
  currentCadType?: CadSoftwareType
  connectedClientsCount?: number
}

export interface CadBridgeResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
}

// ==========================================
// 插件市场与分发管理契约
// ==========================================

export interface ConnectorItem {
  id: string
  name: string
  cadType: CadSoftwareType
  vendor: string
  icon: string
  description: string
  supportedCadVersions: string[]
  platform: 'win32-x64'
  latestVersion: string
  releaseDate: string
  packageUrl: string
  sha256?: string
  sizeBytes?: number
  changelog: string[]
  status: 'RELEASED' | 'BETA' | 'COMING_SOON'
  isInstalledLocally?: boolean
  installedVersion?: string
  detectedCadVersion?: string
}

export interface ConnectorRegistry {
  $schema?: string
  version: number
  lastUpdated: string
  connectors: ConnectorItem[]
}

export interface DetectedCadSoftware {
  id: string
  cadType: CadSoftwareType | string
  name: string
  version?: string
  installed: boolean
  installLocation?: string
  connectorSupported?: boolean
  connectorInstalled?: boolean
}

export interface CadDetectionResponse {
  detectedMap: Record<string, { installed: boolean; version?: string; connectorInstalled?: boolean }>
  installedList: DetectedCadSoftware[]
}
