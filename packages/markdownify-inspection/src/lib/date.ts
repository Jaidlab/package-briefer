import type {EasyDate} from 'inspect-npm-package'

import {Temporal} from '@js-temporal/polyfill'

export const defaultRecentSeconds = Temporal.Duration.from({hours: 48}).total('seconds')

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

export const formatDate = (date: EasyDate, now: Temporal.Instant, recentSeconds: number) => {
  return `${formatAbsoluteDate(date, now, recentSeconds)}, ${date.relative}`
}
