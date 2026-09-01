const postResult = globalThis.fetch.bind(globalThis)
const stringifyJson = JSON.stringify.bind(JSON)
const moduleName = Bun.env.PACKAGE_NAME
const exportPath = Bun.env.EXPORT_PATH
const resultEndpoint = Bun.env.RESULT_ENDPOINT
if (!moduleName) {
  throw new Error('PACKAGE_NAME is required')
}
if (!exportPath) {
  throw new Error('EXPORT_PATH is required')
}
if (!resultEndpoint) {
  throw new Error('RESULT_ENDPOINT is required')
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
  if (typeof value === 'object') {
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
const getInspectionFailure = error => {
  if (error instanceof Error) {
    return {
      message: error.message,
      ...(error.name ? {name: error.name} : {}),
    }
  }
  return {message: String(error)}
}
const specifier = exportPath === '.' ? moduleName : `${moduleName}${exportPath.slice(1)}`
let packet
try {
  const moduleInspection = await inspectModule(specifier)
  packet = {
    exportPath,
    modules: moduleInspection ? {[exportPath]: moduleInspection} : {},
  }
} catch (error) {
  packet = {
    exportPath,
    modules: {},
    failures: {[exportPath]: getInspectionFailure(error)},
  }
}
const response = await postResult(resultEndpoint, {
  method: 'POST',
  headers: {'content-type': 'application/json'},
  body: stringifyJson(packet),
})
if (!response.ok) {
  throw new Error(`Could not submit export inspection: HTTP ${response.status}`)
}
