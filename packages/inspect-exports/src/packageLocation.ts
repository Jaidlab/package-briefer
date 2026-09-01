import {createRequire} from 'node:module'
import {dirname, join} from 'node:path'

const controlCharacterPattern = /[\u{0000}-\u{001F}\u{007F}]/u
const validateSegment = (segment: string) => {
  if (!segment || segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\') || controlCharacterPattern.test(segment)) {
    throw new Error('Invalid npm package name')
  }
}
export const getPackageNameParts = (moduleName: string) => {
  if (!moduleName) {
    throw new Error('Invalid npm package name')
  }
  if (moduleName.startsWith('@')) {
    const slash = moduleName.indexOf('/')
    if (slash <= 1 || slash !== moduleName.lastIndexOf('/')) {
      throw new Error(`Invalid npm package name: ${moduleName}`)
    }
    const scope = moduleName.slice(1, slash)
    const name = moduleName.slice(slash + 1)
    validateSegment(scope)
    validateSegment(name)
    return [`@${scope}`, name]
  }
  if (moduleName.includes('/')) {
    throw new Error(`Invalid npm package name: ${moduleName}`)
  }
  validateSegment(moduleName)
  return [moduleName]
}
export const findPackageLocation = async (moduleName: string, baseFolder = process.cwd()) => {
  const parts = getPackageNameParts(moduleName)
  const requireFromBase = createRequire(join(baseFolder, 'package.json'))
  const searchPaths = requireFromBase.resolve.paths(moduleName) ?? []
  for (const nodeModulesFolder of searchPaths) {
    const packageJsonPath = join(nodeModulesFolder, ...parts, 'package.json')
    const file = Bun.file(packageJsonPath)
    if (!await file.exists()) {
      continue
    }
    const packageJson = await file.json() as Record<string, unknown>
    if (packageJson.name === moduleName) {
      return {
        packageFolder: dirname(packageJsonPath),
        packageJson,
        packageJsonPath,
      }
    }
  }
  throw new Error(`Could not locate installed npm package ${moduleName}`)
}
