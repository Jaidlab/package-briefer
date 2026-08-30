import type mainCommand from './mainCommand.ts'
import type {CommandHandler} from 'clerc'

import {createExternalCaches} from 'inspect-npm-package'
import markdownifyInspection from 'markdownify-inspection'

import {PackageBrieferServer} from '../PackageBrieferServer.ts'

const assertNumber = (name: string, value: number, minimum = 0) => {
  if (!Number.isFinite(value) || value < minimum) {
    throw new TypeError(`--${name} must be a number ≥ ${minimum}`)
  }
}
const assertInteger = (name: string, value: number, minimum = 0) => {
  if (!Number.isInteger(value) || value < minimum) {
    throw new TypeError(`--${name} must be an integer ≥ ${minimum}`)
  }
}

// eslint-disable-next-line typescript/no-misused-promises
export const run: CommandHandler<typeof mainCommand> = async context => {
  const {flags} = context
  const samplingOptions = {
    recentCommits: flags.recentCommits,
    recentlyCreatedIssues: flags.recentlyCreatedIssues,
    recentlyCreatedPullRequests: flags.recentlyCreatedPullRequests,
    recentlyUpdatedIssues: flags.recentlyUpdatedIssues,
    recentlyUpdatedPullRequests: flags.recentlyUpdatedPullRequests,
    recentContributors: flags.recentContributors,
    recentReleases: flags.recentReleases,
    recentVersions: flags.recentVersions,
    topContributors: flags.topContributors,
  }
  for (const [name, value] of Object.entries(samplingOptions)) {
    assertInteger(name.replaceAll(/[A-Z]/gu, letter => `-${letter.toLowerCase()}`), value, name === 'recentVersions' ? 1 : 0)
  }
  assertNumber('cache-seconds', flags.cacheSeconds)
  assertInteger('cache-items', flags.cacheItems)
  assertNumber('externals-cache-seconds', flags.externalsCacheSeconds)
  assertInteger('externals-cache-items', flags.externalsCacheItems)
  const externalCaches = flags.externalsCacheSeconds > 0 && flags.externalsCacheItems > 0 ? createExternalCaches({
    seconds: flags.externalsCacheSeconds,
    items: flags.externalsCacheItems,
  }) : undefined
  const inspectionOptions = {
    ...samplingOptions,
    ...externalCaches === undefined ? {} : {externalCaches},
    ...flags.dockerHost === undefined ? {} : {exportsDockerHost: flags.dockerHost},
  }
  const markdownify = flags.clank ? (inspection: Parameters<typeof markdownifyInspection>[0]) => markdownifyInspection(inspection, {clank: true}) : undefined
  const server = new PackageBrieferServer(undefined, markdownify, flags.cacheSeconds, inspectionOptions, flags.cacheItems).listen({
    hostname: flags.httpHostname,
    port: flags.httpPort,
  })
  console.log(`package-briefer listening on http://${server.hostname}:${server.port}`)
  console.log(`Example: http://${server.hostname}:${server.port}/npmjs.com/package/react/llms.txt`)
  await new Promise<void>(() => {})
}
