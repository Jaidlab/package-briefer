import type {FetchImplementation} from './NpmRegistryClient.ts'
import type {GitHubCommit, GitHubContributor, GitHubIssue, GitHubRelease, GitHubRepository} from './types.ts'
import type {Temporal} from '@js-temporal/polyfill'

import {formatEasyDate} from './date.ts'

export type GitHubInspectionOptions = {
  recentCommits?: number
  recentContributors?: number
  recentlyCreatedIssues?: number
  recentlyCreatedPullRequests?: number
  recentlyUpdatedIssues?: number
  recentlyUpdatedPullRequests?: number
  recentReleases?: number
  topContributors?: number
}

type GitHubApiRepository = {
  default_branch: string
  forks_count: number
  full_name: string
  owner: {
    login: string
    type: string
  }
  stargazers_count: number
}

type GitHubSearchItem = {
  created_at: string
  draft?: boolean
  number: number
  state: string
  title: string
  updated_at: string
  user: {
    login: string
  }
}

type GitHubSearch = {
  items: Array<GitHubSearchItem>
  total_count: number
}

type GitHubApiCommit = {
  author: {
    login: string
  } | null
  commit: {
    author: {
      date: string
      name: string
    } | null
    committer: {
      date: string
      name: string
    } | null
    message: string
  }
  sha: string
}

type GitHubApiRelease = {
  author: {
    login: string
  }
  created_at: string
  draft: boolean
  name: string | null
  prerelease: boolean
  published_at: string | null
  tag_name: string
}

type GitHubApiContributor = {
  contributions: number
  login?: string
  name?: string
}

export const defaultGitHubInspectionOptions = {
  recentCommits: 3,
  recentlyCreatedIssues: 5,
  recentlyCreatedPullRequests: 5,
  recentlyUpdatedIssues: 5,
  recentlyUpdatedPullRequests: 5,
  recentContributors: 3,
  recentReleases: 5,
  topContributors: 3,
} satisfies Required<GitHubInspectionOptions>

type GitHubApiUser = {
  company: string | null
  followers: number
  location: string | null
  name: string | null
  public_repos: number
}

const assertOk = (response: Response, label: string) => {
  if (!response.ok) {
    throw new Error(`Could not fetch GitHub ${label}: HTTP ${response.status}`)
  }
}
const getPaginatedCount = async (response: Response, label: string) => {
  assertOk(response, label)
  const link = response.headers.get('link')
  const lastPage = /[&?]page=(\d+)>; rel="last"/u.exec(link ?? '')?.[1]
  if (lastPage) {
    return Number(lastPage)
  }
  const items = await response.json() as Array<unknown>
  return items.length
}
const getContributorName = (contributor: GitHubApiContributor) => contributor.login?.toLowerCase() ?? contributor.name
const getReleaseStatus = (release: GitHubApiRelease) => {
  if (release.draft) {
    return 'draft'
  }
  if (release.prerelease) {
    return 'prerelease'
  }
  return 'published'
}
const getCommitAuthor = (commit: GitHubApiCommit) => {
  return commit.author?.login.toLowerCase() ?? commit.commit.author?.name ?? commit.commit.committer?.name ?? 'unknown'
}
const getCommitDate = (commit: GitHubApiCommit) => {
  return commit.commit.author?.date ?? commit.commit.committer?.date
}
const getCommitSummary = (message: string) => message.split(/\r?\n/u, 1)[0].trim()

export const getRepositoryUrl = (repository: {url?: string} | string | undefined) => {
  if (typeof repository === 'string') {
    return repository
  }
  return repository?.url
}

export const getGitHubSlug = (repository: {url?: string} | string | undefined) => {
  const url = getRepositoryUrl(repository)
  if (!url) {
    return
  }
  const match = /(?:github\.com[/:]|^~github:)([^\s/]+)\/([^\s#/]+)/iu.exec(url)
  if (!match) {
    return
  }
  return `${match[1]}/${match[2].replace(/\.git$/iu, '')}`
}

export class GitHubClient {
  private readonly headers: Record<string, string>

  constructor(private readonly fetchImplementation: FetchImplementation = fetch,
    token = Bun.env.GITHUB_TOKEN ?? Bun.env.GH_TOKEN) {
    this.headers = {
      accept: 'application/vnd.github+json',
      'user-agent': 'inspect-npm-package',
      ...token ? {authorization: `Bearer ${token}`} : {},
    }
  }

  async getRepository(slug: string, now: Temporal.Instant, options: GitHubInspectionOptions = {}): Promise<GitHubRepository> {
    const limits = {
      ...defaultGitHubInspectionOptions,
      ...options,
    }
    const repositoryPromise = this.fetchImplementation(`https://api.github.com/repos/${slug}`, {headers: this.headers})
    const releaseCountPromise = this.fetchImplementation(`https://api.github.com/repos/${slug}/releases?per_page=1`, {headers: this.headers})
    const contributorCountPromise = this.fetchImplementation(`https://api.github.com/repos/${slug}/contributors?per_page=1&anon=true`, {headers: this.headers})
    const commitCountPromise = this.fetchImplementation(`https://api.github.com/repos/${slug}/commits?per_page=1`, {headers: this.headers})
    const [repositoryResponse, issues, issueCreated, pullRequests, pullRequestCreated, releaseCountResponse, releaseSampleData, contributorCountResponse, contributorData, commitCountResponse, commitData] = await Promise.all([
      repositoryPromise,
      this.getSearch(slug, 'issue', 'updated', limits.recentlyUpdatedIssues),
      this.getSearch(slug, 'issue', 'created', limits.recentlyCreatedIssues),
      this.getSearch(slug, 'pr', 'updated', limits.recentlyUpdatedPullRequests),
      this.getSearch(slug, 'pr', 'created', limits.recentlyCreatedPullRequests),
      releaseCountPromise,
      this.getPagedArray<GitHubApiRelease>(`https://api.github.com/repos/${slug}/releases`, limits.recentReleases, `releases for ${slug}`),
      contributorCountPromise,
      this.getPagedArray<GitHubApiContributor>(`https://api.github.com/repos/${slug}/contributors?anon=true`, limits.recentContributors ? Math.max(100, limits.topContributors) : limits.topContributors, `contributors for ${slug}`),
      commitCountPromise,
      this.getCommitData(slug, limits.recentCommits, limits.recentContributors),
    ])
    assertOk(repositoryResponse, `repository ${slug}`)
    const [repository, releases, contributors, commits] = await Promise.all([
      repositoryResponse.json() as Promise<GitHubApiRepository>,
      getPaginatedCount(releaseCountResponse, `releases for ${slug}`),
      getPaginatedCount(contributorCountResponse, `contributors for ${slug}`),
      getPaginatedCount(commitCountResponse, `commits for ${slug}`),
    ])
    const issueSample = issues.items.map(item => this.mapIssue(item, now, 'updated'))
    const issueCreatedSample = issueCreated.items.map(item => this.mapIssue(item, now, 'created'))
    const pullRequestSample = pullRequests.items.map(item => this.mapIssue(item, now, 'updated', item.draft ? 'draft' : item.state))
    const pullRequestCreatedSample = pullRequestCreated.items.map(item => this.mapIssue(item, now, 'created', item.draft ? 'draft' : item.state))
    const commitSample = commitData.slice(0, limits.recentCommits).map(commit => this.mapCommit(commit, now))
    const releaseSample = releaseSampleData.map(release => this.mapRelease(release, now))
    const contributorSample = await this.getContributorSample(slug, repository, contributorData, commitData, limits.topContributors, limits.recentContributors)
    return {
      slug: repository.full_name,
      issues: issues.total_count,
      issueCreatedSample,
      issueSample,
      pullRequests: pullRequests.total_count,
      pullRequestCreatedSample,
      pullRequestSample,
      commits,
      commitSample,
      stars: repository.stargazers_count,
      forks: repository.forks_count,
      releases,
      releaseSample,
      contributors,
      contributorSample,
    }
  }

  private async getAuthorCommitCount(slug: string, author: string) {
    const url = new URL(`https://api.github.com/repos/${slug}/commits`)
    url.searchParams.set('author', author)
    url.searchParams.set('per_page', '1')
    const response = await this.fetchImplementation(url, {headers: this.headers})
    return getPaginatedCount(response, `commits by ${author} for ${slug}`)
  }

  private async getCommitData(slug: string, recentCommits: number, recentContributors: number) {
    if (!recentCommits && !recentContributors) {
      return []
    }
    const commits: Array<GitHubApiCommit> = []
    const contributorNames = new Set<string>
    let page = 1
    while (true) {
      const url = new URL(`https://api.github.com/repos/${slug}/commits`)
      url.searchParams.set('per_page', '100')
      url.searchParams.set('page', String(page))
      const response = await this.fetchImplementation(url, {headers: this.headers})
      assertOk(response, `commits for ${slug}`)
      const pageCommits = await response.json() as Array<GitHubApiCommit>
      commits.push(...pageCommits)
      for (const commit of pageCommits) {
        if (commit.author?.login) {
          contributorNames.add(commit.author.login.toLowerCase())
        }
      }
      if (commits.length >= recentCommits && contributorNames.size >= recentContributors || pageCommits.length < 100) {
        return commits
      }
      page++
    }
  }

  private async getContributorSample(slug: string, repository: GitHubApiRepository, contributorData: Array<GitHubApiContributor>, commitData: Array<GitHubApiCommit>, topContributorCount: number, recentContributorCount: number) {
    const contributorsByName = new Map<string, number>
    for (const contributor of contributorData) {
      const name = getContributorName(contributor)
      if (name) {
        contributorsByName.set(name.toLowerCase(), contributor.contributions)
      }
    }
    const names: Array<string> = []
    const addName = (name: string | undefined) => {
      if (name && !names.some(item => item.toLowerCase() === name.toLowerCase())) {
        names.push(name)
      }
    }
    if (repository.owner.type === 'User') {
      addName(repository.owner.login.toLowerCase())
    }
    for (const contributor of contributorData.slice(0, topContributorCount)) {
      addName(getContributorName(contributor))
    }
    const recentNames: Array<string> = []
    for (const commit of commitData) {
      const name = commit.author?.login.toLowerCase()
      if (!name || recentNames.includes(name)) {
        continue
      }
      recentNames.push(name)
      if (recentNames.length === recentContributorCount) {
        break
      }
    }
    for (const name of recentNames) {
      addName(name)
    }
    return Promise.all(names.map(async name => {
      const cachedCount = contributorsByName.get(name.toLowerCase())
      const [commits, profile] = await Promise.all([
        cachedCount ?? this.getAuthorCommitCount(slug, name),
        this.getUserProfile(name),
      ])
      return {
        name,
        commits,
        ...profile ? {profile} : {},
      } satisfies GitHubContributor
    }))
  }

  private async getPagedArray<T>(input: string, count: number, label: string) {
    if (!count) {
      return []
    }
    const result: Array<T> = []
    let page = 1
    while (result.length < count) {
      const url = new URL(input)
      url.searchParams.set('per_page', String(Math.min(100, count - result.length)))
      url.searchParams.set('page', String(page))
      const response = await this.fetchImplementation(url, {headers: this.headers})
      assertOk(response, label)
      const items = await response.json() as Array<T>
      result.push(...items)
      if (items.length < Number(url.searchParams.get('per_page'))) {
        break
      }
      page++
    }
    return result.slice(0, count)
  }

  private async getSearch(slug: string, type: 'issue' | 'pr', sort: 'created' | 'updated', count: number): Promise<GitHubSearch> {
    const items: Array<GitHubSearchItem> = []
    let totalCount = 0
    let page = 1
    do {
      const url = new URL('https://api.github.com/search/issues')
      url.searchParams.set('q', `repo:${slug} is:${type} is:open`)
      url.searchParams.set('sort', sort)
      url.searchParams.set('order', 'desc')
      url.searchParams.set('per_page', String(Math.min(100, Math.max(1, count - items.length))))
      url.searchParams.set('page', String(page))
      const response = await this.fetchImplementation(url, {headers: this.headers})
      assertOk(response, `recently ${sort} ${type === 'pr' ? 'pull requests' : 'issues'} for ${slug}`)
      const search = await response.json() as GitHubSearch
      totalCount = search.total_count
      if (count) {
        items.push(...search.items)
      }
      const perPage = Number(url.searchParams.get('per_page'))
      if (!count || items.length >= count || search.items.length < perPage) {
        break
      }
      page++
    } while (items.length < count)
    return {
      total_count: totalCount,
      items: items.slice(0, count),
    }
  }

  private async getUserProfile(login: string) {
    try {
      const response = await this.fetchImplementation(`https://api.github.com/users/${login}`, {headers: this.headers})
      if (!response.ok) {
        return
      }
      const user = await response.json() as GitHubApiUser
      return {
        followers: user.followers,
        repositories: user.public_repos,
        ...user.name ? {name: user.name} : {},
        ...user.location ? {location: user.location} : {},
        ...user.company ? {company: user.company} : {},
      }
    } catch {
    }
  }

  private mapCommit(commit: GitHubApiCommit, now: Temporal.Instant): GitHubCommit {
    const date = getCommitDate(commit)
    if (!date) {
      throw new Error(`GitHub commit ${commit.sha} has no date`)
    }
    return {
      hash: commit.sha.slice(0, 6),
      author: getCommitAuthor(commit),
      date: formatEasyDate(date, now),
      message: getCommitSummary(commit.commit.message),
    }
  }

  private mapIssue(item: GitHubSearchItem, now: Temporal.Instant, dateKind: 'created' | 'updated', status = item.state): GitHubIssue {
    return {
      number: item.number,
      author: item.user.login.toLowerCase(),
      date: formatEasyDate(dateKind === 'created' ? item.created_at : item.updated_at, now),
      status,
      title: item.title,
    }
  }

  private mapRelease(release: GitHubApiRelease, now: Temporal.Instant): GitHubRelease {
    const name = release.name?.trim()
    return {
      tag: release.tag_name,
      author: release.author.login.toLowerCase(),
      date: formatEasyDate(release.published_at ?? release.created_at, now),
      status: getReleaseStatus(release),
      ...name && name !== release.tag_name ? {name} : {},
    }
  }
}
