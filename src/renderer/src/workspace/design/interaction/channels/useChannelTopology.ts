import { useMemo } from 'react'
import { useDesignStore } from '../../model/designStore'
import { useLibraryStore, getLoadedLibs } from '../../../library/viewmodel/libraryStore'
import { getCavitySteps } from '../../geometry/cavityProfileBuilder'
import { getCavityPorts } from '../../geometry/templateHoleResolver'
import { solveChannelTopology } from '@shared/design/topology/channelSolver'

export function useChannelTopology(projectId: string) {
  const session=useDesignStore(s=>s.projects[projectId])
  const library=useLibraryStore(s=>s.doc)
  const scheme=session?.doc.schemes.find(s=>s.id===session.doc.activeSchemeId)
  const dimensions=session?.doc.baseBody.dimensions
  const cavities=useMemo(()=>(scheme?.cavities??[]).map(c=>({
    ...c,
    steps:getCavitySteps(c,c.libraryId===library?.id?library:getLoadedLibs().get(c.libraryId)??library),
    ports:getCavityPorts(c,library)
  })),[scheme?.cavities,library])
  const topology=useMemo(()=>solveChannelTopology(cavities,dimensions??[100,100,100],scheme?.channelConfigs),[cavities,dimensions,scheme?.channelConfigs])
  return {topology,cavities}
}
