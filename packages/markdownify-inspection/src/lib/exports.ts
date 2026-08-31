import type {Inspection} from 'inspect-npm-package'

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
  if (record.type === 'string' && typeof record.value === 'string') {
    return {string: record.value}
  }
  return Object.fromEntries(Object.entries(record).map(([key, nestedValue]) => [key, summarizeExportValue(nestedValue)]))
}
const summarizeModuleExports = (moduleInspection: ModuleInspection) => {
  const {default_or_named: defaultOrNamed, ...rest} = moduleInspection
  return summarizeExportValue({
    ...rest,
    ...defaultOrNamed === undefined ? {} : {'default+named': defaultOrNamed},
  }) as Record<string, Clankable>
}
const getExportSpecifier = (packageName: string, exportPath: string) => {
  return exportPath === '.' ? packageName : `${packageName}${exportPath.slice(1)}`
}
const getExportKindTitle = (kind: string) => {
  return kind === 'default_or_named' ? 'default or named' : kind
}
const pushClankModuleExports = (paragraphs: Array<string>, moduleInspection: ModuleInspection, headingLevel: number) => {
  for (const [kind, value] of Object.entries(moduleInspection)) {
    paragraphs.push(`${'#'.repeat(headingLevel)} ${getExportKindTitle(kind)}`, stringifyClank(summarizeExportValue(value)))
  }
}
const pushClankExports = (paragraphs: Array<string>, exportsInspection: ExportsInspection) => {
  const rootEntry = Object.entries(exportsInspection).find(([exportPath]) => exportPath === '.')
  if (rootEntry) {
    paragraphs.push('## exports')
    pushClankModuleExports(paragraphs, rootEntry[1], 3)
  }
  const subpackages = Object.entries(exportsInspection).filter(([exportPath]) => exportPath !== '.')
  if (subpackages.length) {
    paragraphs.push('## subpackage exports')
    for (const [exportPath, moduleInspection] of subpackages) {
      paragraphs.push(`### ${exportPath.replace(/^\.\//u, '')}`)
      pushClankModuleExports(paragraphs, moduleInspection, 4)
    }
  }
}

export const pushExports = (paragraphs: Array<string>, exportsInspection: ExportsInspection, packageName: string, clank: boolean) => {
  if (clank) {
    pushClankExports(paragraphs, exportsInspection)
    return
  }
  const entries = Object.entries(exportsInspection)
  if (entries.length === 1 && entries[0][0] === '.') {
    paragraphs.push('## exports', JSON.stringify(summarizeModuleExports(entries[0][1])))
    return
  }
  paragraphs.push('## exports')
  for (const [exportPath, moduleInspection] of entries) {
    paragraphs.push(`### ${getExportSpecifier(packageName, exportPath)}`)
    paragraphs.push(JSON.stringify(summarizeModuleExports(moduleInspection)))
  }
}
