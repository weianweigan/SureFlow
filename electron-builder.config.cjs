const { build } = require('./package.json')
const { existsSync } = require('node:fs')

// Clean up empty environment variables so electron-builder doesn't treat empty strings as file paths
const envKeysToClean = [
  'CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD',
  'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'
]
for (const key of envKeysToClean) {
  if (process.env[key] !== undefined && !process.env[key].trim()) {
    delete process.env[key]
  }
}

// Certificates are optional. Apple Silicon still needs an ad-hoc signature to run.
const signedMac = process.platform === 'darwin' && Boolean(process.env.CSC_LINK)
const notarizeMac = signedMac && Boolean(process.env.APPLE_ID &&
  process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID)

const hasReleaseNotes = existsSync('.release-notes.md')

module.exports = {
  ...build,
  ...(hasReleaseNotes ? { releaseInfo: { releaseNotesFile: '.release-notes.md' } } : {}),
  extraMetadata: { sureflowMacAutoUpdate: signedMac },
  mac: {
    ...build.mac,
    identity: signedMac ? undefined : '-',
    forceCodeSigning: signedMac,
    hardenedRuntime: signedMac,
    notarize: notarizeMac
  }
}
