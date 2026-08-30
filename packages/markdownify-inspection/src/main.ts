import type {BriefRelease, EasyDate, GitHubIssue, Inspection} from 'inspect-npm-package'

import {Temporal} from '@js-temporal/polyfill'
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
const pushRelease = (lines: Array<string>, release: BriefRelease, now: Temporal.Instant, recentSeconds: number) => {
  lines.push(`#### ${release.version}`, '', formatDate(release.date, now, recentSeconds))
  const stats = formatReleaseStats(release)
  if (stats) {
    lines.push(stats)
  }
  if (release.dependencies) {
    const noun = release.dependencies.count === 1 ? 'dependency' : 'dependencies'
    lines.push(`${release.dependencies.size} bytes from ${release.dependencies.count} ${noun}`)
  }
  lines.push('')
}
const pluralize = (count: number, singular: string, plural = `${singular}s`) => {
  return `${count} ${count === 1 ? singular : plural}`
}
const pushIssueSample = (lines: Array<string>, title: string, sample: Array<GitHubIssue>, now: Temporal.Instant, recentSeconds: number) => {
  if (!sample.length) {
    return
  }
  lines.push(`### ${title}`, '')
  for (const issue of sample) {
    lines.push(`#### ${issue.number}`, '', issue.author, formatDate(issue.date, now, recentSeconds), issue.status, '', issue.title, '')
  }
}
const markdownifyInspection = (inspection: Inspection, options: Options = {}) => {
  const now = options.now ?? Temporal.Now.instant()
  const recentSeconds = options.recentSeconds ?? defaultRecentSeconds
  const focusedRelease = inspection.focused
  const packageName = focusedRelease.package.name ?? 'Package'
  const focusedMetadataIsVisible = getVisibleReleaseVersions(inspection).has(focusedRelease.version)
  const lines = [
    `# ${packageName} ${focusedRelease.version}`,
    '',
  ]
  if (!focusedMetadataIsVisible) {
    lines.push('## npm', '', formatDate(focusedRelease.date, now, recentSeconds))
    const stats = formatReleaseStats(focusedRelease)
    if (stats) {
      lines.push(stats)
    }
    if (focusedRelease.dependencies) {
      const noun = focusedRelease.dependencies.count === 1 ? 'dependency' : 'dependencies'
      lines.push(`${focusedRelease.dependencies.size} bytes from ${focusedRelease.dependencies.count} ${noun}`)
    }
    lines.push('')
  }
  if (options.clank) {
    lines.push(stringifyClank({package: focusedRelease.package}), '')
    if (inspection.exports) {
      lines.push(stringifyClank({exports: inspection.exports}), '')
    }
  } else {
    lines.push('## package', '', JSON.stringify(focusedRelease.package), '')
    if (inspection.exports) {
      lines.push('## exports', '', JSON.stringify(inspection.exports), '')
    }
  }
  lines.push(`# ${inspection.releases.total} npm releases`, '', '## tags', '')
  for (const [tag, release] of Object.entries(inspection.releases.tags)) {
    lines.push(`### ${tag}`, '')
    pushRelease(lines, release, now, recentSeconds)
    for (const previous of release.previous ?? []) {
      pushRelease(lines, previous, now, recentSeconds)
    }
  }
  const first = inspection.releases.first
  lines.push('## first', '')
  pushRelease(lines, first, now, recentSeconds)
  if (inspection.repository) {
    if ('github' in inspection.repository) {
      const repository = inspection.repository.github
      lines.push(`# github.com/${repository.slug.toLowerCase()}`, '')
      if (repository.stars) {
        lines.push(pluralize(repository.stars, 'star'))
      }
      if (repository.forks) {
        lines.push(pluralize(repository.forks, 'fork'))
      }
      if (repository.stars || repository.forks) {
        lines.push('')
      }
      if (repository.issues && (repository.issueSample.length || repository.issueCreatedSample.length)) {
        lines.push(`## ${pluralize(repository.issues, 'issue')}`, '')
        pushIssueSample(lines, 'recently updated', repository.issueSample, now, recentSeconds)
        pushIssueSample(lines, 'recently created', repository.issueCreatedSample, now, recentSeconds)
      }
      if (repository.pullRequests && (repository.pullRequestSample.length || repository.pullRequestCreatedSample.length)) {
        lines.push(`## ${pluralize(repository.pullRequests, 'pull request')}`, '')
        pushIssueSample(lines, 'recently updated', repository.pullRequestSample, now, recentSeconds)
        pushIssueSample(lines, 'recently created', repository.pullRequestCreatedSample, now, recentSeconds)
      }
      if (repository.commits && repository.commitSample.length) {
        lines.push(`## ${pluralize(repository.commits, 'commit')}`, '')
        for (const commit of repository.commitSample) {
          lines.push(`### ${commit.hash}`, '', commit.author, formatDate(commit.date, now, recentSeconds), '', commit.message, '')
        }
      }
      if (repository.releases && repository.releaseSample.length) {
        lines.push(`## ${pluralize(repository.releases, 'release')}`, '')
        for (const release of repository.releaseSample) {
          lines.push(`### ${release.tag}`, '', release.author, formatDate(release.date, now, recentSeconds), release.status)
          if (release.name) {
            lines.push('', release.name)
          }
          lines.push('')
        }
      }
      if (repository.contributors && repository.contributorSample.length) {
        lines.push(`## ${pluralize(repository.contributors, 'contributor')}`, '')
        for (const contributor of repository.contributorSample) {
          lines.push(`### ${contributor.name}`, '', pluralize(contributor.commits, 'commit'))
          if (contributor.profile) {
            if (options.clank) {
              lines.push(stringifyClank({profile: contributor.profile}), '')
            } else {
              lines.push('')
              const profile = contributor.profile
              const profileLines: Array<string> = []
              if (profile.name) {
                profileLines.push(`name ${profile.name}`)
              }
              if (profile.location) {
                profileLines.push(`location ${profile.location}`)
              }
              if (profile.company) {
                profileLines.push(`company ${profile.company}`)
              }
              if (profile.repositories) {
                profileLines.push(pluralize(profile.repositories, 'repository', 'repositories'))
              }
              if (profile.followers) {
                profileLines.push(pluralize(profile.followers, 'follower'))
              }
              if (profileLines.length) {
                lines.push('#### profile', '', ...profileLines, '')
              }
            }
          } else {
            lines.push('')
          }
        }
      }
    } else {
      lines.push(`# ${inspection.repository.url}`, '')
    }
  }
  return lines.join('\n')
}

export default markdownifyInspection
