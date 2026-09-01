import type {Inspection} from 'inspect-npm-package'
import type MarkdownMap from 'markdown-map'

import stringifyClank from 'stringify-clank'

type Clankable = Parameters<typeof stringifyClank>[0]
type ExportsInspection = NonNullable<Inspection['exports']>
type ModuleInspection = ExportsInspection['modules'][string]

const summarizeExportValue = (value: unknown): Clankable => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value as Clankable
  }
  const record = value as Record<string, unknown>
  if (['object', 'async function', 'class', 'function'].includes(String(record.type)) && 'keys' in record) {
    const keys = record.keys
    if (typeof keys === 'number' || Array.isArray(keys)) {
      return record.type === 'object' ? {entries: keys as Clankable} : {type: record.type as Clankable, entries: keys as Clankable}
    }
  }
  if (record.type === 'array' && typeof record.length === 'number') {
    return {items: record.length}
  }
  if (record.type === 'string' && typeof record.value === 'string') {
    return {string: record.value}
  }
  return Object.fromEntries(Object.entries(record).map(([key, nestedValue]) => [key, summarizeExportValue(nestedValue)]))
}
const summarizeModuleExports = (moduleInspection: ModuleInspection) => summarizeExportValue(moduleInspection) as Record<string, Clankable>
const getExportSpecifier = (packageName: string, exportPath: string) => exportPath === '.' ? packageName : `${packageName}${exportPath.slice(1)}`
const pushClankModuleExports = (markdown: MarkdownMap, parentSection: Array<string>, moduleInspection: ModuleInspection) => {
  for (const [kind, value] of Object.entries(moduleInspection)) {
    markdown.extendSection([...parentSection, kind], stringifyClank(summarizeExportValue(value)))
  }
}
const pushClankExports = (markdown: MarkdownMap, packageSection: string, modules: ExportsInspection['modules']) => {
  const rootEntry = Object.entries(modules).find(([exportPath]) => exportPath === '.')
  if (rootEntry) {
    const exportsSection = [packageSection, 'exports']
    markdown.ensureSection(exportsSection)
    pushClankModuleExports(markdown, exportsSection, rootEntry[1])
  }
  const subpackages = Object.entries(modules).filter(([exportPath]) => exportPath !== '.')
  if (subpackages.length) {
    const subpackageExportsSection = [packageSection, 'subpackage exports']
    for (const [exportPath, moduleInspection] of subpackages) {
      const exportSection = [...subpackageExportsSection, exportPath.replace(/^\.\//u, '')]
      markdown.ensureSection(exportSection)
      pushClankModuleExports(markdown, exportSection, moduleInspection)
    }
  }
}
const pushPatterns = (markdown: MarkdownMap, packageSection: string, exportsInspection: ExportsInspection, clank: boolean) => {
  if (!exportsInspection.patterns?.length) {
    return
  }
  markdown.extendSection([packageSection, 'export patterns'], clank ? stringifyClank(exportsInspection.patterns) : JSON.stringify(exportsInspection.patterns))
}
const pushFailures = (markdown: MarkdownMap, packageSection: string, exportsInspection: ExportsInspection, packageName: string, clank: boolean) => {
  if (exportsInspection.error) {
    markdown.extendSection([packageSection, 'export inspection error'], clank ? stringifyClank(exportsInspection.error) : JSON.stringify(exportsInspection.error))
  }
  for (const [exportPath, failure] of Object.entries(exportsInspection.failures ?? {})) {
    markdown.extendSection([packageSection, 'export failures', getExportSpecifier(packageName, exportPath)], clank ? stringifyClank(failure) : JSON.stringify(failure))
  }
}

export const pushExports = (markdown: MarkdownMap, packageSection: string, exportsInspection: ExportsInspection, packageName: string, clank: boolean) => {
  const entries = Object.entries(exportsInspection.modules)
  if (clank) {
    pushClankExports(markdown, packageSection, exportsInspection.modules)
  } else if (entries.length) {
    const exportsSection = [packageSection, 'exports']
    markdown.ensureSection(exportsSection)
    if (entries.length === 1 && entries[0][0] === '.') {
      markdown.extendSection(exportsSection, JSON.stringify(summarizeModuleExports(entries[0][1])))
    } else {
      for (const [exportPath, moduleInspection] of entries) {
        markdown.extendSection([...exportsSection, getExportSpecifier(packageName, exportPath)], JSON.stringify(summarizeModuleExports(moduleInspection)))
      }
    }
  }
  pushPatterns(markdown, packageSection, exportsInspection, clank)
  pushFailures(markdown, packageSection, exportsInspection, packageName, clank)
}
