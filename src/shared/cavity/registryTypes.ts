/**
 * 在线孔腔库分发与包管理器类型定义（PRD-FR-03-02）
 */

export interface RegistryPackageVersion {
  releaseDate: string
  changelog: string
  downloadUrl: string
  fileSize: number
  sha256: string
}

export interface RegistryPackage {
  id: string
  name: string
  latestVersion: string
  description: string
  category: string
  author: string
  license?: string
  tags: string[]
  templateCount: number
  iconUrl?: string
  minAppVersion?: string
  versions: Record<string, RegistryPackageVersion>
}

export interface RegistryIndex {
  schemaVersion: number
  generatedAt: string
  baseUrl: string
  packages: RegistryPackage[]
}

export type OnlinePackageStatus = 'not-installed' | 'updatable' | 'up-to-date'

export interface OnlinePackageItem {
  pkg: RegistryPackage
  status: OnlinePackageStatus
  localVersion?: string
  localDirPath?: string
}

export type InstallStep = 'downloading' | 'verifying' | 'extracting' | 'completed' | 'failed'

export interface InstallProgressEvent {
  packageId: string
  version: string
  step: InstallStep
  percent: number
  transferredBytes: number
  totalBytes: number
  speedText?: string
  error?: string
}

export interface PackageSourceInfo {
  packageId: string
  installedVersion: string
  registryUrl: string
  installedAt: string
  sha256: string
}
