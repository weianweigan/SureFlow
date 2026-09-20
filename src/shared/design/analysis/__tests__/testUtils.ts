import type { CavityInstance } from '../../types'

export function createTestCavity(
  overrides: Partial<CavityInstance> & { instanceId: string; faceId: string; u: number; v: number }
): CavityInstance {
  return {
    libraryId: 'std-lib',
    templateId: 'cavity-template',
    name: overrides.instanceId,
    rotation: 0,
    depthOffset: 0,
    ...overrides
  }
}
