import type { Cycle } from '../domain'

export function parseDate(value: string, endOfDay = false): Date {
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00'}` : value)
}

export function isCurrentCycle(cycle: Cycle, now = Date.now()): boolean {
  return now >= parseDate(cycle.startsAt).getTime() && now <= parseDate(cycle.endsAt, true).getTime()
}
