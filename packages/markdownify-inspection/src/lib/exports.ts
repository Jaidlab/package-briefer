import type {Inspection} from 'inspect-npm-package'
import type MarkdownMap from 'markdown-map'

import stringifyClank from 'stringify-clank'

type Clankable = Parameters<typeof stringifyClank>[0]
type ExportsInspection = NonNullable<Inspection['exports']>
type ModuleInspection = ExportsInspection[string]

const summarizeExportValue = (value: unknown): Clankable => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value as Clankable
  }
  const record = value as Record<string, unknown>
  if (record.type === 'object' && 'keys' in record) {
    const keys = record.keys
    if (typeof keys === 'number' || Array.isArray(keys) && keys.every((key): key is string => typeof key === 'string')) {
      return {entries: keys}
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
const getExportSpecifier = (packageName: string, exportPath: string) => {
  return exportPath === '.' ? packageName : `${packageName}${exportPath.slice(1)}`
}
const pushClankModuleExports = (markdown: MarkdownMap, parentSection: Array<string>, moduleInspection: ModuleInspection) => {
  for (const [kind, value] of Object.entries(moduleInspection)) {
    markdown.extendSection([...parentSection, kind], stringifyClank(summarizeExportValue(value)))
  }
}
const pushClankExports = (markdown: MarkdownMap, packageSection: string, exportsInspection: ExportsInspection) => {
  const rootEntry = Object.entries(exportsInspection).find(([exportPath]) => exportPath === '.')
  if (rootEntry) {
    const exportsSection = [packageSection, 'exports']
    markdown.ensureSection(exportsSection)
    pushClankModuleExports(markdown, exportsSection, rootEntry[1])
  }
  const subpackages = Object.entries(exportsInspection).filter(([exportPath]) => exportPath !== '.')
  if (subpackages.length) {
    const subpackageExportsSection = [packageSection, 'subpackage exports']
    for (const [exportPath, moduleInspection] of subpackages) {
      const exportSection = [...subpackageExportsSection, exportPath.replace(/^\.\//u, '')]
      markdown.ensureSection(exportSection)
      pushClankModuleExports(markdown, exportSection, moduleInspection)
    }
  }
}

export const pushExports = (markdown: MarkdownMap, packageSection: string, exportsInspection: ExportsInspection, packageName: string, clank: boolean) => {
  if (clank) {
    pushClankExports(markdown, packageSection, exportsInspection)
    return
  }
  const entries = Object.entries(exportsInspection)
  const exportsSection = [packageSection, 'exports']
  markdown.ensureSection(exportsSection)
  if (entries.length === 1 && entries[0][0] === '.') {
    markdown.extendSection(exportsSection, JSON.stringify(summarizeModuleExports(entries[0][1])))
    return
  }
  for (const [exportPath, moduleInspection] of entries) {
    markdown.extendSection([...exportsSection, getExportSpecifier(packageName, exportPath)], JSON.stringify(summarizeModuleExports(moduleInspection)))
  }
}
