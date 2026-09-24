import type { CadIntegrationSession } from './cadBridgeTypes'

export interface CadBoundProject {
  cadIntegration?: CadIntegrationSession
}

/** Stable CAD identity lookup used by NEW/OPEN/ACTIVATE to prevent duplicate design tabs. */
export function findCadProjectEntry<T extends CadBoundProject>(
  projects: Record<string, T>,
  docGuid: string,
  projectId?: string
): [string, T] | undefined {
  const byGuid = Object.entries(projects).find(
    ([, proj]) => proj.cadIntegration?.docGuid === docGuid
  )
  if (byGuid) return byGuid

  if (projectId && projects[projectId]) {
    return [projectId, projects[projectId]]
  }

  return undefined
}

/** 获取 CAD 连接器图标文件名 */
export function getCadConnectorIcon(cadType?: string): string {
  switch (cadType?.toUpperCase()) {
    case 'SOLIDWORKS':
      return 'solidworks-connector.svg'
    case 'NX':
      return 'nx-connector.svg'
    case 'CREO':
      return 'creo-connector.svg'
    default:
      return 'connector.svg'
  }
}
