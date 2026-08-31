import type {Temporal} from '@js-temporal/polyfill'
import type {GitHubIssue, GitHubRepository} from 'inspect-npm-package'
import type MarkdownMap from 'markdown-map'

import flattenString from 'flatten-string'
import stringifyClank from 'stringify-clank'

import {formatDate} from './date.ts'
import pluralize from './pluralize.ts'

const pushIssueSample = (markdown: MarkdownMap, parentSection: Array<string>, title: string, sample: Array<GitHubIssue>, now: Temporal.Instant, recentSeconds: number) => {
  if (!sample.length) {
    return
  }
  const sampleSection = [...parentSection, title]
  for (const [index, issue] of sample.entries()) {
    const issueSection = [...sampleSection, String(issue.number)]
    markdown.extendSection(issueSection, [
      flattenString.lines(issue.author, formatDate(issue.date, now, recentSeconds), issue.status),
      issue.title,
    ])
    markdown.setSectionPriority(issueSection, sample.length - index)
  }
}

export const pushGitHubRepository = (markdown: MarkdownMap, repository: GitHubRepository, now: Temporal.Instant, recentSeconds: number, clank: boolean) => {
  const repositorySection = `github.com/${repository.slug.toLowerCase()}`
  markdown.ensureSection(repositorySection)
  const repositoryStats = flattenString.lines(repository.stars && pluralize(repository.stars, 'star'), repository.forks && pluralize(repository.forks, 'fork'))
  if (repositoryStats) {
    markdown.extendSection(repositorySection, repositoryStats)
  }
  if (repository.issues && (repository.issueSample.length || repository.issueCreatedSample.length)) {
    const issuesSection = [repositorySection, pluralize(repository.issues, 'issue')]
    pushIssueSample(markdown, issuesSection, 'recently updated', repository.issueSample, now, recentSeconds)
    pushIssueSample(markdown, issuesSection, 'recently created', repository.issueCreatedSample, now, recentSeconds)
  }
  if (repository.pullRequests && (repository.pullRequestSample.length || repository.pullRequestCreatedSample.length)) {
    const pullRequestsSection = [repositorySection, pluralize(repository.pullRequests, 'pull request')]
    pushIssueSample(markdown, pullRequestsSection, 'recently updated', repository.pullRequestSample, now, recentSeconds)
    pushIssueSample(markdown, pullRequestsSection, 'recently created', repository.pullRequestCreatedSample, now, recentSeconds)
  }
  if (repository.commits && repository.commitSample.length) {
    const commitsSection = [repositorySection, pluralize(repository.commits, 'commit')]
    for (const [index, commit] of repository.commitSample.entries()) {
      const commitSection = [...commitsSection, commit.hash]
      markdown.extendSection(commitSection, [
        flattenString.lines(commit.author, formatDate(commit.date, now, recentSeconds)),
        commit.message,
      ])
      markdown.setSectionPriority(commitSection, repository.commitSample.length - index)
    }
  }
  if (repository.releases && repository.releaseSample.length) {
    const releasesSection = [repositorySection, pluralize(repository.releases, 'release')]
    for (const [index, release] of repository.releaseSample.entries()) {
      const releaseSection = [...releasesSection, release.tag]
      markdown.extendSection(releaseSection, [
        flattenString.lines(release.author, formatDate(release.date, now, recentSeconds), release.status),
        ...release.name ? [release.name] : [],
      ])
      markdown.setSectionPriority(releaseSection, repository.releaseSample.length - index)
    }
  }
  if (repository.contributors && repository.contributorSample.length) {
    const contributorsSection = [repositorySection, pluralize(repository.contributors, 'contributor')]
    for (const [index, contributor] of repository.contributorSample.entries()) {
      const contributorSection = [...contributorsSection, contributor.name]
      markdown.setSectionPriority(contributorSection, repository.contributorSample.length - index)
      if (clank && contributor.profile) {
        markdown.extendSection(contributorSection, flattenString.lines(pluralize(contributor.commits, 'commit'), stringifyClank({profile: contributor.profile})))
      } else {
        markdown.extendSection(contributorSection, pluralize(contributor.commits, 'commit'))
        if (contributor.profile) {
          const profile = contributor.profile
          const profileLines = flattenString.lines(profile.name && `name ${profile.name}`, profile.location && `location ${profile.location}`, profile.company && `company ${profile.company}`, profile.repositories && pluralize(profile.repositories, 'repository', 'repositories'), profile.followers && pluralize(profile.followers, 'follower'))
          if (profileLines) {
            markdown.extendSection([...contributorSection, 'profile'], profileLines)
          }
        }
      }
    }
  }
}
