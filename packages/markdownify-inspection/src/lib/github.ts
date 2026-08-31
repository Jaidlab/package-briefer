import type {Temporal} from '@js-temporal/polyfill'
import type {GitHubIssue, GitHubRepository} from 'inspect-npm-package'

import flattenString from 'flatten-string'
import stringifyClank from 'stringify-clank'

import {formatDate} from './date.ts'
import pluralize from './pluralize.ts'

const pushIssueSample = (paragraphs: Array<string>, title: string, sample: Array<GitHubIssue>, now: Temporal.Instant, recentSeconds: number) => {
  if (!sample.length) {
    return
  }
  paragraphs.push(`### ${title}`)
  for (const issue of sample) {
    paragraphs.push(`#### ${issue.number}`)
    paragraphs.push(flattenString.lines(issue.author, formatDate(issue.date, now, recentSeconds), issue.status))
    paragraphs.push(issue.title)
  }
}

export const pushGitHubRepository = (paragraphs: Array<string>, repository: GitHubRepository, now: Temporal.Instant, recentSeconds: number, clank: boolean) => {
  paragraphs.push(`# github.com/${repository.slug.toLowerCase()}`)
  const repositoryStats = flattenString.lines(repository.stars && pluralize(repository.stars, 'star'), repository.forks && pluralize(repository.forks, 'fork'))
  if (repositoryStats) {
    paragraphs.push(repositoryStats)
  }
  if (repository.issues && (repository.issueSample.length || repository.issueCreatedSample.length)) {
    paragraphs.push(`## ${pluralize(repository.issues, 'issue')}`)
    pushIssueSample(paragraphs, 'recently updated', repository.issueSample, now, recentSeconds)
    pushIssueSample(paragraphs, 'recently created', repository.issueCreatedSample, now, recentSeconds)
  }
  if (repository.pullRequests && (repository.pullRequestSample.length || repository.pullRequestCreatedSample.length)) {
    paragraphs.push(`## ${pluralize(repository.pullRequests, 'pull request')}`)
    pushIssueSample(paragraphs, 'recently updated', repository.pullRequestSample, now, recentSeconds)
    pushIssueSample(paragraphs, 'recently created', repository.pullRequestCreatedSample, now, recentSeconds)
  }
  if (repository.commits && repository.commitSample.length) {
    paragraphs.push(`## ${pluralize(repository.commits, 'commit')}`)
    for (const commit of repository.commitSample) {
      paragraphs.push(`### ${commit.hash}`)
      paragraphs.push(flattenString.lines(commit.author, formatDate(commit.date, now, recentSeconds)))
      paragraphs.push(commit.message)
    }
  }
  if (repository.releases && repository.releaseSample.length) {
    paragraphs.push(`## ${pluralize(repository.releases, 'release')}`)
    for (const release of repository.releaseSample) {
      paragraphs.push(`### ${release.tag}`)
      paragraphs.push(flattenString.lines(release.author, formatDate(release.date, now, recentSeconds), release.status))
      if (release.name) {
        paragraphs.push(release.name)
      }
    }
  }
  if (repository.contributors && repository.contributorSample.length) {
    paragraphs.push(`## ${pluralize(repository.contributors, 'contributor')}`)
    for (const contributor of repository.contributorSample) {
      paragraphs.push(`### ${contributor.name}`)
      if (clank && contributor.profile) {
        paragraphs.push(flattenString.lines(pluralize(contributor.commits, 'commit'), stringifyClank({profile: contributor.profile})))
      } else {
        paragraphs.push(pluralize(contributor.commits, 'commit'))
        if (contributor.profile) {
          const profile = contributor.profile
          const profileLines = flattenString.lines(profile.name && `name ${profile.name}`, profile.location && `location ${profile.location}`, profile.company && `company ${profile.company}`, profile.repositories && pluralize(profile.repositories, 'repository', 'repositories'), profile.followers && pluralize(profile.followers, 'follower'))
          if (profileLines) {
            paragraphs.push('#### profile', profileLines)
          }
        }
      }
    }
  }
}
