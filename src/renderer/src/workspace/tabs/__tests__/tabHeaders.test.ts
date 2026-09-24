import { describe, expect, it } from 'vitest'
import { getCadConnectorIcon } from '@shared/cad/cadProjectLookup'

describe('getCadConnectorIcon', () => {
  it('returns solidworks-connector.svg for SOLIDWORKS (case-insensitive)', () => {
    expect(getCadConnectorIcon('SOLIDWORKS')).toBe('solidworks-connector.svg')
    expect(getCadConnectorIcon('solidworks')).toBe('solidworks-connector.svg')
  })

  it('returns nx-connector.svg for NX (case-insensitive)', () => {
    expect(getCadConnectorIcon('NX')).toBe('nx-connector.svg')
    expect(getCadConnectorIcon('nx')).toBe('nx-connector.svg')
  })

  it('returns creo-connector.svg for CREO (case-insensitive)', () => {
    expect(getCadConnectorIcon('CREO')).toBe('creo-connector.svg')
    expect(getCadConnectorIcon('creo')).toBe('creo-connector.svg')
  })

  it('falls back to connector.svg for other CAD types or undefined', () => {
    expect(getCadConnectorIcon('INVENTOR')).toBe('connector.svg')
    expect(getCadConnectorIcon('CATIA')).toBe('connector.svg')
    expect(getCadConnectorIcon('AUTOCAD')).toBe('connector.svg')
    expect(getCadConnectorIcon('generic')).toBe('connector.svg')
    expect(getCadConnectorIcon(undefined)).toBe('connector.svg')
  })
})
