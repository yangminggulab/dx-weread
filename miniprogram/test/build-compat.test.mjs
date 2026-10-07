import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST_DIR = fileURLToPath(new URL('../dist/', import.meta.url))

function listJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return listJavaScriptFiles(target)
    return entry.isFile() && entry.name.endsWith('.js') ? [target] : []
  })
}

test('compiled bundles avoid syntax rejected by the WeChat upload minifier', () => {
  for (const file of listJavaScriptFiles(DIST_DIR)) {
    const source = fs.readFileSync(file, 'utf8')
    const relative = path.relative(DIST_DIR, file)
    assert.equal(source.includes('?.'), false, `${relative} contains optional chaining`)
    assert.equal(source.includes('??'), false, `${relative} contains nullish coalescing`)
  }
})
