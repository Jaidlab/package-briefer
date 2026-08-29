import type mainCommand from './mainCommand.ts'
import type {CommandHandler} from 'clerc'

import {PackageBrieferServer} from '../PackageBrieferServer.ts'

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
  const server = new PackageBrieferServer(undefined, undefined, undefined, samplingOptions).listen({
    hostname: flags.httpHostname,
    port: flags.httpPort,
  })
  console.log(`package-briefer listening on http://${server.hostname}:${server.port}`)
  console.log(`Example: http://${server.hostname}:${server.port}/npmjs.com/package/react/llms.txt`)
  await new Promise<void>(() => {})
}
