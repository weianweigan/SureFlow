const { execFileSync } = require('node:child_process')
const { writeFileSync } = require('node:fs')
const { version } = require('../package.json')
const tag = process.env.GITHUB_REF_NAME
if (!/^v\d+\.\d+\.\d+$/.test(tag || '') || tag !== `v${version}`) {
  throw new Error('Release tag must be a stable vX.Y.Z matching package.json version')
}
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
let previous
try { previous = git('describe', '--tags', '--match', 'v[0-9]*', '--abbrev=0', `${tag}^`) } catch { /* First release */ }
const commits = git('log', '--format=- %s (%h)', previous ? `${previous}..${tag}` : tag)
writeFileSync('.release-notes.md', `# SureFlow ${tag}\n\n${commits || '- Maintenance release'}\n`)
