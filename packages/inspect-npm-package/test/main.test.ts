import type {FetchImplementation} from '../src/main.ts'

import {expect, test} from 'bun:test'
import {gzipSync} from 'node:zlib'

import {Temporal} from '@js-temporal/polyfill'

import inspectNpmPackage, {PackageNotFoundError, PackageVersionNotFoundError} from '../src/main.ts'

const encodeTarString = (target: Uint8Array, offset: number, length: number, value: string) => {
  target.set((new TextEncoder).encode(value).subarray(0, length), offset)
}
const createTarball = (...files: Array<[string, string]>) => {
  const chunks: Array<Uint8Array> = []
  for (const [name, content] of files) {
    const data = (new TextEncoder).encode(content)
    const header = new Uint8Array(512)
    encodeTarString(header, 0, 100, name)
    encodeTarString(header, 124, 12, `${data.byteLength.toString(8).padStart(11, '0')}\0`)
    header[156] = 48
    chunks.push(header, data, new Uint8Array((512 - data.byteLength % 512) % 512))
  }
  chunks.push(new Uint8Array(1024))
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  const tar = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    tar.set(chunk, offset)
    offset += chunk.byteLength
  }
  return gzipSync(tar)
}
const firstTarball = createTarball(['package/a.txt', 'abcd'], ['package/b.txt', '123456'])
const oneFileTarball = createTarball(['package/index.js', 'hello'])
const fetchMock: FetchImplementation = async input => {
  const url = input instanceof Request ? new URL(input.url) : new URL(input)
  if (url.hostname === 'registry.npmjs.org' && url.pathname === '/demo') {
    return Response.json({
      name: 'demo',
      'dist-tags': {
        latest: '2.0.0',
        beta: '3.0.0-beta.1',
      },
      time: {
        '1.0.0': '2020-01-02T03:04:05.000Z',
        '1.5.0': '2025-01-02T03:04:05.000Z',
        '2.0.0': '2026-06-01T12:30:00.000Z',
        '3.0.0-beta.1': '2026-08-01T09:10:11.000Z',
      },
      versions: {
        '1.0.0': {
          dist: {
            tarball: 'https://registry.npmjs.org/demo/-/demo-1.0.0.tgz',
          },
        },
        '1.5.0': {
          dist: {
            tarball: 'https://registry.npmjs.org/demo/-/demo-1.5.0.tgz',
            unpackedSize: 150,
          },
        },
        '2.0.0': {
          name: 'demo',
          description: 'Demo package',
          type: 'module',
          keywords: ['demo'],
          dependencies: {foo: '^1.0.0'},
          engines: {node: '>=20'},
          dist: {
            tarball: 'https://registry.npmjs.org/demo/-/demo-2.0.0.tgz',
            unpackedSize: 200,
          },
        },
        '3.0.0-beta.1': {
          dist: {
            tarball: 'https://registry.npmjs.org/demo/-/demo-3.0.0-beta.1.tgz',
            unpackedSize: 300,
          },
        },
      },
      repository: {
        url: 'git+https://github.com/jaid/demo.git',
      },
    })
  }
  if (url.pathname === '/demo/-/demo-1.0.0.tgz') {
    return new Response(firstTarball)
  }
  if (url.pathname.startsWith('/demo/-/demo-')) {
    return new Response(oneFileTarball)
  }
  if (url.hostname === 'npmx.dev' && url.pathname === '/api/registry/install-size/demo/v/2.0.0') {
    return Response.json({
      package: 'demo',
      version: '2.0.0',
      selfSize: 200,
      totalSize: 1700,
      dependencyCount: 2,
      dependencies: [],
    })
  }
  if (url.hostname === 'api.github.com' && url.pathname === '/repos/jaid/demo') {
    return Response.json({
      full_name: 'Jaid/demo',
      default_branch: 'main',
      owner: {
        login: 'Jaid',
        type: 'User',
      },
      stargazers_count: 3,
      forks_count: 1,
    })
  }
  if (url.hostname === 'api.github.com' && url.pathname === '/search/issues') {
    const query = url.searchParams.get('q')
    if (query === 'repo:jaid/demo is:issue is:open') {
      if (url.searchParams.get('sort') === 'created') {
        return Response.json({
          total_count: 7,
          items: [
            {
              created_at: '2026-08-29T14:00:00Z',
              number: 13,
              state: 'open',
              title: 'New demo issue',
              updated_at: '2026-08-29T15:00:00Z',
              user: {login: 'carol'},
            },
          ],
        })
      }
      return Response.json({
        total_count: 7,
        items: [
          {
            created_at: '2026-08-20T18:00:00Z',
            number: 11,
            state: 'open',
            title: 'Fix demo issue',
            updated_at: '2026-08-28T18:00:00Z',
            user: {login: 'alice'},
          },
        ],
      })
    }
    if (query === 'repo:jaid/demo is:pr is:open') {
      if (url.searchParams.get('sort') === 'created') {
        return Response.json({
          total_count: 2,
          items: [
            {
              created_at: '2026-08-29T13:00:00Z',
              number: 14,
              state: 'open',
              title: 'New demo PR',
              updated_at: '2026-08-29T13:30:00Z',
              user: {login: 'dave'},
            },
          ],
        })
      }
      return Response.json({
        total_count: 2,
        items: [
          {
            created_at: '2026-08-20T12:00:00Z',
            number: 12,
            state: 'open',
            draft: true,
            title: 'Improve demo',
            updated_at: '2026-08-29T12:00:00Z',
            user: {login: 'bob'},
          },
        ],
      })
    }
  }
  if (url.hostname === 'api.github.com' && url.pathname === '/users/jaid') {
    return Response.json({
      company: 'Jaid Labs',
      followers: 42,
      location: 'Berlin',
      name: 'Jaid',
      public_repos: 76,
    })
  }
  if (url.hostname === 'api.github.com' && url.pathname === '/repos/jaid/demo/releases') {
    if (url.searchParams.get('per_page') === '1') {
      return Response.json([{}], {
        headers: {link: '<https://api.github.com/repositories/1/releases?per_page=1&page=4>; rel="last"'},
      })
    }
    return Response.json([
      {
        author: {login: 'Jaid'},
        created_at: '2026-07-01T00:00:00Z',
        draft: false,
        name: 'Demo 2',
        prerelease: false,
        published_at: '2026-07-01T00:00:00Z',
        tag_name: 'v2.0.0',
      },
    ])
  }
  if (url.hostname === 'api.github.com' && url.pathname === '/repos/jaid/demo/contributors') {
    if (url.searchParams.get('per_page') === '1') {
      return Response.json([{}], {
        headers: {link: '<https://api.github.com/repositories/1/contributors?per_page=1&page=6>; rel="last"'},
      })
    }
    return Response.json([
      {
        login: 'Jaid',
        contributions: 20,
      },
      {
        login: 'top2',
        contributions: 15,
      },
      {
        login: 'top3',
        contributions: 12,
      },
      {
        login: 'recent1',
        contributions: 4,
      },
      {
        login: 'recent2',
        contributions: 3,
      },
      {
        login: 'recent3',
        contributions: 2,
      },
    ])
  }
  if (url.hostname === 'api.github.com' && url.pathname === '/repos/jaid/demo/commits') {
    if (url.searchParams.get('per_page') === '1') {
      return Response.json([{}], {
        headers: {link: '<https://api.github.com/repositories/1/commits?per_page=1&page=9>; rel="last"'},
      })
    }
    return Response.json([
      {
        sha: 'abcdef123456',
        author: {login: 'recent1'},
        commit: {
          author: {
            name: 'Recent One',
            date: '2026-08-29T17:00:00Z',
          },
          committer: {
            name: 'Recent One',
            date: '2026-08-29T17:00:00Z',
          },
          message: 'First summary\n\nLong body',
        },
      },
      {
        sha: '123456abcdef',
        author: {login: 'recent2'},
        commit: {
          author: {
            name: 'Recent Two',
            date: '2026-08-29T16:00:00Z',
          },
          committer: {
            name: 'Recent Two',
            date: '2026-08-29T16:00:00Z',
          },
          message: 'Second summary',
        },
      },
      {
        sha: 'fedcba654321',
        author: {login: 'recent3'},
        commit: {
          author: {
            name: 'Recent Three',
            date: '2026-08-29T15:00:00Z',
          },
          committer: {
            name: 'Recent Three',
            date: '2026-08-29T15:00:00Z',
          },
          message: 'Third summary',
        },
      },
    ])
  }
  return new Response('not found', {status: 404})
}
const brokenFetch: FetchImplementation = async input => {
  const url = input instanceof Request ? new URL(input.url) : new URL(input)
  if (url.hostname === 'registry.npmjs.org' && url.pathname === '/broken') {
    return Response.json({
      name: 'broken',
      'dist-tags': {latest: '1.0.0'},
      time: {'1.0.0': '2026-08-01T00:00:00.000Z'},
      versions: {
        '1.0.0': {
          dist: {tarball: 'https://registry.npmjs.org/broken/-/broken-1.0.0.tgz'},
        },
      },
    })
  }
  if (url.pathname === '/broken/-/broken-1.0.0.tgz') {
    return new Response('not a gzip archive')
  }
  return new Response('not found', {status: 404})
}
const now = Temporal.Instant.from('2026-08-29T18:00:00Z')
test('inspects npm package metadata', async () => {
  const inspection = await inspectNpmPackage({
    name: 'demo',
    fetch: fetchMock,
    now,
    exportsDockerHost: 'tcp://docker.example:2375',
    exportsInspector: async options => {
      expect(options).toEqual({
        dockerHost: 'tcp://docker.example:2375',
        name: 'demo',
        version: '2.0.0',
      })
      return {
        '.': {
          named: {foo: 'function'},
        },
      }
    },
  })
  expect(Object.keys(inspection.releases.tags)).toEqual(['beta', 'latest'])
  expect(inspection).toEqual({
    exports: {
      '.': {
        named: {foo: 'function'},
      },
    },
    focused: {
      version: '2.0.0',
      dependencies: {
        count: 2,
        size: 1500,
      },
      files: 1,
      size: 200,
      date: {
        absolute: '1 Jun 2026 12:30:00',
        relative: '3 months ago',
      },
      package: {
        dependencies: {foo: '^1.0.0'},
        description: 'Demo package',
        engines: {node: '>=20'},
        keywords: ['demo'],
        name: 'demo',
        type: 'module',
      },
    },
    releases: {
      total: 4,
      tags: {
        beta: {
          version: '3.0.0-beta.1',
          files: 1,
          size: 300,
          date: {
            absolute: '1 Aug 2026 09:10:11',
            relative: '28 days ago',
          },
        },
        latest: {
          version: '2.0.0',
          dependencies: {
            count: 2,
            size: 1500,
          },
          files: 1,
          size: 200,
          date: {
            absolute: '1 Jun 2026 12:30:00',
            relative: '3 months ago',
          },
          previous: [
            {
              version: '1.5.0',
              files: 1,
              size: 150,
              date: {
                absolute: '2 Jan 2025 03:04:05',
                relative: '2 years ago',
              },
            },
            {
              version: '1.0.0',
              files: 2,
              size: 10,
              date: {
                absolute: '2 Jan 2020 03:04:05',
                relative: '7 years ago',
              },
            },
          ],
        },
      },
      first: {
        version: '1.0.0',
        files: 2,
        size: 10,
        date: {
          absolute: '2 Jan 2020 03:04:05',
          relative: '7 years ago',
        },
      },
    },
    repository: {
      github: {
        slug: 'Jaid/demo',
        issues: 7,
        issueCreatedSample: [
          {
            number: 13,
            author: 'carol',
            date: {
              absolute: '29 Aug 2026 14:00:00',
              relative: '4 hours ago',
            },
            status: 'open',
            title: 'New demo issue',
          },
        ],
        issueSample: [
          {
            number: 11,
            author: 'alice',
            date: {
              absolute: '28 Aug 2026 18:00:00',
              relative: '1 day ago',
            },
            status: 'open',
            title: 'Fix demo issue',
          },
        ],
        pullRequests: 2,
        pullRequestCreatedSample: [
          {
            number: 14,
            author: 'dave',
            date: {
              absolute: '29 Aug 2026 13:00:00',
              relative: '5 hours ago',
            },
            status: 'open',
            title: 'New demo PR',
          },
        ],
        pullRequestSample: [
          {
            number: 12,
            author: 'bob',
            date: {
              absolute: '29 Aug 2026 12:00:00',
              relative: '6 hours ago',
            },
            status: 'draft',
            title: 'Improve demo',
          },
        ],
        commits: 9,
        commitSample: [
          {
            hash: 'abcdef',
            author: 'recent1',
            date: {
              absolute: '29 Aug 2026 17:00:00',
              relative: '1 hour ago',
            },
            message: 'First summary',
          },
          {
            hash: '123456',
            author: 'recent2',
            date: {
              absolute: '29 Aug 2026 16:00:00',
              relative: '2 hours ago',
            },
            message: 'Second summary',
          },
          {
            hash: 'fedcba',
            author: 'recent3',
            date: {
              absolute: '29 Aug 2026 15:00:00',
              relative: '3 hours ago',
            },
            message: 'Third summary',
          },
        ],
        stars: 3,
        forks: 1,
        releases: 4,
        releaseSample: [
          {
            tag: 'v2.0.0',
            author: 'jaid',
            date: {
              absolute: '1 Jul 2026 00:00:00',
              relative: '2 months ago',
            },
            status: 'published',
            name: 'Demo 2',
          },
        ],
        contributors: 6,
        contributorSample: [
          {
            name: 'jaid',
            commits: 20,
            profile: {
              company: 'Jaid Labs',
              followers: 42,
              location: 'Berlin',
              name: 'Jaid',
              repositories: 76,
            },
          },
          {
            name: 'top2',
            commits: 15,
          },
          {
            name: 'top3',
            commits: 12,
          },
          {
            name: 'recent1',
            commits: 4,
          },
          {
            name: 'recent2',
            commits: 3,
          },
          {
            name: 'recent3',
            commits: 2,
          },
        ],
      },
    },
  })
})
test('configures sample sizes', async () => {
  const inspection = await inspectNpmPackage({
    name: 'demo',
    fetch: fetchMock,
    now,
    recentCommits: 0,
    recentlyCreatedIssues: 0,
    recentlyCreatedPullRequests: 0,
    recentlyUpdatedIssues: 0,
    recentlyUpdatedPullRequests: 0,
    recentContributors: 0,
    recentReleases: 0,
    recentVersions: 1,
    topContributors: 0,
    exportsInspector: async () => {},
  })
  expect(inspection.releases.tags.latest.previous).toBeUndefined()
  expect(inspection.repository && 'github' in inspection.repository ? inspection.repository.github : undefined).toMatchObject({
    commitSample: [],
    issueCreatedSample: [],
    issueSample: [],
    pullRequestCreatedSample: [],
    pullRequestSample: [],
    releaseSample: [],
  })
  const github = inspection.repository && 'github' in inspection.repository ? inspection.repository.github : undefined
  expect(github?.contributorSample.map(contributor => contributor.name)).toEqual(['jaid'])
})
test('focuses an explicit version', async () => {
  let inspectedVersion = ''
  const inspection = await inspectNpmPackage({
    name: 'demo',
    version: '1.5.0',
    fetch: fetchMock,
    now,
    exportsInspector: async options => {
      inspectedVersion = options.version
      return {'.': {default: 'function'}}
    },
  })
  expect(inspectedVersion).toBe('1.5.0')
  expect(inspection.focused.version).toBe('1.5.0')
  expect(inspection.focused.package).toEqual({})
  expect(inspection.exports).toEqual({'.': {default: 'function'}})
})
test('throws PackageVersionNotFoundError', async () => {
  await expect(inspectNpmPackage({
    name: 'demo',
    version: '9.9.9',
    fetch: fetchMock,
    now,
  })).rejects.toBeInstanceOf(PackageVersionNotFoundError)
})
test('skips tarball-derived stats when the tarball is broken', async () => {
  expect(await inspectNpmPackage({
    name: 'broken',
    fetch: brokenFetch,
    now,
    exportsInspector: async () => {
      throw new Error('Docker unavailable')
    },
  })).toEqual({
    focused: {
      version: '1.0.0',
      date: {
        absolute: '1 Aug 2026 00:00:00',
        relative: '29 days ago',
      },
      package: {},
    },
    releases: {
      total: 1,
      tags: {
        latest: {
          version: '1.0.0',
          date: {
            absolute: '1 Aug 2026 00:00:00',
            relative: '29 days ago',
          },
        },
      },
      first: {
        version: '1.0.0',
        date: {
          absolute: '1 Aug 2026 00:00:00',
          relative: '29 days ago',
        },
      },
    },
  })
})
const fetchMissing: FetchImplementation = async () => new Response('not found', {status: 404})
test('throws PackageNotFoundError', async () => {
  await expect(inspectNpmPackage({
    name: 'missing',
    fetch: fetchMissing,
  })).rejects.toBeInstanceOf(PackageNotFoundError)
})
