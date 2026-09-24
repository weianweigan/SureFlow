import { describe, expect, it } from 'vitest'
import { findCadProjectEntry } from '../cadProjectLookup'

const project = (docGuid: string) => ({
  cadIntegration: {
    cadType: 'SOLIDWORKS' as const,
    processId: 10,
    docGuid,
    connectionStatus: 'CONNECTED' as const
  }
})

describe('findCadProjectEntry', () => {
  it('finds the existing design by stable docGuid', () => {
    const result = findCadProjectEntry({ alpha: project('doc-a') }, 'doc-a')
    expect(result?.[0]).toBe('alpha')
  })

  it('falls back to the requested project id', () => {
    const result = findCadProjectEntry({ alpha: project('doc-a') }, 'missing', 'alpha')
    expect(result?.[0]).toBe('alpha')
  })

  it('returns undefined instead of creating an implicit duplicate', () => {
    expect(findCadProjectEntry({ alpha: project('doc-a') }, 'doc-b')).toBeUndefined()
  })
})
