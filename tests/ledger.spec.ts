import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dayKey, Ledger, LEDGER_MODE, ledgerPath, parseLedgerRow } from '../src/ledger.ts'
import type { LedgerRow } from '../src/ledger.ts'
import type { BalanceUiConfig } from '../src/types.ts'

const DAY = 86_400_000

const UI: BalanceUiConfig = {
  footer: true,
  sessionSpend: true,
  lowBalance: 10,
  criticalBalance: 1,
  refreshMs: 60_000,
}

/** 2026-08-19 12:00 UTC. */
const NOW = Date.UTC(2026, 7, 19, 12, 0)

function row(over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    t: NOW,
    sessionId: 's1',
    seq: 1,
    model: 'm',
    input: 100,
    cacheRead: 10,
    cacheWrite: 5,
    output: 50,
    reasoning: 5,
    cost: 0.25,
    currency: 'USD',
    schedule: 'off-peak',
    ...over,
  }
}

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-balance-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** A ledger over a settable clock in a temp directory. */
function ledger(options: { now?: number; retentionDays?: number; timezone?: string; file?: string } = {}) {
  let now = options.now ?? NOW
  const instance = new Ledger({
    file: options.file ?? ledgerPath(root),
    now: () => now,
    timezone: options.timezone ?? 'UTC',
    retentionDays: options.retentionDays ?? 400,
    currency: 'USD',
    pricesAsOf: '2026-08-23',
    ui: UI,
  })
  return { instance, set: (at: number) => { now = at } }
}

describe('dayKey', () => {
  it('takes the day boundary in the named zone, not the host zone', () => {
    const justBeforeUtcMidnight = Date.UTC(2026, 7, 19, 23, 30)
    expect(dayKey(justBeforeUtcMidnight, 'UTC')).toBe('2026-08-19')
    expect(dayKey(justBeforeUtcMidnight, 'Asia/Shanghai')).toBe('2026-08-20')
    expect(dayKey(justBeforeUtcMidnight, 'America/New_York')).toBe('2026-08-19')
  })
})

describe('parseLedgerRow', () => {
  it('accepts a written row', () => {
    expect(parseLedgerRow(JSON.parse(JSON.stringify(row())))).toEqual(row())
  })

  it('keeps the optional provider and unpriced marks', () => {
    const marked = row({ provider: 'p', unpriced: true, cost: 0, schedule: '' })
    expect(parseLedgerRow(JSON.parse(JSON.stringify(marked)))).toEqual(marked)
  })

  it('rejects a row missing a number, a string, or its shape', () => {
    expect(parseLedgerRow({ ...row(), cost: undefined })).toBeNull()
    expect(parseLedgerRow({ ...row(), model: 7 })).toBeNull()
    expect(parseLedgerRow('{"t":1}')).toBeNull()
    expect(parseLedgerRow(null)).toBeNull()
  })
})

describe('Ledger', () => {
  it('creates the file owner-only on first open', async () => {
    const { instance } = ledger()
    expect(await instance.open()).toBe(0)
    const info = await stat(ledgerPath(root))
    expect(info.mode & 0o777).toBe(LEDGER_MODE)
  })

  it('appends one JSON line per row', async () => {
    const { instance } = ledger()
    await instance.open()
    await instance.append(row())
    await instance.append(row({ seq: 2 }))
    const lines = (await readFile(ledgerPath(root), 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[1]!)).toMatchObject({ seq: 2 })
  })

  it('sums today, this month, and all time in the configured zone', async () => {
    const { instance } = ledger()
    await instance.open()
    await instance.append(row({ cost: 1 }))
    await instance.append(row({ seq: 2, t: NOW - DAY, cost: 2 }))
    await instance.append(row({ seq: 3, t: Date.UTC(2026, 6, 15, 12, 0), cost: 4 }))
    const spend = instance.spend()
    expect(spend.today.cost).toBe(1)
    expect(spend.month.cost).toBe(3)
    expect(spend.allTime.cost).toBe(7)
    expect(spend.allTime.requests).toBe(3)
    expect(spend.since).toBe(Date.UTC(2026, 6, 15, 12, 0))
  })

  it('moves a row across the day boundary when the zone does', async () => {
    const lateUtc = Date.UTC(2026, 7, 19, 23, 30)
    const shanghai = ledger({ now: lateUtc, timezone: 'Asia/Shanghai' })
    await shanghai.instance.open()
    await shanghai.instance.append(row({ t: lateUtc, cost: 1 }))
    // 23:30 UTC is already 2026-08-20 in Shanghai, and so is "now".
    expect(shanghai.instance.spend().today.cost).toBe(1)

    const utc = ledger({ now: lateUtc, timezone: 'UTC', file: join(root, 'utc.jsonl') })
    await utc.instance.open()
    await utc.instance.append(row({ t: lateUtc - 2 * 3_600_000, cost: 1 }))
    expect(utc.instance.spend().today.cost).toBe(1)
  })

  it('rolls today over when the clock crosses local midnight', async () => {
    const { instance, set } = ledger()
    await instance.open()
    await instance.append(row({ cost: 3 }))
    expect(instance.spend().today.cost).toBe(3)
    set(NOW + DAY)
    expect(instance.spend().today.cost).toBe(0)
    expect(instance.spend().allTime.cost).toBe(3)
  })

  it('splits cost by the schedule that priced each row', async () => {
    const { instance } = ledger()
    await instance.open()
    await instance.append(row({ cost: 3, schedule: 'off-peak' }))
    await instance.append(row({ seq: 2, cost: 1, schedule: 'peak' }))
    expect(instance.spend().allTime.bySchedule).toEqual({ 'off-peak': 3, peak: 1 })
  })

  it('counts an unpriced row as tokens rather than as zero cost', async () => {
    const { instance } = ledger()
    await instance.open()
    await instance.append(row({ unpriced: true, cost: 0, schedule: '' }))
    const spend = instance.spend()
    expect(spend.allTime.cost).toBe(0)
    expect(spend.allTime.requests).toBe(1)
    expect(spend.allTime.unpricedTokens).toBe(170)
    expect(spend.allTime.bySchedule).toEqual({})
  })

  it('reloads its aggregates from the file', async () => {
    const first = ledger()
    await first.instance.open()
    await first.instance.append(row({ cost: 2 }))
    const second = ledger()
    expect(await second.instance.open()).toBe(1)
    expect(second.instance.spend().allTime.cost).toBe(2)
  })

  it('drops rows past the retention window and rewrites the file', async () => {
    const first = ledger()
    await first.instance.open()
    await first.instance.append(row({ t: NOW - 10 * DAY, cost: 1 }))
    await first.instance.append(row({ seq: 2, t: NOW - 2 * DAY, cost: 2 }))
    const second = ledger({ retentionDays: 5 })
    expect(await second.instance.open()).toBe(1)
    expect(second.instance.spend().allTime.cost).toBe(2)
    const lines = (await readFile(ledgerPath(root), 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]!)).toMatchObject({ seq: 2 })
  })

  it('leaves the file alone when nothing is past retention', async () => {
    const first = ledger()
    await first.instance.open()
    await first.instance.append(row())
    const before = await readFile(ledgerPath(root), 'utf8')
    const second = ledger()
    await second.instance.open()
    expect(await readFile(ledgerPath(root), 'utf8')).toBe(before)
  })

  it('skips a truncated final line instead of failing every later read', async () => {
    const first = ledger()
    await first.instance.open()
    await first.instance.append(row({ cost: 2 }))
    await writeFile(ledgerPath(root), `${await readFile(ledgerPath(root), 'utf8')}{"t":123,"sess`, { flag: 'w' })
    const second = ledger()
    expect(await second.instance.open()).toBe(1)
    expect(second.instance.spend().allTime.cost).toBe(2)
    // The half-written line was dropped, so the rewrite kept only the good one.
    expect((await readFile(ledgerPath(root), 'utf8')).trim().split('\n')).toHaveLength(1)
  })

  it('restates the currency, the price date, the zone, and the surface toggles', async () => {
    const { instance } = ledger()
    await instance.open()
    const spend = instance.spend()
    expect(spend.currency).toBe('USD')
    expect(spend.pricesAsOf).toBe('2026-08-23')
    expect(spend.timezone).toBe('UTC')
    expect(spend.ui).toEqual(UI)
    expect(spend.since).toBeNull()
  })
})
