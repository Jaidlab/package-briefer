const moduleName = Bun.env.PACKAGE_NAME
if (!moduleName) {
  throw new Error('PACKAGE_NAME is required')
}

const packageFolder = `${process.cwd()}/node_modules/${moduleName}`
const packageJson = await Bun.file(`${packageFolder}/package.json`).json()
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
const patterns = []
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
  const targets = collectTargets(target)
  const unboundedTargets = [...new Set(targets.filter(target => target.startsWith('./') && !target.includes('*')))]
  if (unboundedTargets.length) {
    patterns.push({
      enumerable: false,
      path: exportPath,
      targets: unboundedTargets,
    })
  }
  for (const targetPattern of targets) {
    await expandPattern(exportPath, targetPattern)
  }
}
process.stdout.write(JSON.stringify({paths, patterns}))
