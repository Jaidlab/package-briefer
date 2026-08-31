import type {Inspection, Options as InspectNpmPackageOptions, SamplingOptions} from 'inspect-npm-package'

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
type InspectOptions = SamplingOptions & Pick<InspectNpmPackageOptions, 'exportsDockerHost'> & {name: string
  version?: string}
const inspectCalls: Array<InspectOptions> = []
const inspect = async (options: InspectOptions) => {
  inspectCalls.push(options)
  if (options.name === 'missing') {
    throw new PackageNotFoundError(options.name)
  }
  if (options.version === '9.9.9') {
    throw new PackageVersionNotFoundError(options.name, options.version)
  }
  return inspection
}
const markdownify = () => '# demo 1.0.0\n'
const renderClank = (_inspection: Inspection, options?: {clank?: boolean}) => String(options?.clank)
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
test('overrides Clank rendering per request', async () => {
  inspectCalls.length = 0
  const server = new PackageBrieferServer(inspect, renderClank, 0, {}, 100, false)
  const enabled = await server.fetch(new Request('http://127.0.0.1:944/npmjs.com/package/demo/llms.txt?clank=true'))
  expect(await enabled.text()).toBe('true')
  const disabled = await server.fetch(new Request('http://127.0.0.1:944/npmjs.com/package/demo/llms.txt?clank=false'))
  expect(await disabled.text()).toBe('false')
})
test('uses the server Clank default when the query override is absent or invalid', async () => {
  inspectCalls.length = 0
  const server = new PackageBrieferServer(inspect, renderClank, 0, {}, 100, true)
  const defaultResponse = await server.fetch(new Request('http://127.0.0.1:944/npmjs.com/package/demo/llms.txt'))
  expect(await defaultResponse.text()).toBe('true')
  const invalidResponse = await server.fetch(new Request('http://127.0.0.1:944/npmjs.com/package/demo/llms.txt?clank=yes'))
  expect(await invalidResponse.text()).toBe('true')
  const overriddenResponse = await server.fetch(new Request('http://127.0.0.1:944/npmjs.com/package/demo/llms.txt?clank=false'))
  expect(await overriddenResponse.text()).toBe('false')
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
  const server = new PackageBrieferServer(inspect, () => `render ${++renders}`, 60)
  const request = new Request('http://127.0.0.1:944/npmjs.com/package/demo/llms.txt')
  const firstResponse = await server.fetch(request)
  expect(await firstResponse.text()).toBe('render 1')
  const secondResponse = await server.fetch(request)
  expect(await secondResponse.text()).toBe('render 2')
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
