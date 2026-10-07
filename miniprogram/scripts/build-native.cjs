const fs = require('node:fs')
const path = require('node:path')
const babel = require('@babel/core')
const root = path.resolve(__dirname, '..'), source = path.join(root, 'src'), output = path.join(root, 'dist')
const plugins = [
  require('@babel/plugin-transform-modules-commonjs'),
  require('@babel/plugin-transform-optional-chaining'),
  require('@babel/plugin-transform-nullish-coalescing-operator'),
  () => ({ visitor: { StringLiteral(p) { if (p.node.value.endsWith('.mjs')) p.node.value = p.node.value.slice(0, -4) + '.js' } } })
]
function build() {
  if (!fs.existsSync(path.join(source, 'config.js'))) throw new Error('Missing src/config.js; copy config.example.js and configure the existing backend token.')
  const staging = path.join(root, '.native-build')
  fs.rmSync(staging, { recursive: true, force: true }); fs.mkdirSync(staging)
  function copy(directory, relative = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = path.join(relative, entry.name), input = path.join(directory, entry.name)
      if (entry.isDirectory()) { copy(input, name); continue }
      if (entry.name === 'config.example.js') continue
      if (!/\.(?:js|mjs|json|wxml|wxss|png|jpg|jpeg|svg)$/.test(name)) throw new Error(`Unexpected non-native source: ${name}`)
      const target = path.join(staging, name.replace(/\.mjs$/, '.js'))
      fs.mkdirSync(path.dirname(target), { recursive: true })
      if (/\.(?:js|mjs)$/.test(name)) {
        const result = babel.transformFileSync(input, { babelrc: false, configFile: false, plugins, comments: true })
        fs.writeFileSync(target, result.code + '\n')
      } else fs.copyFileSync(input, target)
    }
  }
  copy(source)
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')))
  fs.writeFileSync(path.join(staging, 'build-info.js'), `module.exports = ${JSON.stringify({ version: pkg.version, revision: process.env.MINIPROGRAM_BUILD_REVISION || 'native-local' })}\n`)
  const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json')))
  project.miniprogramRoot = './'
  fs.writeFileSync(path.join(staging, 'project.config.json'), JSON.stringify(project, null, 2) + '\n')
  const app = JSON.parse(fs.readFileSync(path.join(staging, 'app.json')))
  for (const page of app.pages) {
    for (const extension of ['js','json','wxml','wxss']) if (!fs.existsSync(path.join(staging, `${page}.${extension}`))) throw new Error(`Incomplete page: ${page}.${extension}`)
    const config = JSON.parse(fs.readFileSync(path.join(staging, `${page}.json`)))
    for (const component of Object.values(config.usingComponents || {})) {
      const prefix = path.join(staging, component.replace(/^\//, ''))
      for (const extension of ['js','json','wxml','wxss']) if (!fs.existsSync(`${prefix}.${extension}`)) throw new Error(`Incomplete component: ${component}.${extension}`)
    }
  }
  // DevTools compiler workers may use dist as cwd. Never replace its directory inode.
  fs.mkdirSync(output, { recursive: true })
  fs.cpSync(staging, output, { recursive: true, force: true })
  function prune(directory, relative = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = path.join(relative, entry.name), target = path.join(directory, entry.name)
      if (!fs.existsSync(path.join(staging, name))) fs.rmSync(target, { recursive: true, force: true })
      else if (entry.isDirectory()) prune(target, name)
    }
  }
  prune(output)
  fs.rmSync(staging, { recursive: true, force: true })
  console.log(`Native WeChat ${pkg.version}: ${app.pages.length} pages built; original AppID ${project.appid}`)
}
build()
if (process.argv.includes('--watch')) {
  let timer
  fs.watch(source, { recursive: true }, () => {
    clearTimeout(timer)
    timer = setTimeout(() => { try { build() } catch (error) { console.error(error.message) } }, 100)
  })
  console.log('Watching native source...')
}
