import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'
function config(signed: boolean, notarize = false) {
  return JSON.parse(execFileSync(process.execPath, ['-e', `
    Object.defineProperty(process, 'platform', {value: 'darwin'});
    console.log(JSON.stringify(require('./electron-builder.config.cjs')));
  `], { encoding: 'utf8', env: { ...process.env, CSC_LINK: signed ? 'test-certificate' : '',
    APPLE_ID: notarize ? 'test@example.invalid' : '', APPLE_APP_SPECIFIC_PASSWORD: notarize ? 'test-password' : '',
    APPLE_TEAM_ID: notarize ? 'TESTTEAMID' : '' } }))
}
it('packages arm64 without certificates and disables automatic macOS installation', () => {
  const value = config(false)
  expect(value.mac.identity).toBe('-')
  expect(value.mac.hardenedRuntime).toBe(false)
  expect(value.mac.notarize).toBe(false)
  expect(value.mac.forceCodeSigning).toBe(false)
  expect(value.extraMetadata.sureflowMacAutoUpdate).toBe(false)
  expect(value.mac.target).toEqual([{ target: 'dmg', arch: ['arm64'] }, { target: 'zip', arch: ['arm64'] }])
})
it('requires real signing when a certificate is supplied, and notarizes only with complete credentials', () => {
  const signed = config(true)
  expect(signed.mac.forceCodeSigning).toBe(true)
  expect(signed.mac.hardenedRuntime).toBe(true)
  expect(signed.extraMetadata.sureflowMacAutoUpdate).toBe(true)
  expect(signed.mac.identity).toBeUndefined()
  expect(signed.mac.notarize).toBe(false)
  expect(config(true, true).mac.notarize).toBe(true)
})
