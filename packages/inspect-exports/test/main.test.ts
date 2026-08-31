import type {ContainerRunnerOptions, FetchImplementation} from '../src/main.ts'

import {expect, test} from 'bun:test'

import inspectExports from '../src/main.ts'

const inspection = {
  '.': {
    named: {
      foo: 'function',
      name: {
        type: 'string',
        value: 'demo',
      },
    },
  },
} as const
test('resolves latest and inspects exports', async () => {
  const calls: Array<ContainerRunnerOptions> = []
  const fetchMock: FetchImplementation = async input => {
    let url: string
    if (input instanceof Request) {
      url = input.url
    } else if (input instanceof URL) {
      url = input.href
    } else {
      url = input
    }
    expect(url).toBe('https://registry.npmjs.org/demo')
    return Response.json({'dist-tags': {latest: '2.0.0'}})
  }
  const result = await inspectExports({
    name: 'demo',
    fetch: fetchMock,
    containerRunner: async options => {
      calls.push(options)
      return JSON.stringify(inspection)
    },
  })
  expect(result).toEqual(inspection)
  expect(calls).toEqual([
    {
      image: 'oven/bun:slim',
      name: 'demo',
      timeoutMs: 120_000,
      version: '2.0.0',
    },
  ])
})
test('passes an explicit Docker daemon to the container runner', async () => {
  let runnerOptions: ContainerRunnerOptions | undefined
  const result = await inspectExports({
    name: 'demo',
    version: '1.0.0',
    dockerHost: 'tcp://docker.example:2375',
    containerRunner: async options => {
      runnerOptions = options
      return JSON.stringify(inspection)
    },
  })
  expect(result).toEqual(inspection)
  expect(runnerOptions?.dockerHost).toBe('tcp://docker.example:2375')
})
test('uses an explicit version without fetching the registry', async () => {
  let fetched = false
  const result = await inspectExports({
    name: '@scope/demo',
    version: '1.2.3',
    fetch: async () => {
      fetched = true
      return new Response(null, {status: 500})
    },
    containerRunner: async options => {
      expect(options.version).toBe('1.2.3')
      return JSON.stringify(inspection)
    },
  })
  expect(fetched).toBe(false)
  expect(result).toEqual(inspection)
})
test('fails gracefully', async () => {
  expect(await inspectExports({
    name: 'broken',
    version: '1.0.0',
    containerRunner: async () => {
      throw new Error('Docker unavailable')
    },
  })).toBeUndefined()
})
test('describes constructable functions as classes', async () => {
  const result = await inspectExports({
    name: 'demo',
    version: '1.0.0',
    containerRunner: async () => JSON.stringify({
      '.': {
        named: {
          Demo: 'class',
          arrow: 'function',
          asyncValue: 'async function',
        },
      },
    }),
  })
  expect(result).toEqual({
    '.': {
      named: {
        Demo: 'class',
        arrow: 'function',
        asyncValue: 'async function',
      },
    },
  })
})
