import type {Inspection as ExportsInspection} from 'inspect-exports'
import type {PackageJson} from 'type-fest'

export type BriefPackage = Pick<PackageJson, 'bin' | 'browser' | 'cpu' | 'dependencies' | 'description' | 'engines' | 'exports' | 'imports' | 'keywords' | 'main' | 'module' | 'name' | 'optionalDependencies' | 'os' | 'peerDependencies' | 'peerDependenciesMeta' | 'sideEffects' | 'type' | 'types' | 'typesVersions' | 'typings'>

export type EasyDate = {
  absolute: string
  relative: string
}

export type DependencyStats = {
  count: number
  size: number
}

export type BriefRelease = {
  date: EasyDate
  dependencies?: DependencyStats
  files?: number
  size?: number
  version: string
}

export type TaggedRelease = BriefRelease & {
  previous?: Array<BriefRelease>
}

export type FocusedRelease = TaggedRelease & {
  package: BriefPackage
}

export type GitHubIssue = {
  author: string
  date: EasyDate
  number: number
  status: string
  title: string
}

export type GitHubPullRequest = GitHubIssue

export type GitHubCommit = {
  author: string
  date: EasyDate
  hash: string
  message: string
}

export type GitHubRelease = {
  author: string
  date: EasyDate
  name?: string
  status: string
  tag: string
}

export type GitHubContributorProfile = {
  company?: string
  followers: number
  location?: string
  name?: string
  repositories: number
}

export type GitHubContributor = {
  commits: number
  name: string
  profile?: GitHubContributorProfile
}

export type GitHubRepository = {
  commits: number
  commitSample: Array<GitHubCommit>
  contributors: number
  contributorSample: Array<GitHubContributor>
  forks: number
  issueCreatedSample: Array<GitHubIssue>
  issues: number
  issueSample: Array<GitHubIssue>
  pullRequestCreatedSample: Array<GitHubPullRequest>
  pullRequests: number
  pullRequestSample: Array<GitHubPullRequest>
  releases: number
  releaseSample: Array<GitHubRelease>
  slug: string
  stars: number
}

export type ForeignRepository = {
  url: string
}

export type Inspection = {
  exports?: ExportsInspection
  focused: FocusedRelease
  releases: {
    first: BriefRelease
    tags: Record<string, TaggedRelease>
    total: number
  }
  repository?: ForeignRepository | {
    github: GitHubRepository
  }
}
