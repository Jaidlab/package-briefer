import type {Inspection} from 'inspect-npm-package'

import {expect, test} from 'bun:test'

import {Temporal} from '@js-temporal/polyfill'

import markdownifyInspection from '../src/main.ts'

const inspection: Inspection = {
  exports: {
    modules: {
      '.': {
      default: 'function',
      named: {
        flatten: 'function',
      },
    },
      './lines': {
        default: 'function',
      },
    },
  },
  focused: {
    version: '0.2.0',
    dependencies: {
      count: 2,
      size: 1_561_456,
    },
    files: 7,
    size: 2606,
    date: {
      absolute: '17 May 2026 14:45:40',
      relative: '3 months ago',
    },
    package: {
      name: 'flatten-string',
    },
  },
  releases: {
    total: 3,
    tags: {
      latest: {
        version: '0.2.0',
        dependencies: {
          count: 2,
          size: 1_561_456,
        },
        files: 7,
        size: 2606,
        date: {
          absolute: '17 May 2026 14:45:40',
          relative: '3 months ago',
        },
        previous: [
          {
            version: '0.1.0',
            files: 5,
            size: 2000,
            date: {
              absolute: '16 May 2026 20:00:00',
              relative: '3 months ago',
            },
          },
          {
            version: '0.0.1',
            files: 4,
            size: 1601,
            date: {
              absolute: '16 May 2026 11:34:28',
              relative: '3 months ago',
            },
          },
        ],
      },
    },
    first: {
      version: '0.0.1',
      files: 4,
      size: 1601,
      date: {
        absolute: '16 May 2026 11:34:28',
        relative: '3 months ago',
      },
    },
  },
  repository: {
    github: {
      slug: 'Jaid/flatten-string',
      issues: 1,
      issueCreatedSample: [
        {
          number: 9,
          author: 'carol',
          date: {
            absolute: '29 Aug 2026 14:00:00',
            relative: '7 hours ago',
          },
          status: 'open',
          title: 'New flattening issue',
        },
      ],
      issueSample: [
        {
          number: 7,
          author: 'alice',
          date: {
            absolute: '28 Aug 2026 18:00:00',
            relative: '1 day ago',
          },
          status: 'open',
          title: 'Fix flattening',
        },
      ],
      pullRequests: 1,
      pullRequestCreatedSample: [
        {
          number: 10,
          author: 'dave',
          date: {
            absolute: '29 Aug 2026 13:00:00',
            relative: '8 hours ago',
          },
          status: 'open',
          title: 'New types PR',
        },
      ],
      pullRequestSample: [
        {
          number: 8,
          author: 'bob',
          date: {
            absolute: '29 Aug 2026 12:00:00',
            relative: '9 hours ago',
          },
          status: 'draft',
          title: 'Improve types',
        },
      ],
      commits: 3,
      commitSample: [
        {
          hash: 'abcdef',
          author: 'jaid',
          date: {
            absolute: '29 Aug 2026 20:00:00',
            relative: '1 hour ago',
          },
          message: 'Update package',
        },
        {
          hash: '123456',
          author: 'alice',
          date: {
            absolute: '29 Aug 2026 19:00:00',
            relative: '2 hours ago',
          },
          message: 'Fix test',
        },
        {
          hash: 'fedcba',
          author: 'bob',
          date: {
            absolute: '29 Aug 2026 18:00:00',
            relative: '3 hours ago',
          },
          message: 'Refactor exports',
        },
      ],
      stars: 0,
      forks: 0,
      releases: 1,
      releaseSample: [
        {
          tag: 'v0.2.0',
          author: 'jaid',
          date: {
            absolute: '17 May 2026 14:45:40',
            relative: '3 months ago',
          },
          status: 'published',
          name: 'Release 0.2.0',
        },
      ],
      contributors: 1,
      contributorSample: [
        {
          name: 'jaid',
          commits: 3,
          profile: {
            company: 'Jaid Labs',
            followers: 42,
            location: 'Berlin',
            name: 'Jaid',
            repositories: 76,
          },
        },
      ],
    },
  },
}
const now = Temporal.Instant.from('2026-08-29T20:53:11Z')
const expected = `# flatten-string 0.2.0

## package

{"name":"flatten-string"}

## exports

### flatten-string

{"default":"function","named":{"flatten":"function"}}

### flatten-string/lines

{"default":"function"}

# 3 npm releases

## tags

### latest

#### 0.2.0

17 May 2026, 3 months ago
2606 bytes in 7 files
1561456 bytes from 2 dependencies

#### 0.1.0

16 May 2026, 3 months ago
2000 bytes in 5 files

#### 0.0.1

16 May 2026, 3 months ago
1601 bytes in 4 files

## first

### 0.0.1

16 May 2026, 3 months ago
1601 bytes in 4 files

# github.com/jaid/flatten-string

## 1 issue

### recently updated

#### 7

alice
28 Aug 2026 18:00:00, 1 day ago
open

Fix flattening

### recently created

#### 9

carol
29 Aug 2026 14:00:00, 7 hours ago
open

New flattening issue

## 1 pull request

### recently updated

#### 8

bob
29 Aug 2026 12:00:00, 9 hours ago
draft

Improve types

### recently created

#### 10

dave
29 Aug 2026 13:00:00, 8 hours ago
open

New types PR

## 3 commits

### abcdef

jaid
29 Aug 2026 20:00:00, 1 hour ago

Update package

### 123456

alice
29 Aug 2026 19:00:00, 2 hours ago

Fix test

### fedcba

bob
29 Aug 2026 18:00:00, 3 hours ago

Refactor exports

## 1 release

### v0.2.0

jaid
17 May 2026, 3 months ago
published

Release 0.2.0

## 1 contributor

### jaid

3 commits

#### profile

name Jaid
location Berlin
company Jaid Labs
76 repositories
42 followers
`
test('markdownifies an inspection with tag history', () => {
  expect(markdownifyInspection(inspection, {now})).toBe(expected)
})
test('uses Clank for structured blocks when enabled', () => {
  const markdown = markdownifyInspection(inspection, {
    clank: true,
    now,
  })
  expect(markdown).toContain('# flatten-string 0.2.0\n\npackage { name flatten-string}\n\n## exports\n\n### default\n\nfunction\n\n### named\n\nflatten function\n\n## subpackage exports\n\n### lines\n\n#### default\n\nfunction\n\n# 3 npm releases')
  expect(markdown).toContain("### jaid\n\n3 commits\nprofile { company 'Jaid Labs' followers 42 location Berlin name Jaid repositories 76}\n")
  expect(markdown).not.toContain('## package')
  expect(markdown).toContain('## exports')
  expect(markdown).not.toContain('#### profile')
})
test('omits the root export path wrapper when it is the only entry point', () => {
  const rootOnlyInspection: Inspection = {
    ...inspection,
    exports: {
      modules: {
          '.': inspection.exports?.modules['.'] ?? {},
      },
    },
  }
  const markdown = markdownifyInspection(rootOnlyInspection, {now})
  expect(markdown).toContain('## exports\n\n{"default":"function","named":{"flatten":"function"}}')
  const clank = markdownifyInspection(rootOnlyInspection, {
    clank: true,
    now,
  })
  expect(clank).toContain('## exports\n\n### default\n\nfunction\n\n### named\n\nflatten function')
  expect(clank).not.toContain('exports {')
})
test('simplifies runtime export value descriptors in Markdown', () => {
  const descriptorInspection: Inspection = {
    ...inspection,
    exports: {
      modules: {
        '.': {
          named: {
            Children: {
              type: 'object',
              keys: ['map', 'forEach', 'count'],
            },
            blockFences: {
              type: 'array',
              length: 12,
            },
            version: {
              type: 'string',
              value: '19.2.8',
            },
          },
        },
        './runtime': {
          named: {
            internals: {
              type: 'object',
              keys: 42,
            },
          },
        },
      },
    },
  }
  const clank = markdownifyInspection(descriptorInspection, {
    clank: true,
    now,
  })
  expect(clank).toContain('### named\n\nChildren { entries [ map forEach count]} blockFences { items 12} version { string 19.2.8}')
  expect(clank).toContain('#### named\n\ninternals { entries 42}')
  expect(clank).not.toContain('type object')
  expect(clank).not.toContain('type string')
  expect(clank).not.toContain('type array')
  const markdown = markdownifyInspection({
    ...descriptorInspection,
    exports: {
      modules: {'.': descriptorInspection.exports?.modules['.'] ?? {}},
    },
  }, {now})
  expect(markdown).toContain('{"named":{"Children":{"entries":["map","forEach","count"]},"blockFences":{"items":12},"version":{"string":"19.2.8"}}}')
})
test('preserves symbol and non-enumerable export keys', () => {
  const markdown = markdownifyInspection({
    ...inspection,
    exports: {
      modules: {
        '.': {
          named: {
            Api: {
              type: 'class',
              keys: ['hidden', {symbol: 'token'}],
            },
          },
        },
      },
    },
  }, {now})
  expect(markdown).toContain('{"named":{"Api":{"type":"class","entries":["hidden",{"symbol":"token"}]}}}')
})
test('renders non-enumerable export patterns', () => {
  const markdown = markdownifyInspection({
    ...inspection,
    exports: {
      modules: {},
      patterns: [{
        enumerable: false,
        path: './*',
        targets: ['./index.js'],
      }],
    },
  }, {now})
  expect(markdown).toContain('## export patterns\n\n[{"enumerable":false,"path":"./*","targets":["./index.js"]}]')
})
test('renders export inspection failures', () => {
  const markdown = markdownifyInspection({
    ...inspection,
    exports: {
      modules: {},
      error: {
        name: 'Error',
        message: 'probe unavailable',
      },
      failures: {
        './broken': {
          name: 'TypeError',
          message: 'broken export',
        },
      },
    },
  }, {now})
  expect(markdown).toContain('## export inspection error\n\n{"name":"Error","message":"probe unavailable"}')
  expect(markdown).toContain('## export failures\n\n### flatten-string/broken\n\n{"name":"TypeError","message":"broken export"}')
})
test('includes npm metadata when the focused release is not visible', () => {
  const markdown = markdownifyInspection({
    ...inspection,
    focused: {
      version: '0.1.5',
      dependencies: {
        count: 1,
        size: 900,
      },
      files: 6,
      size: 2300,
      date: {
        absolute: '16 May 2026 21:00:00',
        relative: '3 months ago',
      },
      package: {name: 'flatten-string'},
    },
  }, {now})
  expect(markdown).toContain('# flatten-string 0.1.5\n\n## npm\n\n16 May 2026, 3 months ago\n2300 bytes in 6 files\n900 bytes from 1 dependency')
})
test('configures how recent a date must be to show its time', () => {
  const recentInspection: Inspection = {
    ...inspection,
    releases: {
      ...inspection.releases,
      tags: {
        latest: {
          ...inspection.releases.tags.latest,
          date: {
            absolute: '29 Aug 2026 11:53:11',
            relative: '9 hours ago',
          },
        },
      },
    },
  }
  expect(markdownifyInspection(recentInspection, {now})).toContain('29 Aug 2026 11:53:11, 9 hours ago')
  expect(markdownifyInspection(recentInspection, {
    now,
    recentSeconds: 8 * 60 * 60,
  })).toContain('29 Aug 2026, 9 hours ago')
})
test('omits empty GitHub blocks', () => {
  const markdown = markdownifyInspection({
    ...inspection,
    repository: {
      github: {
        commits: 0,
        commitSample: [],
        contributors: 0,
        contributorSample: [],
        forks: 0,
        issueCreatedSample: [],
        issues: 0,
        issueSample: [],
        pullRequestCreatedSample: [],
        pullRequests: 0,
        pullRequestSample: [],
        releases: 0,
        releaseSample: [],
        slug: 'Jaid/empty',
        stars: 0,
      },
    },
  }, {now})
  expect(markdown).toContain('# github.com/jaid/empty')
  expect(markdown).not.toContain('0 stars')
  expect(markdown).not.toContain('0 issues')
  expect(markdown).not.toContain('recently updated')
})
test('markdownifies a foreign repository', () => {
  const markdown = markdownifyInspection({
    ...inspection,
    repository: {url: 'https://gitlab.com/jaid/demo'},
  }, {now})
  expect(markdown).toContain('# https://gitlab.com/jaid/demo')
})
