import {defineCommand} from 'clerc'
import {defaultSamplingOptions} from 'inspect-npm-package'

const mainCommand = defineCommand({
  name: '',
  description: 'Serve npm package inspections over HTTP',
  flags: {
    httpHostname: {
      type: String,
      default: Bun.env.HOST ?? '127.0.0.1',
      description: 'HTTP hostname',
    },
    httpPort: {
      type: Number,
      default: Number(Bun.env.PORT ?? 944),
      description: 'HTTP port',
    },
    dockerHost: {
      type: String,
      default: Bun.env.DOCKER_HOST ?? Bun.env.EXPORTS_DOCKER_HOST,
      description: 'Docker daemon used for runtime export inspection',
    },
    clank: {
      type: Boolean,
      default: false,
      description: 'Use Clank for structured llms.txt blocks',
    },
    recentCommits: {
      type: Number,
      default: defaultSamplingOptions.recentCommits,
      description: 'Number of recent GitHub commits',
    },
    recentlyCreatedPullRequests: {
      type: Number,
      default: defaultSamplingOptions.recentlyCreatedPullRequests,
      description: 'Number of recently created GitHub pull requests',
    },
    recentlyUpdatedPullRequests: {
      type: Number,
      default: defaultSamplingOptions.recentlyUpdatedPullRequests,
      description: 'Number of recently updated GitHub pull requests',
    },
    recentlyCreatedIssues: {
      type: Number,
      default: defaultSamplingOptions.recentlyCreatedIssues,
      description: 'Number of recently created GitHub issues',
    },
    recentlyUpdatedIssues: {
      type: Number,
      default: defaultSamplingOptions.recentlyUpdatedIssues,
      description: 'Number of recently updated GitHub issues',
    },
    topContributors: {
      type: Number,
      default: defaultSamplingOptions.topContributors,
      description: 'Number of top GitHub contributors',
    },
    recentContributors: {
      type: Number,
      default: defaultSamplingOptions.recentContributors,
      description: 'Number of recent GitHub contributors',
    },
    recentReleases: {
      type: Number,
      default: defaultSamplingOptions.recentReleases,
      description: 'Number of recent GitHub releases',
    },
    recentVersions: {
      type: Number,
      default: defaultSamplingOptions.recentVersions,
      description: 'Number of recent npm versions shown for every tag',
    },
  },
// eslint-disable-next-line typescript/no-misused-promises
}, async context => {
  const {run} = await import('./main.ts')
  await run(context)
})

export default mainCommand
