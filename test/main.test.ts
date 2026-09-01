import type {Inspection, Options as InspectNpmPackageOptions, SamplingOptions} from 'inspect-npm-package'
import type {Options as MarkdownifyOptions} from 'markdownify-inspection'

import {expect, test} from 'bun:test'

import {PackageNotFoundError, PackageVersionNotFoundError} from 'inspect-npm-package'

import {PackageBrieferServer} from '#src/PackageBrieferServer.ts'

const inspection: Inspection = {
  focused: {
    version: '1.0.0',
    size: 123,
    date: {
      absolute: '1 Aug 2026 00:00:00',
      relative: '29 days ago',
    },
    package: {name: 'demo'},
  },
  releases: {
    total: 1,
    tags: {
      latest: {
        version: '1.0.0',
        size: 123,
        date: {
          absolute: '1 Aug 2026 00:00:00',
          relative: '29 days ago',
        },
      },
    },
    first: {
      version: '1.0.0',
      size: 123,
      date: {
        absolute: '1 Aug 2026 00:00:00',
        relative: '29 days ago',
      },
    },
  },
}
type InspectOptions = SamplingOptions & Pick<InspectNpmPackageOptions, 'exportsDockerHost' | 'externalCaches' | 'onExportModule' | 'onFocusedPackage' | 'onFocusedVersion'> & {name: string
  version?: string}
type LoggedInspectOptions = Omit<InspectOptions, 'onFocusedVersion'>
const inspectCalls: Array<LoggedInspectOptions> = []
const inspect = async (options: InspectOptions) => {
  const {onExportModule: _onExportModule, onFocusedPackage: _onFocusedPackage, onFocusedVersion, ...loggedOptions} = options
  inspectCalls.push(loggedOptions)
  if (options.name === 'missing') {
    throw new PackageNotFoundError(options.name)
  }
  if (options.version === '9.9.9') {
    throw new PackageVersionNotFoundError(options.name, options.version)
  }
  onFocusedVersion?.(inspection.focused.version)
  return inspection
}
const slowStreamingInspect = async (options: InspectOptions) => {
  options.onFocusedVersion?.('1.0.0')
  options.onFocusedPackage?.({
    version: '1.0.0',
    package: inspection.focused.package,
  })
  await Bun.sleep(1200)
  return inspection
}
const markdownify = () => '# demo 1.0.0\n'
const renderClank = (_inspection: Inspection, options?: {clank?: boolean}) => `# demo 1.0.0\n\n${String(options?.clank)}`
test('serves the HTML homepage', async () => {
  inspectCalls.length = 0
  const server = new PackageBrieferServer(inspect, markdownify, 0)
  const response = await server.fetch(new Request('http://127.0.0.1:944/'))
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
  const html = await response.text()
  expect(html).toContain('<a href="/npmjs.com/package/es-toolkit">/npmjs.com/package/es-toolkit</a>')
  expect(html).toContain('<a href="/npmjs.com/package/ai/llms.txt">/npmjs.com/package/ai/llms.txt</a>')
  expect(html).toContain('<a href="/npmjs.com/package/@react-three/drei/v/11.0.0-alpha.5/llms.txt">/npmjs.com/package/@react-three/drei/v/11.0.0-alpha.5/llms.txt</a>')
  expect(inspectCalls).toHaveLength(0)
})
test('serves raw JSON inspection', async () => {
  inspectCalls.length = 0
  const server = new PackageBrieferServer(inspect, markdownify, 0)
  const response = await server.fetch(new Request('http://127.0.0.1:944/npmjs.com/package/demo'))
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual(inspection)
  expect(inspectCalls.at(-1)).toEqual({name: 'demo'})
})
test('serves llms.txt', async () => {
  inspectCalls.length = 0
  const server = new PackageBrieferServer(inspect, markdownify, 0)
  const response = await server.fetch(new Request('http://127.0.0.1:944/npmjs.com/package/demo/llms.txt'))
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
  expect(await response.text()).toBe('# demo 1.0.0\n')
  expect(inspectCalls.at(-1)).toEqual({name: 'demo'})
})
test('disables Bun idle timeouts only for llms.txt streams', async () => {
  const server = new PackageBrieferServer(inspect, markdownify, 0)
  const timeouts: Array<number> = []
  const timeoutController = {
    timeout: (_request: Request, seconds: number) => {
      timeouts.push(seconds)
    },
  }
  await server.fetch(new Request('http://127.0.0.1:944/npmjs.com/package/demo/llms.txt'), timeoutController)
  expect(timeouts).toEqual([0])
  await server.fetch(new Request('http://127.0.0.1:944/npmjs.com/package/demo'), timeoutController)
  expect(timeouts).toEqual([0])
})
test('keeps quiet llms.txt streams alive beyond Bun idleTimeout', async () => {
  const packageServer = new PackageBrieferServer(slowStreamingInspect, markdownify, 0, {}, 100, true)
  const bunServer = Bun.serve({
    port: 0,
    idleTimeout: 1,
    fetch: packageServer.fetch,
  })
  try {
    const response = await fetch(`http://127.0.0.1:${bunServer.port}/npmjs.com/package/demo/llms.txt`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('# demo 1.0.0')
  } finally {
    await bunServer.stop(true)
  }
})
test('streams llms.txt in three chunks', async () => {
  let focus: (() => void) | undefined
  let finish: (() => void) | undefined
  const controlledInspect = (options: InspectOptions) => new Promise<Inspection>(resolve => {
    focus = () => options.onFocusedVersion?.('1.0.0')
    finish = () => resolve(inspection)
  })
  const server = new PackageBrieferServer(controlledInspect, () => '# demo 1.0.0\n\nbody\n', 0)
  const response = await server.fetch(new Request('http://127.0.0.1:944/npmjs.com/package/demo/llms.txt'))
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('Response has no body')
  }
  const decoder = new TextDecoder
  const readChunk = async () => {
    const chunk = await reader.read()
    if (!(chunk.value instanceof Uint8Array)) {
      throw new TypeError('Expected response chunk')
    }
    return decoder.decode(chunk.value)
  }
  expect(await readChunk()).toBe('# demo')
  const focusedChunk = readChunk()
  focus?.()
  expect(await focusedChunk).toBe(' 1.0.0')
  const bodyChunk = readChunk()
  finish?.()
  expect(await bodyChunk).toBe('\n\nbody\n')
  const end = await reader.read()
  expect(end.done).toBe(true)
})
test('streams Clank package and export sections as they become ready', async () => {
  let focus: (() => void) | undefined
  let packageReady: (() => void) | undefined
  let rootReady: (() => void) | undefined
  let featureReady: (() => void) | undefined
  let otherReady: (() => void) | undefined
  let finish: (() => void) | undefined
  let finalOptions: MarkdownifyOptions | undefined
  const completeInspection: Inspection = {
    ...inspection,
    exports: {
      modules: {
        '.': {named: {foo: 'function'}},
        './feature': {named: {bar: 'function'}},
        './other': {default: 'function'},
      },
    },
  }
  const controlledInspect = (options: InspectOptions) => new Promise<Inspection>(resolve => {
    focus = () => options.onFocusedVersion?.('1.0.0')
    packageReady = () => options.onFocusedPackage?.({version: '1.0.0', package: {name: 'demo'}})
    rootReady = () => options.onExportModule?.('.', {named: {foo: 'function'}})
    featureReady = () => options.onExportModule?.('./feature', {named: {bar: 'function'}})
    otherReady = () => options.onExportModule?.('./other', {default: 'function'})
    finish = () => resolve(completeInspection)
  })
  const server = new PackageBrieferServer(controlledInspect, (_inspection, options) => {
    finalOptions = options
    return '# demo 1.0.0\n\nremainder'
  }, 0)
  const response = await server.fetch(new Request('http://127.0.0.1:944/npmjs.com/package/demo/llms.txt?clank=true'))
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('Response has no body')
  }
  const decoder = new TextDecoder
  const readChunk = async () => {
    const chunk = await reader.read()
    if (!(chunk.value instanceof Uint8Array)) {
      throw new TypeError('Expected response chunk')
    }
    return decoder.decode(chunk.value)
  }
  expect(await readChunk()).toBe('# demo')
  const focusedChunk = readChunk()
  focus?.()
  expect(await focusedChunk).toBe(' 1.0.0')
  const packageChunk = readChunk()
  packageReady?.()
  expect(await packageChunk).toBe('\n\npackage { name demo}')
  const rootChunk = readChunk()
  rootReady?.()
  expect(await rootChunk).toBe('\n\n## exports\n\n### named\n\nfoo function')
  const featureChunk = readChunk()
  featureReady?.()
  expect(await featureChunk).toBe('\n\n## subpackage exports\n\n### feature\n\n#### named\n\nbar function')
  const otherChunk = readChunk()
  otherReady?.()
  expect(await otherChunk).toBe('\n\n### other\n\n#### default\n\nfunction')
  const remainderChunk = readChunk()
  finish?.()
  expect(await remainderChunk).toBe('\n\nremainder')
  expect(finalOptions?.omitPackage).toBe(true)
  expect([...finalOptions?.omitExportPaths ?? []]).toEqual(['.', './feature', './other'])
  expect((await reader.read()).done).toBe(true)
})
test('overrides Clank rendering per request', async () => {
  inspectCalls.length = 0
  const server = new PackageBrieferServer(inspect, renderClank, 0, {}, 100, false)
  const enabled = await server.fetch(new Request('http://127.0.0.1:944/npmjs.com/package/demo/llms.txt?clank=true'))
  expect(await enabled.text()).toBe('# demo 1.0.0\n\ntrue')
  const disabled = await server.fetch(new Request('http://127.0.0.1:944/npmjs.com/package/demo/llms.txt?clank=false'))
  expect(await disabled.text()).toBe('# demo 1.0.0\n\nfalse')
})
test('uses the server Clank default when the query override is absent or invalid', async () => {
  inspectCalls.length = 0
  const server = new PackageBrieferServer(inspect, renderClank, 0, {}, 100, true)
  const defaultResponse = await server.fetch(new Request('http://127.0.0.1:944/npmjs.com/package/demo/llms.txt'))
  expect(await defaultResponse.text()).toBe('# demo 1.0.0\n\ntrue')
  const invalidResponse = await server.fetch(new Request('http://127.0.0.1:944/npmjs.com/package/demo/llms.txt?clank=yes'))
  expect(await invalidResponse.text()).toBe('# demo 1.0.0\n\ntrue')
  const overriddenResponse = await server.fetch(new Request('http://127.0.0.1:944/npmjs.com/package/demo/llms.txt?clank=false'))
  expect(await overriddenResponse.text()).toBe('# demo 1.0.0\n\nfalse')
})
test('serves a focused version as JSON', async () => {
  inspectCalls.length = 0
  const server = new PackageBrieferServer(inspect, markdownify, 0)
  const response = await server.fetch(new Request('http://127.0.0.1:944/npmjs.com/package/demo/v/0.3.1'))
  expect(response.status).toBe(200)
  expect(inspectCalls.at(-1)).toEqual({
    name: 'demo',
    version: '0.3.1',
  })
})
test('serves a focused version as llms.txt', async () => {
  inspectCalls.length = 0
  const server = new PackageBrieferServer(inspect, markdownify, 0)
  const response = await server.fetch(new Request('http://127.0.0.1:944/npmjs.com/package/demo/v/0.3.1/llms.txt'))
  expect(response.status).toBe(200)
  expect(await response.text()).toBe('# demo 1.0.0\n')
  expect(inspectCalls.at(-1)).toEqual({
    name: 'demo',
    version: '0.3.1',
  })
})
test('supports scoped package routes', async () => {
  inspectCalls.length = 0
  const server = new PackageBrieferServer(inspect, markdownify, 0)
  const response = await server.fetch(new Request('http://127.0.0.1:944/npmjs.com/package/@scope/demo/v/1.2.3/llms.txt'))
  expect(response.status).toBe(200)
  expect(inspectCalls.at(-1)).toEqual({
    name: '@scope/demo',
    version: '1.2.3',
  })
})
test('treats .md as part of the package name', async () => {
  inspectCalls.length = 0
  const server = new PackageBrieferServer(inspect, markdownify, 0)
  const response = await server.fetch(new Request('http://127.0.0.1:944/npmjs.com/package/demo.md'))
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('application/json')
  expect(inspectCalls.at(-1)).toEqual({name: 'demo.md'})
})
test('passes sampling options to the inspector', async () => {
  inspectCalls.length = 0
  const samplingOptions: SamplingOptions = {
    recentCommits: 1,
    recentlyCreatedIssues: 2,
    recentlyCreatedPullRequests: 3,
    recentlyUpdatedIssues: 4,
    recentlyUpdatedPullRequests: 5,
    recentContributors: 6,
    recentReleases: 7,
    recentVersions: 8,
    topContributors: 9,
  }
  const server = new PackageBrieferServer(inspect, markdownify, 0, samplingOptions)
  const response = await server.fetch(new Request('http://127.0.0.1:944/npmjs.com/package/demo/v/0.3.1'))
  expect(response.status).toBe(200)
  expect(inspectCalls.at(-1)).toEqual({
    ...samplingOptions,
    name: 'demo',
    version: '0.3.1',
  })
})
test('passes the exports Docker daemon to the inspector', async () => {
  inspectCalls.length = 0
  const server = new PackageBrieferServer(inspect, markdownify, 0, {
    exportsDockerHost: 'tcp://docker.example:2375',
  })
  const response = await server.fetch(new Request('http://127.0.0.1:944/npmjs.com/package/demo'))
  expect(response.status).toBe(200)
  expect(inspectCalls.at(-1)).toEqual({
    exportsDockerHost: 'tcp://docker.example:2375',
    name: 'demo',
  })
})
test('caches Inspection objects but renders Markdown for every request', async () => {
  inspectCalls.length = 0
  let renders = 0
  const server = new PackageBrieferServer(inspect, () => `# demo 1.0.0\n\nrender ${++renders}`, 60)
  const request = new Request('http://127.0.0.1:944/npmjs.com/package/demo/llms.txt')
  const firstResponse = await server.fetch(request)
  expect(await firstResponse.text()).toBe('# demo 1.0.0\n\nrender 1')
  const secondResponse = await server.fetch(request)
  expect(await secondResponse.text()).toBe('# demo 1.0.0\n\nrender 2')
  expect(inspectCalls).toHaveLength(1)
})
test('does not cache when cache-seconds is zero', async () => {
  inspectCalls.length = 0
  const server = new PackageBrieferServer(inspect, markdownify, 0)
  const request = new Request('http://127.0.0.1:944/npmjs.com/package/demo')
  await server.fetch(request)
  await server.fetch(request)
  expect(inspectCalls).toHaveLength(2)
})
test('expires cached Inspection objects', async () => {
  inspectCalls.length = 0
  const server = new PackageBrieferServer(inspect, markdownify, 0.01)
  const request = new Request('http://127.0.0.1:944/npmjs.com/package/demo')
  await server.fetch(request)
  await Bun.sleep(20)
  await server.fetch(request)
  expect(inspectCalls).toHaveLength(2)
})
test('evicts least recently used Inspection objects at cache-items', async () => {
  inspectCalls.length = 0
  const server = new PackageBrieferServer(inspect, markdownify, 60, {}, 1)
  await server.fetch(new Request('http://127.0.0.1:944/npmjs.com/package/demo'))
  await server.fetch(new Request('http://127.0.0.1:944/npmjs.com/package/other'))
  await server.fetch(new Request('http://127.0.0.1:944/npmjs.com/package/demo'))
  expect(inspectCalls.map(call => call.name)).toEqual(['demo', 'other', 'demo'])
})
test('maps package-not-found errors to 404', async () => {
  const server = new PackageBrieferServer(inspect, markdownify, 0)
  const response = await server.fetch(new Request('http://127.0.0.1:944/npmjs.com/package/missing'))
  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({error: 'Package not found: missing'})
})
test('maps version-not-found errors to 404', async () => {
  const server = new PackageBrieferServer(inspect, markdownify, 0)
  const response = await server.fetch(new Request('http://127.0.0.1:944/npmjs.com/package/demo/v/9.9.9'))
  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({error: 'Package version not found: demo@9.9.9'})
})
