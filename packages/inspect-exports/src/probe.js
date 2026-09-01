const moduleName = Bun.env.PACKAGE_NAME
if (!moduleName) {
  throw new Error('PACKAGE_NAME is required')
}

const packageFolder = `${process.cwd()}/node_modules/${moduleName}`
const packageJson = await Bun.file(`${packageFolder}/package.json`).json()

const peerDependencies = packageJson.peerDependencies ?? {}
const peerSpecs = Object.entries(peerDependencies).map(([name, range]) => `${name}@${range}`)
if (peerSpecs.length) {
  const peerInstall = Bun.spawn([process.execPath, 'add', ...peerSpecs], {
    stderr: 'ignore',
    stdout: 'ignore',
  })
  const exitCode = await peerInstall.exited
  if (exitCode !== 0) {
    throw new Error(`Could not install peer dependencies for ${moduleName}`)
  }
}

const classPattern = /^\s*class(?:\s|\{)/u
const describeFunction = value => {
  if (value.constructor?.name === 'AsyncFunction') {
    return 'async function'
  }
  return classPattern.test(Function.prototype.toString.call(value)) ? 'class' : 'function'
}

const describe = value => {
  if (value === null) {
    return 'null'
  }
  if (typeof value === 'string') {
    return value.length < 100 ? {type: 'string', value} : {type: 'string', length: value.length}
  }
  if (Array.isArray(value)) {
    return {type: 'array', length: value.length}
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value)
    return {type: 'object', keys: keys.length > 20 ? keys.length : keys}
  }
  if (typeof value === 'function') {
    return describeFunction(value)
  }
  return typeof value
}

const inspectModule = async specifier => {
  const resolved = Bun.resolveSync(specifier, process.cwd())
  if (resolved.replaceAll('\\', '/').endsWith('/package.json')) {
    return
  }
  const module = await import(resolved)
  const {default: defaultExport, ...named} = module
  const namedInspection = Object.fromEntries(Object.entries(named).map(([key, value]) => [key, describe(value)]))
  return {
    ...(defaultExport !== undefined ? {default: describe(defaultExport)} : {}),
    ...(Object.keys(named).length ? {named: namedInspection} : {}),
  }
}

const collectTargets = (value, targets = []) => {
  if (typeof value === 'string') {
    targets.push(value)
  } else if (Array.isArray(value)) {
    for (const item of value) {
      collectTargets(item, targets)
    }
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectTargets(item, targets)
    }
  }
  return targets
}

const escapeRegExp = value => value.replace(/[.*+?^()|[\]{}$\\]/gu, '\\$&')
const getPatternCapture = (pattern, file) => {
  const parts = pattern.split('*')
  if (parts.length < 2) {
    return
  }
  let source = `^${escapeRegExp(parts[0])}(.*)${escapeRegExp(parts[1])}`
  for (const part of parts.slice(2)) {
    source += `\\1${escapeRegExp(part)}`
  }
  source += '$'
  return new RegExp(source, 'u').exec(file)?.[1]
}

const paths = []
const seenPaths = new Set
const addPath = path => {
  if (!seenPaths.has(path)) {
    seenPaths.add(path)
    paths.push(path)
  }
}
const expandPattern = async (exportPath, target) => {
  if (!target.startsWith('./') || !target.includes('*')) {
    return
  }
  const targetPattern = target.slice(2)
  const files = []
  const glob = new Bun.Glob(targetPattern)
  for await (const file of glob.scan({
    cwd: packageFolder,
    dot: true,
    followSymlinks: false,
    onlyFiles: true,
  })) {
    files.push(file.replaceAll('\\', '/'))
  }
  files.sort()
  for (const file of files) {
    const capture = getPatternCapture(targetPattern, file)
    if (capture !== undefined) {
      addPath(exportPath.replaceAll('*', capture))
    }
  }
}

const exportsField = packageJson.exports
const hasSubpathExports = exportsField && typeof exportsField === 'object' && !Array.isArray(exportsField) && Object.keys(exportsField).some(key => key.startsWith('.'))
const exportEntries = exportsField === undefined
  ? [['.', undefined]]
  : hasSubpathExports
    ? Object.entries(exportsField)
    : [['.', exportsField]]

for (const [exportPath, target] of exportEntries) {
  if (exportPath !== '.' && !exportPath.startsWith('./')) {
    continue
  }
  if (!exportPath.includes('*')) {
    addPath(exportPath)
    continue
  }
  for (const targetPattern of collectTargets(target)) {
    await expandPattern(exportPath, targetPattern)
  }
}

const getInspectionFailure = error => {
  if (error instanceof Error) {
    return {
      message: error.message,
      ...(error.name ? {name: error.name} : {}),
    }
  }
  return {message: String(error)}
}

const modules = {}
const failures = {}
for (const exportPath of paths) {
  const specifier = exportPath === '.' ? moduleName : `${moduleName}${exportPath.slice(1)}`
  try {
    const moduleInspection = await inspectModule(specifier)
    if (moduleInspection) {
      modules[exportPath] = moduleInspection
    }
  } catch (error) {
    failures[exportPath] = getInspectionFailure(error)
  }
}
console.log(JSON.stringify({
  modules,
  ...(Object.keys(failures).length ? {failures} : {}),
}))
