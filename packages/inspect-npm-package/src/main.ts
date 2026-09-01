import type {ExternalCaches} from './lib/ExternalCacheStorage.ts'
import type {FetchImplementation, NpmPackument, PackumentVersion} from './lib/NpmRegistryClient.ts'
import type {BriefPackage, BriefRelease, FocusedRelease, Inspection, TaggedRelease} from './lib/types.ts'
import type {Inspection as ExportsInspection, Options as InspectExportsOptions} from 'inspect-exports'

import {Temporal} from '@js-temporal/polyfill'
import inspectExports from 'inspect-exports'

import {compareInstants, formatEasyDate} from './lib/date.ts'
import {defaultGitHubInspectionOptions, getGitHubSlug, getRepositoryUrl, GitHubClient} from './lib/GitHubClient.ts'
import {NpmRegistryClient, PackageVersionNotFoundError} from './lib/NpmRegistryClient.ts'
import {NpmxClient} from './lib/NpmxClient.ts'

export type ExportsInspectorOptions = Pick<InspectExportsOptions, 'dockerHost' | 'name' | 'version'>
export type ExportsInspector = (options: ExportsInspectorOptions) => Promise<ExportsInspection | undefined>

export type SamplingOptions = {
  recentCommits?: number
  recentContributors?: number
  recentlyCreatedIssues?: number
  recentlyCreatedPullRequests?: number
  recentlyUpdatedIssues?: number
  recentlyUpdatedPullRequests?: number
  recentReleases?: number
  recentVersions?: number
  topContributors?: number
}

export const defaultSamplingOptions = {
  ...defaultGitHubInspectionOptions,
  recentVersions: 3,
} satisfies Required<SamplingOptions>

export type Options = SamplingOptions & {
  exportsDockerHost?: string
  exportsInspector?: ExportsInspector
  externalCaches?: ExternalCaches
  fetch?: FetchImplementation
  githubToken?: string
  name: string
  now?: Temporal.Instant
  onFocusedVersion?: (version: string) => void
  version?: string
}

const getReleaseChannel = (version: string) => {
  const hyphenIndex = version.indexOf('-')
  if (hyphenIndex === -1) {
    return
  }
  return version.slice(hyphenIndex + 1).split(/[+\-.]/u, 1)[0]
}
const getVersionRepository = (packument: NpmPackument, version: string) => packument.versions?.[version]?.repository
const getBriefPackage = (metadata: PackumentVersion): BriefPackage => {
  return {
    ...metadata.bin === undefined ? {} : {bin: metadata.bin},
    ...metadata.browser === undefined ? {} : {browser: metadata.browser},
    ...metadata.cpu === undefined ? {} : {cpu: metadata.cpu},
    ...metadata.dependencies === undefined ? {} : {dependencies: metadata.dependencies},
    ...metadata.description === undefined ? {} : {description: metadata.description},
    ...metadata.engines === undefined ? {} : {engines: metadata.engines},
    ...metadata.exports === undefined ? {} : {exports: metadata.exports},
    ...metadata.imports === undefined ? {} : {imports: metadata.imports},
    ...metadata.keywords === undefined ? {} : {keywords: metadata.keywords},
    ...metadata.main === undefined ? {} : {main: metadata.main},
    ...metadata.module === undefined ? {} : {module: metadata.module},
    ...metadata.name === undefined ? {} : {name: metadata.name},
    ...metadata.optionalDependencies === undefined ? {} : {optionalDependencies: metadata.optionalDependencies},
    ...metadata.os === undefined ? {} : {os: metadata.os},
    ...metadata.peerDependencies === undefined ? {} : {peerDependencies: metadata.peerDependencies},
    ...metadata.peerDependenciesMeta === undefined ? {} : {peerDependenciesMeta: metadata.peerDependenciesMeta},
    ...metadata.sideEffects === undefined ? {} : {sideEffects: metadata.sideEffects},
    ...metadata.type === undefined ? {} : {type: metadata.type},
    ...metadata.types === undefined ? {} : {types: metadata.types},
    ...metadata.typesVersions === undefined ? {} : {typesVersions: metadata.typesVersions},
    ...metadata.typings === undefined ? {} : {typings: metadata.typings},
  }
}
const inspectNpmPackage = async (options: Options): Promise<Inspection> => {
  const fetchImplementation = options.fetch ?? fetch
  const npm = new NpmRegistryClient(fetchImplementation, options.externalCaches?.npm)
  const npmx = new NpmxClient(fetchImplementation, options.externalCaches?.npmx)
  const github = new GitHubClient(fetchImplementation, options.githubToken)
  const packument = await npm.getPackument(options.name)
  const versions = packument.versions ?? {}
  const times = packument.time ?? {}
  const now = options.now ?? Temporal.Now.instant()
  const sampling = {
    ...defaultSamplingOptions,
    ...options,
  }
  const latestVersion = packument['dist-tags']?.latest
  if (!latestVersion) {
    throw new Error(`npm package ${packument.name} has no latest release`)
  }
  const focusedVersion = options.version === undefined ? latestVersion : packument['dist-tags']?.[options.version] ?? options.version
  const versionEntries = Object.entries(versions)
    .map(([version, metadata]) => ({
      version,
      metadata,
      published: times[version],
    }))
    .filter((entry): entry is typeof entry & {metadata: NonNullable<typeof entry.metadata>
      published: string} => Boolean(entry.metadata && entry.published))
  const focusedEntry = versionEntries.find(entry => entry.version === focusedVersion)
  if (!focusedEntry) {
    throw new PackageVersionNotFoundError(packument.name, focusedVersion)
  }
  options.onFocusedVersion?.(focusedVersion)
  const exportsPromise = (async () => {
    try {
      return await (options.exportsInspector ?? inspectExports)({
        ...options.exportsDockerHost === undefined ? {} : {dockerHost: options.exportsDockerHost},
        name: packument.name,
        version: focusedVersion,
      })
    } catch {
    }
  })()
  const releaseCache = new Map<string, Promise<BriefRelease>>
  const createRelease = (entry: typeof versionEntries[number]) => {
    let releasePromise = releaseCache.get(entry.version)
    if (!releasePromise) {
      releasePromise = (async () => {
        const hasDependencies = Object.keys(entry.metadata.dependencies ?? {}).length > 0 || Object.keys(entry.metadata.optionalDependencies ?? {}).length > 0
        const [stats, dependencies] = await Promise.all([
          npm.getReleaseStats(entry.metadata),
          hasDependencies ? npmx.getDependencyStats(packument.name, entry.version) : Promise.resolve(),
        ])
        return {
          version: entry.version,
          ...dependencies && dependencies.count > 0 ? {dependencies} : {},
          ...stats.files === undefined ? {} : {files: stats.files},
          ...stats.size === undefined ? {} : {size: stats.size},
          date: formatEasyDate(entry.published, now),
        }
      })()
      releaseCache.set(entry.version, releasePromise)
    }
    return releasePromise
  }
  const taggedEntries = Object.entries(packument['dist-tags'] ?? {}).toSorted(([, versionA], [, versionB]) => {
    const publishedA = times[versionA]
    const publishedB = times[versionB]
    if (!publishedA || !publishedB) {
      return 0
    }
    return compareInstants(publishedB, publishedA)
  })
  const tags = Object.fromEntries(await Promise.all(taggedEntries.map(async ([tag, version]) => {
    const metadata = versions[version]
    const published = times[version]
    if (!metadata || !published) {
      throw new Error(`npm metadata is incomplete for ${packument.name}@${version}`)
    }
    const currentEntry = {
      version,
      metadata,
      published,
    }
    const release = await createRelease(currentEntry)
    const channel = getReleaseChannel(version)
    const previousEntries = versionEntries
      .filter(entry => entry.version !== version && getReleaseChannel(entry.version) === channel && compareInstants(entry.published, published) <= 0)
      .toSorted((a, b) => compareInstants(b.published, a.published))
      .slice(0, Math.max(0, sampling.recentVersions - 1))
    const previous = await Promise.all(previousEntries.map(createRelease))
    const taggedRelease: TaggedRelease = {
      ...release,
      ...previous.length ? {previous} : {},
    }
    return [tag, taggedRelease] as const
  })))
  const firstEntry = versionEntries.toSorted((a, b) => compareInstants(a.published, b.published)).at(0)
  if (!firstEntry) {
    throw new Error(`npm package ${packument.name} has no published releases`)
  }
  const repositorySource = packument.repository ?? getVersionRepository(packument, focusedVersion)
  const repositoryUrl = getRepositoryUrl(repositorySource)
  const githubSlug = getGitHubSlug(repositorySource)
  let repositoryPromise: Promise<Inspection['repository']>
  if (githubSlug) {
    repositoryPromise = (async () => ({
      github: await github.getRepository(githubSlug, now, {
        recentCommits: sampling.recentCommits,
        recentlyCreatedIssues: sampling.recentlyCreatedIssues,
        recentlyCreatedPullRequests: sampling.recentlyCreatedPullRequests,
        recentlyUpdatedIssues: sampling.recentlyUpdatedIssues,
        recentlyUpdatedPullRequests: sampling.recentlyUpdatedPullRequests,
        recentContributors: sampling.recentContributors,
        recentReleases: sampling.recentReleases,
        topContributors: sampling.topContributors,
      }),
    }))()
  } else {
    repositoryPromise = Promise.resolve(repositoryUrl ? {url: repositoryUrl} : undefined)
  }
  const [focusedRelease, first, repository, exportsInspection] = await Promise.all([
    createRelease(focusedEntry),
    createRelease(firstEntry),
    repositoryPromise,
    exportsPromise,
  ])
  const focused: FocusedRelease = {
    ...focusedRelease,
    package: getBriefPackage(focusedEntry.metadata),
  }
  return {
    ...exportsInspection === undefined ? {} : {exports: exportsInspection},
    focused,
    releases: {
      total: Object.keys(versions).length,
      tags,
      first,
    },
    ...repository === undefined ? {} : {repository},
  }
}

export {createExternalCaches, ExternalCacheStorage} from './lib/ExternalCacheStorage.ts'
export type {ExternalCaches, ExternalCacheStorageOptions} from './lib/ExternalCacheStorage.ts'
export {defaultGitHubInspectionOptions, getGitHubSlug, getRepositoryUrl, GitHubClient} from './lib/GitHubClient.ts'
export type {GitHubInspectionOptions} from './lib/GitHubClient.ts'
export {getTarStats, getTarUnpackedSize, NpmRegistryClient, PackageNotFoundError, PackageVersionNotFoundError} from './lib/NpmRegistryClient.ts'
export type {FetchImplementation, NpmPackument, PackumentVersion, ReleaseStats, Repository} from './lib/NpmRegistryClient.ts'
export {NpmxClient} from './lib/NpmxClient.ts'
export type {DependencyStats as NpmxDependencyStats} from './lib/NpmxClient.ts'
export type {BriefPackage, BriefRelease, DependencyStats, EasyDate, FocusedRelease, ForeignRepository, GitHubCommit, GitHubContributor, GitHubContributorProfile, GitHubIssue, GitHubPullRequest, GitHubRelease, GitHubRepository, Inspection, TaggedRelease} from './lib/types.ts'
export default inspectNpmPackage
