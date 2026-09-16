const { mkdirSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')
if (process.platform === 'darwin') {
  const dir = join(__dirname, '../../out/native')
  mkdirSync(dir, { recursive: true })
  execFileSync('swiftc', [join(__dirname, 'FileAssociation.swift'), '-target', 'arm64-apple-macos11', '-o', join(dir, 'file-association'), '-module-cache-path', join(dir, 'swift-cache')], { stdio: 'inherit' })
}
