export type ExportValue
  = | {
    keys: Array<string> | number
    type: 'object'
  }
  | {
    length: number
    type: 'array'
  }
  | {
    length: number
    type: 'string'
  }
  | {
    type: 'string'
    value: string
  }
  | 'async function'
  | 'bigint'
  | 'boolean'
  | 'class'
  | 'function'
  | 'number'
  | 'null'
  | 'string'
  | 'symbol'
  | 'undefined'

export type ModuleInspection = {
  default?: ExportValue
  named?: Record<string, ExportValue>
}

export type InspectionFailure = {
  message: string
  name?: string
}

export type Inspection = {
  error?: InspectionFailure
  failures?: Record<string, InspectionFailure>
  modules: Record<string, ModuleInspection>
}

export type FetchImplementation = (input: Request | URL | string, init?: RequestInit) => Promise<Response>

export type ContainerRunnerOptions = {
  dockerHost?: string
  image: string
  name: string
  timeoutMs: number
  version: string
}

export type ContainerRunner = (options: ContainerRunnerOptions) => Promise<string>

export type Options = {
  containerRunner?: ContainerRunner
  dockerHost?: string
  fetch?: FetchImplementation
  image?: string
  name: string
  timeoutMs?: number
  version?: string
}

const defaultImage = 'oven/bun:slim'
const defaultTimeoutMs = 120_000
const executeDocker = async (args: Array<string>, timeoutMs: number, dockerHost?: string) => {
  const dockerArgs = dockerHost ? ['--host', dockerHost, ...args] : args
  const process = Bun.spawn(['docker', ...dockerArgs], {
    stderr: 'pipe',
    stdout: 'pipe',
  })
  const stdoutPromise = new Response(process.stdout).text()
  const stderrPromise = new Response(process.stderr).text()
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      process.kill()
      reject(new Error(`Docker command timed out after ${timeoutMs} ms`))
    }, timeoutMs)
  })
  try {
    const exitCode = await Promise.race([process.exited, timeoutPromise])
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])
    if (exitCode !== 0) {
      throw new Error(stderr.trim() || `Docker exited with code ${exitCode}`)
    }
    return stdout.trim()
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

export const getInspectionFailure = (error: unknown): InspectionFailure => {
  if (error instanceof Error) {
    return {
      message: error.message,
      ...error.name ? {name: error.name} : {},
    }
  }
  return {message: String(error)}
}

const resultServerPort = 3000
const resultServerUrl = `http://127.0.0.1:${resultServerPort}`
const waitForResultServerScript = `for (let attempt = 0; attempt < 100; attempt++) { try { const response = await fetch('${resultServerUrl}'); if (response.ok) process.exit(0) } catch {} await Bun.sleep(20) } process.exit(1)`
const readResultsScript = `const response = await fetch('${resultServerUrl}'); if (!response.ok) throw new Error('HTTP ' + response.status); process.stdout.write(await response.text())`
const parseContainerExitCode = (output: string) => {
  const exitCode = Number.parseInt(output.trim(), 10)
  if (!Number.isInteger(exitCode)) {
    throw new Error(`Docker returned an invalid container exit code: ${JSON.stringify(output)}`)
  }
  return exitCode
}
const parseDiscoveredPaths = (output: string) => {
  const paths = JSON.parse(output) as unknown
  if (!Array.isArray(paths) || !paths.every((path): path is string => typeof path === 'string')) {
    throw new Error('Export discovery returned invalid paths')
  }
  return paths
}
const getReportedPaths = (output: string) => new Set(output
  .split(/\r?\n/u)
  .map(line => line.trim())
  .filter(Boolean)
  .map(line => JSON.parse(line) as {exportPath?: unknown})
  .map(packet => packet.exportPath)
  .filter((exportPath): exportPath is string => typeof exportPath === 'string'))

export const runContainer: ContainerRunner = async options => {
  const resultServer = await Bun.file(new URL('resultServer.js', import.meta.url)).text()
  const packageFolder = `${import.meta.dir}/..`
  const dockerfile = `${packageFolder}/Dockerfile`
  const id = crypto.randomUUID()
  const imageName = `inspect-exports:${id}`
  const networkName = `inspect-exports-${id}`
  const resultContainerName = `inspect-exports-results-${id}`
  const discoveryContainerName = `inspect-exports-discovery-${id}`
  const packageSpec = `${options.name}@${options.version}`
  const removeContainer = async (name: string) => {
    try {
      await executeDocker(['rm', '-f', name], 10_000, options.dockerHost)
    } catch {
    }
  }
  const waitForContainer = async (name: string) => parseContainerExitCode(await executeDocker(['wait', name], options.timeoutMs, options.dockerHost))
  const readResults = () => executeDocker(['exec', resultContainerName, 'bun', '--eval', readResultsScript], options.timeoutMs, options.dockerHost)
  const submitFailure = async (exportPath: string, error: unknown) => {
    const packet = JSON.stringify({
      exportPath,
      modules: {},
      failures: {[exportPath]: getInspectionFailure(error)},
    })
    const script = `const response = await fetch('${resultServerUrl}', {method: 'POST', headers: {'content-type': 'application/json'}, body: ${JSON.stringify(packet)}}); if (!response.ok) process.exit(1)`
    await executeDocker(['exec', resultContainerName, 'bun', '--eval', script], options.timeoutMs, options.dockerHost)
  }
  try {
    await executeDocker([
      'build',
      '--tag',
      imageName,
      '--build-arg',
      `BUN_IMAGE=${options.image}`,
      '--build-arg',
      `PACKAGE_NAME=${options.name}`,
      '--build-arg',
      `PACKAGE_SPEC=${packageSpec}`,
      '--file',
      dockerfile,
      packageFolder,
    ], options.timeoutMs, options.dockerHost)
    await executeDocker([
      'create',
      '--name',
      discoveryContainerName,
      imageName,
      'bun',
      '/inspect/discover.js',
    ], options.timeoutMs, options.dockerHost)
    await executeDocker(['start', discoveryContainerName], options.timeoutMs, options.dockerHost)
    const discoveryExitCode = await waitForContainer(discoveryContainerName)
    if (discoveryExitCode !== 0) {
      throw new Error(`Export discovery exited with code ${discoveryExitCode}`)
    }
    const paths = parseDiscoveredPaths(await executeDocker(['logs', discoveryContainerName], options.timeoutMs, options.dockerHost))
    await removeContainer(discoveryContainerName)

    await executeDocker(['network', 'create', networkName], options.timeoutMs, options.dockerHost)
    await executeDocker([
      'create',
      '--name',
      resultContainerName,
      '--network',
      networkName,
      '--network-alias',
      'results',
      '-e',
      `RESULT_SERVER_PORT=${resultServerPort}`,
      options.image,
      'sh',
      '-lc',
      'bun --eval "$1"',
      'sh',
      resultServer,
    ], options.timeoutMs, options.dockerHost)
    await executeDocker(['start', resultContainerName], options.timeoutMs, options.dockerHost)
    await executeDocker(['exec', resultContainerName, 'bun', '--eval', waitForResultServerScript], options.timeoutMs, options.dockerHost)

    for (const [index, exportPath] of paths.entries()) {
      const explorationContainerName = `inspect-exports-probe-${id}-${index}`
      try {
        await executeDocker([
          'create',
          '--name',
          explorationContainerName,
          '--network',
          networkName,
          '-e',
          `EXPORT_PATH=${exportPath}`,
          '-e',
          `RESULT_ENDPOINT=http://results:${resultServerPort}`,
          imageName,
        ], options.timeoutMs, options.dockerHost)
        await executeDocker(['start', explorationContainerName], options.timeoutMs, options.dockerHost)
        const exitCode = await waitForContainer(explorationContainerName)
        if (exitCode !== 0) {
          throw new Error(`Export exploration exited with code ${exitCode}`)
        }
      } catch (error) {
        await submitFailure(exportPath, error)
      } finally {
        await removeContainer(explorationContainerName)
      }
    }

    let output = await readResults()
    const reportedPaths = getReportedPaths(output)
    const missingPaths = paths.filter(path => !reportedPaths.has(path))
    for (const exportPath of missingPaths) {
      await submitFailure(exportPath, new Error('Export exploration exited without submitting a result'))
    }
    if (missingPaths.length) {
      output = await readResults()
    }
    return output
  } finally {
    await removeContainer(discoveryContainerName)
    await removeContainer(resultContainerName)
    try {
      await executeDocker(['network', 'rm', networkName], 10_000, options.dockerHost)
    } catch {
    }
    try {
      await executeDocker(['image', 'rm', '-f', imageName], 10_000, options.dockerHost)
    } catch {
    }
  }
}

const resolveVersion = async (name: string, fetchImplementation: FetchImplementation) => {
  const response = await fetchImplementation(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
    headers: {accept: 'application/json'},
  })
  if (!response.ok) {
    throw new Error(`Could not fetch npm package ${name}: HTTP ${response.status}`)
  }
  const packument = await response.json() as {
    'dist-tags'?: Record<string, string>
  }
  const version = packument['dist-tags']?.latest
  if (!version) {
    throw new Error(`npm package ${name} has no latest tag`)
  }
  return version
}
const inspectExports = async (options: Options): Promise<Inspection> => {
  try {
    const fetchImplementation = options.fetch ?? fetch
    const version = options.version ?? await resolveVersion(options.name, fetchImplementation)
    const output = await (options.containerRunner ?? runContainer)({
      ...options.dockerHost === undefined ? {} : {dockerHost: options.dockerHost},
      image: options.image ?? defaultImage,
      name: options.name,
      timeoutMs: options.timeoutMs ?? defaultTimeoutMs,
      version,
    })
    const packets = output.split(/\r?\n/u).map(line => line.trim()).filter(Boolean).map(line => JSON.parse(line) as unknown)
    if (!packets.length) {
      throw new Error('Export exploration produced no result packets')
    }
    const inspection: Inspection = {modules: {}}
    for (const packet of packets) {
      if (!packet || typeof packet !== 'object' || Array.isArray(packet) || !('modules' in packet) || !packet.modules || typeof packet.modules !== 'object' || Array.isArray(packet.modules)) {
        throw new Error('Export exploration returned an invalid result packet')
      }
      Object.assign(inspection.modules, packet.modules)
      if ('failures' in packet && packet.failures && typeof packet.failures === 'object' && !Array.isArray(packet.failures)) {
        Object.assign(inspection.failures ??= {}, packet.failures)
      }
    }
    return inspection
  } catch (error) {
    return {
      modules: {},
      error: getInspectionFailure(error),
    }
  }
}

export default inspectExports
