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

export const runContainer: ContainerRunner = async options => {
  const probe = await Bun.file(new URL('probe.js', import.meta.url)).text()
  const containerName = `inspect-exports-${crypto.randomUUID()}`
  const packageSpec = `${options.name}@${options.version}`
  try {
    await executeDocker([
      'create',
      '--name',
      containerName,
      '-e',
      `PACKAGE_NAME=${options.name}`,
      '-e',
      `PACKAGE_SPEC=${packageSpec}`,
      options.image,
      'sh',
      '-lc',
      'bun add "$PACKAGE_SPEC" >/dev/null 2>&1 && bun --eval "$1"',
      'sh',
      probe,
    ], options.timeoutMs, options.dockerHost)
    return await executeDocker(['start', '-a', containerName], options.timeoutMs, options.dockerHost)
  } finally {
    try {
      await executeDocker(['rm', '-f', containerName], 10_000, options.dockerHost)
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
export const getInspectionFailure = (error: unknown): InspectionFailure => {
  if (error instanceof Error) {
    return {
      message: error.message,
      ...error.name ? {name: error.name} : {},
    }
  }
  return {message: String(error)}
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
    const inspection = JSON.parse(output) as unknown
    if (!inspection || typeof inspection !== 'object' || Array.isArray(inspection) || !('modules' in inspection) || !inspection.modules || typeof inspection.modules !== 'object' || Array.isArray(inspection.modules)) {
      throw new Error('Export probe returned an invalid inspection')
    }
    return inspection as Inspection
  } catch (error) {
    return {
      modules: {},
      error: getInspectionFailure(error),
    }
  }
}

export default inspectExports
