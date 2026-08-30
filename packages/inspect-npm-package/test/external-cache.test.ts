import type {FetchImplementation, PackumentVersion} from '../src/main.ts'

import {expect, test} from 'bun:test'
import {gzipSync} from 'node:zlib'

import {createExternalCaches, ExternalCacheStorage, NpmRegistryClient, NpmxClient} from '../src/main.ts'

const createTarball = (content: string) => {
  const data = (new TextEncoder).encode(content)
  const header = new Uint8Array(512)
  header.set((new TextEncoder).encode('package/index.js'), 0)
  header.set((new TextEncoder).encode(`${data.byteLength.toString(8).padStart(11, '0')}\0`), 124)
  header[156] = 48
  const padding = new Uint8Array((512 - data.byteLength % 512) % 512)
  const tar = new Uint8Array(512 + data.byteLength + padding.byteLength + 1024)
  tar.set(header, 0)
  tar.set(data, 512)
  tar.set(padding, 512 + data.byteLength)
  return gzipSync(tar)
}
test('caches npm packuments across clients', async () => {
  let calls = 0
  const fetchMock: FetchImplementation = async () => {
    calls++
    return Response.json({name: 'demo'})
  }
  const caches = createExternalCaches({
    items: 100,
    seconds: 60,
  })
  const first = new NpmRegistryClient(fetchMock, caches.npm)
  const second = new NpmRegistryClient(fetchMock, caches.npm)
  expect(await first.getPackument('demo')).toEqual({name: 'demo'})
  expect(await second.getPackument('demo')).toEqual({name: 'demo'})
  expect(calls).toBe(1)
})
test('caches npm tarball stats across clients', async () => {
  let calls = 0
  const tarball = createTarball('hello')
  const fetchMock: FetchImplementation = async () => {
    calls++
    return new Response(tarball)
  }
  const caches = createExternalCaches({
    items: 100,
    seconds: 60,
  })
  const version: PackumentVersion = {
    dist: {tarball: 'https://registry.npmjs.org/demo/-/demo-1.0.0.tgz'},
  }
  const first = new NpmRegistryClient(fetchMock, caches.npm)
  const second = new NpmRegistryClient(fetchMock, caches.npm)
  expect(await first.getReleaseStats(version)).toEqual({
    files: 1,
    size: 5,
  })
  expect(await second.getReleaseStats(version)).toEqual({
    files: 1,
    size: 5,
  })
  expect(calls).toBe(1)
})
test('caches npmx dependency stats across clients', async () => {
  let calls = 0
  const fetchMock: FetchImplementation = async () => {
    calls++
    return Response.json({
      dependencyCount: 2,
      selfSize: 100,
      totalSize: 600,
    })
  }
  const caches = createExternalCaches({
    items: 100,
    seconds: 60,
  })
  const first = new NpmxClient(fetchMock, caches.npmx)
  const second = new NpmxClient(fetchMock, caches.npmx)
  expect(await first.getDependencyStats('demo', '1.0.0')).toEqual({
    count: 2,
    size: 500,
  })
  expect(await second.getDependencyStats('demo', '1.0.0')).toEqual({
    count: 2,
    size: 500,
  })
  expect(calls).toBe(1)
})
test('does not cache missing npmx results', async () => {
  let calls = 0
  const fetchMock: FetchImplementation = async () => {
    calls++
    return new Response(null, {status: 500})
  }
  const caches = createExternalCaches({
    items: 100,
    seconds: 60,
  })
  const first = new NpmxClient(fetchMock, caches.npmx)
  const second = new NpmxClient(fetchMock, caches.npmx)
  expect(await first.getDependencyStats('demo', '1.0.0')).toBeUndefined()
  expect(await second.getDependencyStats('demo', '1.0.0')).toBeUndefined()
  expect(calls).toBe(2)
})
test('expires external cache entries', async () => {
  const cache = new ExternalCacheStorage({
    items: 100,
    seconds: 0.01,
  })
  let calls = 0
  const factory = async () => ({value: ++calls})
  expect(await cache.getOrSet('demo', factory)).toEqual({value: 1})
  expect(await cache.getOrSet('demo', factory)).toEqual({value: 1})
  await Bun.sleep(20)
  expect(await cache.getOrSet('demo', factory)).toEqual({value: 2})
})
test('uses independent npm and npmx cache capacities', async () => {
  const caches = createExternalCaches({
    items: 1,
    seconds: 60,
  })
  let npmCalls = 0
  let npmxCalls = 0
  await caches.npm.getOrSet('a', async () => ({value: ++npmCalls}))
  await caches.npmx.getOrSet('x', async () => ({value: ++npmxCalls}))
  await caches.npm.getOrSet('b', async () => ({value: ++npmCalls}))
  expect(await caches.npmx.getOrSet('x', async () => ({value: ++npmxCalls}))).toEqual({value: 1})
  expect(npmCalls).toBe(2)
  expect(npmxCalls).toBe(1)
})
