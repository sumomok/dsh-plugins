# @sumomok/dsh-balance

English | [中文](README.zh.md)

Account balance and spend for the DeepSeek Harness web GUI. A chip beside Settings at the sidebar foot shows what is left in the provider account; hovering it opens a breakdown of the balance and of what this installation has spent today, this month, and in total. A line under the composer shows what the open conversation has cost.

The balance is the provider's own number. The spend is the harness's own logged token usage multiplied by a price table this deployment owns — nothing is scraped at runtime, and a model the table does not price is reported as unpriced tokens rather than as zero.

## What it shows, and where

| Surface | Slot | Shows |
| --- | --- | --- |
| Sidebar footer chip | `sidebar.footer.action` | The remaining balance (`¥12.34`), tinted by the configured thresholds. On the 56 px rail it is the number alone; wide, hovering opens the popover. |
| Popover | — | Total, granted, and topped-up balance; when it was read; today / this month / all time spend with the share each price tier took; and the date the price table carries. |
| Session spend line | `conversation.composer.dock` | `≈$0.12 this session`, plus `· N tok unpriced` when the table priced nothing for some of the session's models. |

Clicking the chip refreshes both reads immediately.

## Refresh policy

The host caches the answer, not the key.

- A successful read is served for `refreshMs` (default 60 s). Every browser tab in the window shares it, so a second monitor costs no extra provider request.
- A failed read suppresses further attempts for `retryMs` (default 15 s), so a broken endpoint is not hammered once per open tab.
- Concurrent callers share one in-flight request. Clicking the chip bypasses the refresh window but still joins a request already in flight.
- When a refresh fails but an earlier read succeeded, the earlier numbers stay on screen dimmed and the popover says so. A balance from a minute ago is worth more than a dash, as long as it admits its age.
- The browser polls on `refreshMs` and skips the tick entirely while the tab is hidden.

## The states, and what each renders

`get()` answers one of three states.

| State | Fields | Rendered as |
| --- | --- | --- |
| `ok` | `currency`, `total`, `granted`, `toppedUp`, `isAvailable`, `fetchedAt`, `stale` | The chip, with the total at two decimals. Normal above `lowBalance`; warning tint below it; critical tint below `criticalBalance`, or whenever the provider reports `isAvailable: false` — an account can be suspended with money in it. `stale: true` dims the chip and adds a note to the popover. |
| `unconfigured` | — | **Nothing at all.** No key resolves, or the configured endpoint is not one this plugin may talk to. A deployment that never wanted this feature sees the sidebar it had before installing it, not a placeholder explaining a failure. |
| `unavailable` | `reason` (`http` / `network` / `timeout` / `malformed`), optional `status`, `fetchedAt` | A dimmed `—` with the reason in the tooltip. Never a toast. The reason is a class, never the provider's text or the endpoint. |

`spend()` answers `today`, `month`, and `allTime` — each with a cost, a per-tier split, a request count, and unpriced tokens — plus `since` (the oldest retained ledger row in that currency), `currency` (the price list actually used), `pricesAsOf`, and `timezone`. Totals are per currency: rows priced in one are never folded into another's total.

## Configuration

Every key is validated at load and changeable from `cordis.yml`. The bundle patch ships the full default block; a profile patch targeting the `balance` id **replaces that whole block**, so restate every key you want to keep.

| Key | Default | Meaning |
| --- | --- | --- |
| `refreshMs` | `60000` | How long a successful balance read is served. Minimum 5000. |
| `retryMs` | `15000` | How long a failed read suppresses further attempts. Minimum 1000. |
| `timeoutMs` | `8000` | Wall-clock budget for one balance request. Minimum 1000. |
| `currency` | `[CNY, USD]` | Currency codes in descending preference. One list serves two decisions: which balance row to show when the account holds several, and which price list to spend against before the account's own currency is known. |
| `lowBalance` | `10` | Warning tint below this total. |
| `criticalBalance` | `1` | Critical tint below this total. Must not exceed `lowBalance`. |
| `ledgerDays` | `400` | Days of ledger rows kept; older rows are dropped and the file rewritten at startup. |
| `timezone` | `''` | IANA zone the day and month spend boundaries are taken in. Empty means the zone the host process runs in. |
| `root` | `''` | Directory the ledger is written into. Empty means `$DSH_HOME/dsh-balance`. |
| `surfaces.footer` | `true` | Put up the sidebar-footer chip. |
| `surfaces.sessionSpend` | `true` | Put up the per-session spend line. |
| `prices` | DeepSeek's published CNY and USD rates | The price lists, one per currency. See below. |

The provider connection is not configured here: the endpoint and the API-key reference are read from the `llm-deepseek` settings section, exactly as that provider resolves them (`baseURL`, then `$DEEPSEEK_BASE_URL`, then `https://api.deepseek.com`; `apiKeyEnv`, defaulting to `DEEPSEEK_API_KEY`). Point the provider somewhere else and this plugin follows.

## The price tables

The numbers are yours to maintain. Prices are quoted **per currency**, one list each, because a provider that bills two currencies publishes two price lists rather than one list and an exchange rate — and a CNY balance beside a USD spend total is two numbers nobody can compare.

The shipped default carries both lists DeepSeek publishes, transcribed on **2026-08-23**:

| Model | CNY per 1M (miss / hit / output) | USD per 1M (miss / hit / output) |
| --- | --- | --- |
| `deepseek-v4-flash` | ¥1.5 / ¥0.05 / ¥4.5 | $0.22 / $0.007 / $0.66 |
| `deepseek-v4-pro` | ¥4.5 / ¥0.15 / ¥13.5 | $0.66 / $0.022 / $1.98 |
| `deepseek-v4-flash-vision-exp` | ¥1.5 / ¥0.05 / ¥4.5 | $0.22 / $0.007 / $0.66 |

Those are the off-peak rates; peak doubles them. Sources: <https://api-docs.deepseek.com/zh-cn/quick_start/pricing> (CNY, which states 「空闲时段价格为高峰时段价格的一半。高峰时段为北京时间周一至周五 9:00 - 12:00、14:00 - 18:00」) and <https://api-docs.deepseek.com/quick_start/pricing> (USD, "Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday"). Those are the same instants — 09:00 Beijing is 01:00 UTC — and each list is written in the timezone its own page uses rather than converted, so either can be checked against its source. When DeepSeek changes a rate, update the list and bump `asOf`, which the popover shows beside the currency. Nothing here fetches those pages at runtime.

### Which list is used

1. The account's own billing currency, when the table prices it — this is what makes the balance and the spend total comparable, and it is known as soon as one balance read succeeds.
2. Otherwise the first `currency` entry the table prices.
3. Otherwise `USD`, then the first list by name, so the choice is never arbitrary.

The popover names the list it used: `Prices: CNY (2026-08-23)`. A change re-prices everything — the per-session projection's cache version covers the currency as well as the rates.

### The shape

The schema carries no vendor's vocabulary. An entry states its base rates and an ordered list of named schedules; each schedule claims wall-clock windows in the entry's own IANA timezone and either restates the rates or scales the base by a multiplier. The first schedule whose window contains the request instant wins; outside every window the base applies.

```yaml
prices:
  asOf: '2026-08-23'          # shown in the UI beside the currency
  tables:                     # one price list per currency; add any your provider bills in
    CNY:
      entries:
        - model: deepseek-v4-flash
          provider: deepseek-official   # optional; omit to price the model on any route
          per: 1000000                  # tokens one rate unit covers
          timezone: Asia/Shanghai       # the zone the windows below are written in
          baseName: off-peak            # what to call the base tier in the UI (default "standard")
          base:
            input: 1.5                  # cache-miss input tokens
            inputCacheHit: 0.05         # cache-hit input tokens
            output: 4.5                 # generated tokens
            # cacheWrite: defaults to `input`
            # reasoning:  defaults to `output`
          schedules:
            - name: peak
              multiplier: 2             # … or `rates: { input, inputCacheHit, output }`, never both
              windows:
                - { start: '09:00', end: '12:00', days: [1, 2, 3, 4, 5] }
                - { start: '14:00', end: '18:00', days: [1, 2, 3, 4, 5] }
    USD:
      entries:
        - model: deepseek-v4-flash
          provider: deepseek-official
          per: 1000000
          timezone: UTC
          baseName: off-peak
          base: { input: 0.22, inputCacheHit: 0.007, output: 0.66 }
          schedules:
            - name: peak
              multiplier: 2
              windows:
                - { start: '01:00', end: '04:00', days: [1, 2, 3, 4, 5] }
                - { start: '06:00', end: '10:00', days: [1, 2, 3, 4, 5] }
```

Rules the loader enforces, loudly, before the first request:

- `tables` prices at least one currency, and every key is a three-letter ISO 4217 code.
- A schedule declares exactly one of `rates` and `multiplier`.
- `start` and `end` are `HH:MM`; `end` is exclusive; `end` not after `start` wraps past midnight (`22:00`–`02:00` is four hours), and a wrapping window belongs to the day it opened on.
- `days` are JavaScript weekday numbers — **0 is Sunday** through 6 is Saturday. Absent (or empty) means every day.
- `timezone` must be an IANA zone this runtime knows; `per` must be positive; no rate may be negative; a model may appear once per provider within a currency list.

DeepSeek prices neither cache writes nor reasoning tokens separately, so both are left to their defaults in both lists: **a cache write bills at the cache-miss input rate, and a reasoning token bills at the output rate.**

A third currency, with a three-tier weekend schedule — **this example is fictional, for illustration only**:

```yaml
    EUR:                                # NOT a real provider or real prices
      entries:
        - model: example-large
          per: 1000000
          timezone: Europe/Berlin
          base: { input: 3, inputCacheHit: 0.3, output: 9, cacheWrite: 4 }
          schedules:
            - name: weekend             # first match wins, so the widest claim goes last
              multiplier: 0.6
              windows: [{ start: '00:00', end: '23:59', days: [0, 6] }]
            - name: night
              rates: { input: 1.5, inputCacheHit: 0.15, output: 4.5 }
              windows: [{ start: '22:00', end: '06:00', days: [1, 2, 3, 4, 5] }]
            - name: business
              multiplier: 1.4
              windows: [{ start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] }]
```

### What the harness gives the table to match on

Every priced observation is an `assistant/message` session event, which carries both a **provider route id** (`deepseek-official`) and a **model id** (`deepseek-v4-flash`), plus the event's own timestamp and its `TokenUsage`. An entry naming a `provider` matches only that route and is preferred over an entry for the same model that names none, so one route can be priced apart without restating the others.

`TokenUsage` counts are disjoint on the input side — `inputTokens` excludes cache traffic — but `reasoningTokens` is a subset of `outputTokens`, so this plugin subtracts it back out before pricing. A cancelled turn still reports the usage the provider billed, and is counted.

Editing a price list, or switching to another currency's list, changes the per-session projection's cache version, so every session is re-priced on next read rather than continuing to add to totals computed at the old rates.

## The ledger

Aggregates come from a file this plugin owns:

- **Path** `$DSH_HOME/dsh-balance/ledger.jsonl` (or `<root>/ledger.jsonl`). The directory is created `0o700` and the file `0o600`.
- **Contents** one JSON object per line, per LLM request: the time, the session id and log sequence number, the model and provider ids, the five token buckets, the cost, the currency it was priced in, and the price tier that applied. Unpriced rows carry `"unpriced": true` and a zero cost. **No prompts, no completions, no keys, no endpoints.** Aggregates are kept per currency, so a deployment that switches price lists sees the new currency start from zero rather than inheriting a total in the old one.
- **Retention** rows older than `ledgerDays` (default 400) are dropped at startup and the file rewritten. Loading streams the file; the in-memory aggregates are per local day, so memory is bounded by the retention window rather than by the request count. On a 12 MB ledger of 50 000 rows, startup takes about 0.11 s, and about the same again when compaction rewrites it.
- **Observation point** a read-only `session/event` subscription. That feed is post-commit and fire-and-forget, so a failure here cannot fail a turn; it carries the model, the provider, the usage, and a durable `(session, seq)` identity in one already-assembled record. The `llm/stream` waterfall was not used: it would put this plugin inside the request path and offers no durable request identity to write down.

### What is not backfilled

Aggregates count from the first row this installation wrote — the popover says "counting since &lt;date&gt;". Sessions that existed before the plugin was installed, and sessions resumed from disk (whose seeded history is not republished on the event feed), do not appear in the day, month, or all-time totals.

The **per-session** line is unaffected: it is a projection over each session's own durable log, so opening a months-old conversation prices its whole history at the current table.

Backfilling the ledger from existing sessions is a possible follow-up. It must go through the `sessionQuery` capability, never by reading the session-log files directly.

## Permissions / security

- **Network egress**: the configured provider's origin, and nothing else. The endpoint is derived from the provider's own `baseURL` by stripping one trailing `/v<digits>` and appending `/user/balance`; a base URL that is not `http(s)`, or any derivation that would leave that origin, is refused and reported as `unconfigured` rather than fetched. No pricing page, no telemetry, no update check.
- **Credentials**: the API key is resolved through the host credential seam (`ctx.credentials.resolve`) **once per read** and dropped when the request completes, which is what makes a rotated key reach the next poll without a restart. It is sent as an `Authorization: Bearer` header — never in a URL, never logged, never returned to the browser, never written to the ledger. Only the *balance* is cached.
- **No HTTP routes.** This plugin registers none. The browser half reaches the host through the harness's own `/api` Typert gateway, inheriting its trust fence.
- **Read-only RPC.** The gateway exposes exactly two methods, `accountBalance/get` and `accountBalance/spend`. There is no mutator of any kind: the price table, the thresholds, and the polling windows change only through `cordis.yml`. A caller admitted to `/api` behind a reverse proxy can read numbers and change nothing, and learns no key, no endpoint, and no prompt.
- **No session events.** The plugin appends nothing to any session log; it only reads.
- **Disk**: the ledger described above, and nothing else.

## Compatibility

Built against `@deepseek-ai/*` **0.1.1-rc.2**; the peer ranges accept `>=0.1.0-rc.1 <0.2.0`. Node `^22.19 || >=24`. The browser half requires the web GUI (`dsh web`), the slot registry, the locale service, and the Typert Remote gateway; the host half runs without any of them and simply puts up no UI.

## Install

```sh
dsh plugin --profile <name> add ./haoran-dsh-balance-0.1.0.tgz
# or, once published:
dsh plugin --profile <name> add @sumomok/dsh-balance
```

The package declares `dsh.bundle`, so `dsh plugin` appends its patch layer to the profile automatically. Verify before booting:

```sh
dsh --profile <name> --dump-config   # shows a "# == @sumomok/dsh-balance" layer
dsh web --profile <name>
```

Remove it with `dsh plugin --profile <name> remove @sumomok/dsh-balance`, which drops both the dependency and the layer. The ledger file is left where it is; delete `$DSH_HOME/dsh-balance/` to discard it.

## Out of scope

Multi-provider balances, a settings page section, and refreshing the balance when a request fails with a quota error (which would need a host-side listener on the LLM error path). None are precluded by the design.

## License

MIT
