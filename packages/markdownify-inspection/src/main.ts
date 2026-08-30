import type {BriefRelease, EasyDate, GitHubIssue, Inspection} from 'inspect-npm-package'

import {Temporal} from '@js-temporal/polyfill'
import flattenString from 'flatten-string'
import stringifyClank from 'stringify-clank'

export type Options = {
  clank?: boolean
  now?: Temporal.Instant
  recentSeconds?: number
}

const defaultRecentSeconds = Temporal.Duration.from({hours: 48}).total('seconds')
const monthNumbers = {
  Jan: 1,
  Feb: 2,
  Mar: 3,
  Apr: 4,
  May: 5,
  Jun: 6,
  Jul: 7,
  Aug: 8,
  Sep: 9,
  Oct: 10,
  Nov: 11,
  Dec: 12,
} as const
const relativeUnitSeconds = {
  second: 1,
  minute: Temporal.Duration.from({minutes: 1}).total('seconds'),
  hour: Temporal.Duration.from({hours: 1}).total('seconds'),
  day: Temporal.Duration.from({hours: 24}).total('seconds'),
  month: 2_629_746,
  year: 31_556_952,
} as const
const getRelativeUnitSeconds = (seconds: number) => {
  const absoluteSeconds = Math.abs(seconds)
  if (absoluteSeconds < relativeUnitSeconds.minute) {
    return relativeUnitSeconds.second
  }
  if (absoluteSeconds < relativeUnitSeconds.hour) {
    return relativeUnitSeconds.minute
  }
  if (absoluteSeconds < relativeUnitSeconds.day) {
    return relativeUnitSeconds.hour
  }
  if (absoluteSeconds < relativeUnitSeconds.month) {
    return relativeUnitSeconds.day
  }
  if (absoluteSeconds < relativeUnitSeconds.year) {
    return relativeUnitSeconds.month
  }
  return relativeUnitSeconds.year
}
const parseAbsoluteDate = (value: string) => {
  const match = /^(\d{1,2}) (Apr|Aug|Dec|Feb|Jan|Jul|Jun|Mar|May|Nov|Oct|Sep) (\d{4}) (\d{2}):(\d{2}):(\d{2})$/u.exec(value)
  if (!match) {
    throw new Error(`Invalid EasyDate.absolute: ${JSON.stringify(value)}`)
  }
  const month = monthNumbers[match[2] as keyof typeof monthNumbers]
  return Temporal.ZonedDateTime.from({
    timeZone: 'UTC',
    year: Number(match[3]),
    month,
    day: Number(match[1]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6]),
  }).toInstant()
}
const shouldShowTime = (date: EasyDate, now: Temporal.Instant, recentSeconds: number) => {
  const instant = parseAbsoluteDate(date.absolute)
  const seconds = instant.until(now).total('seconds')
  const unitSeconds = getRelativeUnitSeconds(seconds)
  const roundedSeconds = Math.abs(Math.round(seconds / unitSeconds) * unitSeconds)
  return roundedSeconds < recentSeconds
}
const formatAbsoluteDate = (date: EasyDate, now: Temporal.Instant, recentSeconds: number) => {
  if (shouldShowTime(date, now, recentSeconds)) {
    return date.absolute
  }
  return date.absolute.replace(/ \d{2}:\d{2}:\d{2}$/u, '')
}
const formatDate = (date: EasyDate, now: Temporal.Instant, recentSeconds: number) => {
  return `${formatAbsoluteDate(date, now, recentSeconds)}, ${date.relative}`
}
const formatReleaseStats = (release: BriefRelease) => {
  if (release.size !== undefined && release.files !== undefined) {
    return `${release.size} bytes in ${release.files} files`
  }
  if (release.size !== undefined) {
    return `${release.size} bytes`
  }
  if (release.files !== undefined) {
    return `${release.files} files`
  }
}
const formatDependencies = (release: BriefRelease) => {
  if (!release.dependencies) {
    return
  }
  const noun = release.dependencies.count === 1 ? 'dependency' : 'dependencies'
  return `${release.dependencies.size} bytes from ${release.dependencies.count} ${noun}`
}
const getVisibleReleaseVersions = (inspection: Inspection) => {
  const versions = new Set<string>([inspection.releases.first.version])
  for (const release of Object.values(inspection.releases.tags)) {
    versions.add(release.version)
    for (const previous of release.previous ?? []) {
      versions.add(previous.version)
    }
  }
  return versions
}
const pushRelease = (paragraphs: Array<string>, release: BriefRelease, now: Temporal.Instant, recentSeconds: number) => {
  paragraphs.push(`#### ${release.version}`)
  paragraphs.push(flattenString.lines(formatDate(release.date, now, recentSeconds), formatReleaseStats(release), formatDependencies(release)))
}
const pluralize = (count: number, singular: string, plural = `${singular}s`) => {
  return `${count} ${count === 1 ? singular : plural}`
}
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
const markdownifyInspection = (inspection: Inspection, options: Options = {}) => {
  const now = options.now ?? Temporal.Now.instant()
  const recentSeconds = options.recentSeconds ?? defaultRecentSeconds
  const focusedRelease = inspection.focused
  const packageName = focusedRelease.package.name ?? 'Package'
  const focusedMetadataIsVisible = getVisibleReleaseVersions(inspection).has(focusedRelease.version)
  const paragraphs = [`# ${packageName} ${focusedRelease.version}`]
  if (!focusedMetadataIsVisible) {
    paragraphs.push('## npm')
    paragraphs.push(flattenString.lines(formatDate(focusedRelease.date, now, recentSeconds), formatReleaseStats(focusedRelease), formatDependencies(focusedRelease)))
  }
  if (options.clank) {
    paragraphs.push(stringifyClank({package: focusedRelease.package}))
    if (inspection.exports) {
      paragraphs.push(stringifyClank({exports: inspection.exports}))
    }
  } else {
    paragraphs.push('## package', JSON.stringify(focusedRelease.package))
    if (inspection.exports) {
      paragraphs.push('## exports', JSON.stringify(inspection.exports))
    }
  }
  paragraphs.push(`# ${inspection.releases.total} npm releases`, '## tags')
  for (const [tag, release] of Object.entries(inspection.releases.tags)) {
    paragraphs.push(`### ${tag}`)
    pushRelease(paragraphs, release, now, recentSeconds)
    for (const previous of release.previous ?? []) {
      pushRelease(paragraphs, previous, now, recentSeconds)
    }
  }
  paragraphs.push('## first')
  pushRelease(paragraphs, inspection.releases.first, now, recentSeconds)
  if (inspection.repository) {
    if ('github' in inspection.repository) {
      const repository = inspection.repository.github
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
          if (options.clank && contributor.profile) {
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
    } else {
      paragraphs.push(`# ${inspection.repository.url}`)
    }
  }
  return `${flattenString.paragraphs(paragraphs)}\n`
}

export default markdownifyInspection
