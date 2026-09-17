import { describe, it, expect } from 'vitest'
import { filterEntries } from '@/store/useDebugStore'
import type { LogEntry } from '@shared/ipc'

const e = (o: Partial<LogEntry>): LogEntry => ({ ts: '2026-01-01T00:00:00Z', source: 'backend', level: 'info', action: 'A', ...o })
const list: LogEntry[] = [
  e({ level: 'info', source: 'backend', correlationId: 'c1' }),
  e({ level: 'error', source: 'renderer', correlationId: 'c2' }),
  e({ level: 'error', source: 'main', correlationId: 'c2' })
]

describe('filterEntries (Debug-Konsole)', () => {
  it('ohne Filter -> alle', () => {
    expect(filterEntries(list, 'all', 'all', null)).toHaveLength(3)
  })
  it('Level-Filter', () => {
    expect(filterEntries(list, 'error', 'all', null)).toHaveLength(2)
  })
  it('Source-Filter', () => {
    expect(filterEntries(list, 'all', 'backend', null)).toHaveLength(1)
  })
  it('Vorbefilterung per correlationId (Toast-Details) schlaegt alles andere', () => {
    expect(filterEntries(list, 'all', 'all', 'c2')).toHaveLength(2)
    expect(filterEntries(list, 'all', 'all', 'nope')).toHaveLength(0)
  })
})
