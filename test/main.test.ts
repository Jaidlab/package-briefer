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
