import { describe, it, expect } from 'vitest'
import {
  getDefaultExportPath,
  resolveExportPath,
  toPersistedExportPath,
  computeSchemeExportPath,
  isRelativePath,
  getFileDirectory,
  getFileBaseName,
  getFileNameWithExt
} from '../exportPathUtils'

describe('exportPathUtils', () => {
  describe('path parsing helpers', () => {
    it('should correctly extract file directory, base name, and filename with extension', () => {
      const winPath = 'C:\\Projects\\Hydraulics\\ValveBlock_01.sfb'
      expect(getFileDirectory(winPath)).toBe('C:\\Projects\\Hydraulics')
      expect(getFileBaseName(winPath)).toBe('ValveBlock_01')
      expect(getFileNameWithExt(winPath)).toBe('ValveBlock_01.sfb')

      const unixPath = '/home/user/workspace/BlockA.sfb'
      expect(getFileDirectory(unixPath)).toBe('/home/user/workspace')
      expect(getFileBaseName(unixPath)).toBe('BlockA')
      expect(getFileNameWithExt(unixPath)).toBe('BlockA.sfb')
    })

    it('should detect relative and absolute paths accurately', () => {
      expect(isRelativePath('./manifold.step')).toBe(true)
      expect(isRelativePath('.\\manifold.step')).toBe(true)
      expect(isRelativePath('manifold.step')).toBe(true)
      expect(isRelativePath('exports/manifold.step')).toBe(true)

      expect(isRelativePath('C:\\manifold.step')).toBe(false)
      expect(isRelativePath('d:/exports/manifold.step')).toBe(false)
      expect(isRelativePath('/usr/local/manifold.step')).toBe(false)
      expect(isRelativePath('\\\\network\\share\\manifold.step')).toBe(false)
    })
  })

  describe('getDefaultExportPath', () => {
    it('should generate default step path in same directory with same base name', () => {
      expect(getDefaultExportPath('C:\\Projects\\Manifold.sfb', 'MyProject')).toBe(
        'C:\\Projects\\Manifold.step'
      )
      expect(getDefaultExportPath('/projects/valve.sfb', 'MyProject')).toBe(
        '/projects/valve.step'
      )
    })

    it('should fallback to project name when sfbFilePath is absent', () => {
      expect(getDefaultExportPath(undefined, 'MainValve')).toBe('MainValve.step')
      expect(getDefaultExportPath(undefined, undefined)).toBe('未命名工程.step')
    })
  })

  describe('toPersistedExportPath', () => {
    it('should convert export path in same directory to relative path', () => {
      const sfb = 'C:\\Hydraulics\\Projects\\Valve_01.sfb'
      const exportStep = 'C:\\Hydraulics\\Projects\\Valve_01.step'
      expect(toPersistedExportPath(exportStep, sfb)).toBe('./Valve_01.step')
    })

    it('should handle Windows case-insensitivity when converting to relative path', () => {
      const sfb = 'c:\\hydraulics\\projects\\valve_01.sfb'
      const exportStep = 'C:\\Hydraulics\\Projects\\Valve_Custom.step'
      expect(toPersistedExportPath(exportStep, sfb)).toBe('./Valve_Custom.step')
    })

    it('should convert subdirectory export path to relative path', () => {
      const sfb = 'C:\\Hydraulics\\Projects\\Valve_01.sfb'
      const exportStep = 'C:\\Hydraulics\\Projects\\cad_exports\\Valve_01.step'
      expect(toPersistedExportPath(exportStep, sfb)).toBe('./cad_exports/Valve_01.step')
    })

    it('should keep absolute path when exporting to different directory or drive', () => {
      const sfb = 'C:\\Hydraulics\\Projects\\Valve_01.sfb'
      const exportDiffDir = 'C:\\Exports\\CAD\\Valve_01.step'
      expect(toPersistedExportPath(exportDiffDir, sfb)).toBe(exportDiffDir)

      const exportDiffDrive = 'D:\\Projects\\Valve_01.step'
      expect(toPersistedExportPath(exportDiffDrive, sfb)).toBe(exportDiffDrive)
    })

    it('should return exportPath unchanged when sfbFilePath is not provided', () => {
      expect(toPersistedExportPath('C:\\Exports\\Valve.step', undefined)).toBe('C:\\Exports\\Valve.step')
    })
  })

  describe('resolveExportPath', () => {
    it('should resolve relative path against current sfb location', () => {
      const sfb = 'C:\\NewDrive\\NewProjects\\Valve_01.sfb'
      const lastExport = './Valve_01.step'
      expect(resolveExportPath(lastExport, sfb)).toBe('C:\\NewDrive\\NewProjects\\Valve_01.step')
    })

    it('should resolve subdirectory relative path against current sfb location', () => {
      const sfb = 'C:\\NewDrive\\NewProjects\\Valve_01.sfb'
      const lastExport = './cad/Valve_01.step'
      expect(resolveExportPath(lastExport, sfb)).toBe('C:\\NewDrive\\NewProjects\\cad\\Valve_01.step')
    })

    it('should keep absolute path when resolving', () => {
      const sfb = 'C:\\Projects\\Valve_01.sfb'
      const absLastExport = 'D:\\FixedExports\\Valve_01.step'
      expect(resolveExportPath(absLastExport, sfb)).toBe('D:\\FixedExports\\Valve_01.step')
    })

    it('should fallback to default path when lastExportPath is empty', () => {
      const sfb = 'C:\\Projects\\Valve_01.sfb'
      expect(resolveExportPath('', sfb, 'ValveProject')).toBe('C:\\Projects\\Valve_01.step')
      expect(resolveExportPath(undefined, undefined, 'ValveProject')).toBe('ValveProject.step')
    })
  })

  describe('computeSchemeExportPath', () => {
    it('should return base path untouched for single scheme', () => {
      const base = 'C:\\Projects\\Valve.step'
      expect(computeSchemeExportPath(base, 'SchemeA', false)).toBe('C:\\Projects\\Valve.step')
    })

    it('should append scheme name suffix for multi-scheme exports', () => {
      const base = 'C:\\Projects\\Valve.step'
      expect(computeSchemeExportPath(base, '方案 1', true)).toBe('C:\\Projects\\Valve_方案 1.step')
      expect(computeSchemeExportPath(base, 'Scheme 2 (Alt)', true)).toBe('C:\\Projects\\Valve_Scheme 2 (Alt).step')
    })
  })
})
