export const ASSOCIATED_EXTENSIONS = ['sfb', 'sfzip'] as const
export type AssociatedExtension = typeof ASSOCIATED_EXTENSIONS[number]
export interface AssociationStatus {
  extension: AssociatedExtension
  state: 'default' | 'other' | 'unknown' | 'development' | 'unsupported'
  handler?: string
}
export interface FileAssociationInfo {
  packaged: boolean
  platform: string
  entries: AssociationStatus[]
}
