import type {EasyDate} from './types.ts'

import {Temporal} from '@js-temporal/polyfill'

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (value: number) => String(value).padStart(2, '0')
const relativeTimeFormat = new Intl.RelativeTimeFormat('en', {numeric: 'always'})
const getRelativeValue = (seconds: number): [number, Intl.RelativeTimeFormatUnit] => {
  const absoluteSeconds = Math.abs(seconds)
  if (absoluteSeconds < 60) {
    return [seconds, 'second']
  }
  if (absoluteSeconds < 3600) {
    return [seconds / 60, 'minute']
  }
  if (absoluteSeconds < 86_400) {
    return [seconds / 3600, 'hour']
  }
  if (absoluteSeconds < 2_629_746) {
    return [seconds / 86_400, 'day']
  }
  if (absoluteSeconds < 31_556_952) {
    return [seconds / 2_629_746, 'month']
  }
  return [seconds / 31_556_952, 'year']
}

export const formatEasyDate = (value: Temporal.Instant | string, now: Temporal.Instant): EasyDate => {
  const instant = typeof value === 'string' ? Temporal.Instant.from(value) : value
  const date = instant.toZonedDateTimeISO('UTC')
  const seconds = now.until(instant).total('seconds')
  const [relativeValue, relativeUnit] = getRelativeValue(seconds)
  return {
    absolute: `${date.day} ${months[date.month - 1]} ${date.year} ${pad(date.hour)}:${pad(date.minute)}:${pad(date.second)}`,
    relative: relativeTimeFormat.format(Math.round(relativeValue), relativeUnit),
  }
}

export const compareInstants = (a: string, b: string) => Temporal.Instant.compare(Temporal.Instant.from(a), Temporal.Instant.from(b))
