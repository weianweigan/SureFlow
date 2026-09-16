export interface UpdateState {
  status: 'manual' | 'disabled' | 'idle' | 'up-to-date' | 'checking' | 'downloading' | 'ready' | 'error'
  manualUpdate?: boolean
  currentVersion: string
  version?: string
  percent?: number
  transferred?: number
  total?: number
  bytesPerSecond?: number
  releaseNotes?: string
  error?: string
}
