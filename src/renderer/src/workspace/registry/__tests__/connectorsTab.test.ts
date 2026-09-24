import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TAB_REGISTRY, panelIdFor } from '../tabTypeRegistry'
import { openPanelByType } from '../panelActions'
import { useWorkspaceStore } from '../../layout/layoutStore'
import { getCadConnectorIcon } from '@shared/cad/cadProjectLookup'
import { useCadBridgeStore } from '../../connectors/cadBridgeStatusStore'

describe('Connectors Tab Registry and Actions', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ api: null, activePanelId: null })
  })

  it('should have connectors registered in TAB_REGISTRY', () => {
    const def = TAB_REGISTRY.connectors
    expect(def).toBeDefined()
    expect(def.type).toBe('connectors')
    expect(def.component).toBe('connectors')
    expect(def.singleton).toBe(true)
    expect(def.closable).toBe(true)
    expect(def.tabComponent).toBe('connectors-tab')
    expect(panelIdFor('connectors')).toBe('connectors')
    expect(def.title(def.defaultParams())).toBe('CAD 连接器')
  })

  it('should open connectors panel via openPanelByType', () => {
    const addPanelMock = vi.fn()
    const focusMock = vi.fn()
    const mockApi = {
      getPanel: vi.fn().mockReturnValue(null),
      addPanel: addPanelMock,
      focus: focusMock
    } as any

    useWorkspaceStore.getState().setApi(mockApi)
    openPanelByType('connectors')

    expect(mockApi.getPanel).toHaveBeenCalledWith('connectors')
    expect(addPanelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'connectors',
        component: 'connectors',
        tabComponent: 'connectors-tab'
      })
    )
  })

  it('should activate existing connectors panel if already open', () => {
    const setActiveMock = vi.fn()
    const mockPanel = {
      api: { setActive: setActiveMock }
    }
    const mockApi = {
      getPanel: vi.fn().mockReturnValue(mockPanel),
      addPanel: vi.fn(),
      focus: vi.fn()
    } as any

    useWorkspaceStore.getState().setApi(mockApi)
    openPanelByType('connectors')

    expect(mockApi.getPanel).toHaveBeenCalledWith('connectors')
    expect(setActiveMock).toHaveBeenCalled()
    expect(mockApi.focus).toHaveBeenCalled()
    expect(mockApi.addPanel).not.toHaveBeenCalled()
  })
})

describe('CAD Connector Icon Lookup', () => {
  it('should return correct SVG icon for each CAD type', () => {
    expect(getCadConnectorIcon('SOLIDWORKS')).toBe('solidworks-connector.svg')
    expect(getCadConnectorIcon('solidworks')).toBe('solidworks-connector.svg')
    expect(getCadConnectorIcon('NX')).toBe('nx-connector.svg')
    expect(getCadConnectorIcon('CREO')).toBe('creo-connector.svg')
    expect(getCadConnectorIcon(undefined)).toBe('connector.svg')
  })
})

describe('CAD Bridge Store', () => {
  it('should update status and connection properties correctly', () => {
    const store = useCadBridgeStore.getState()
    store.setStatus({
      connected: true,
      port: 19828,
      activeProjects: 2,
      currentCadType: 'SOLIDWORKS',
      connectedClientsCount: 1
    })

    const updated = useCadBridgeStore.getState()
    expect(updated.status.connected).toBe(true)
    expect(updated.status.currentCadType).toBe('SOLIDWORKS')
    expect(updated.status.activeProjects).toBe(2)
  })
})
