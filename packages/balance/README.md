# @sumomok/dsh-balance

English | [中文](README.zh.md)

Account balance and spend for the DeepSeek Harness web GUI. A chip near the sidebar foot shows what is left in whichever provider the current session's selected model belongs to (`DeepSeek ¥12.34`), following a session switch or a model switch within it. Hovering opens a breakdown of that balance, an explicit provider picker over the providers this deployment can currently show a balance for, and what this installation has spent on that provider today, this month, and in total — the spend follows the picker, so the figure under a provider's balance is that route's own. A line under the composer shows what the open conversation has cost.

The balance is the provider's own number: DeepSeek's and Moonshot AI's (`moonshotai`, `moonshotai-cn`) through dedicated adapters, Kimi For Coding's (`kimi-coding`) subscription quota through its own adapter (a used-percent per window rather than a money balance), any other configured provider through a best-effort generic adapter trying a short list of endpoint shapes common OpenAI-compatible gateways answer. The spend is the harness's own logged token usage multiplied by a price table this deployment owns — nothing is scraped at runtime, and a model the table does not price is reported as unpriced tokens rather than as zero.

## What it shows, and where

**Recon finding, `sidebar.footer.action` is where this lands, not beside Settings.** No slot lets a third-party plugin share the Settings trigger's own row: `sidebar.settings` and `sidebar.footer.action` are separate full-width flex children stacked in `SidebarRoot.tsx`'s `.footArea` (`flex-direction: column`), and the Settings trigger's own content (icon + label) is itself a single-occupant slot (`settings.trigger`) already taken by `ui-settings-general`. Putting a chip in the *same row* as Settings would need core to either (a) change `.footArea` to `flex-direction: row` with `sidebar.footer.action` right-aligned instead of stacked above `sidebar.settings`, or (b) add a new slot inside the trigger button reserved for trailing content that does not steal the button's own click target. Absent either, this stays in its existing position (`sidebar.footer.action`, directly above Settings), restyled as a single line.

| Surface | Slot | Shows |
| --- | --- | --- |
| Sidebar footer chip | `sidebar.footer.action` | `Provider ¥12.34`, tinted by the configured thresholds, for whichever provider the current session's selected model belongs to. An ordinary flex item — several plugins may share this row — that grows to fill whatever width the row leaves it (the whole row alone, its own share beside a sibling), putting the provider name hard left and the amount hard right; it degrades to `¥12.34` alone once even that width is too crowded for the provider name, rather than pushing a neighbour out or wrapping. On the 56 px rail it is the amount alone; wide, hovering opens the popover. |
| Popover | — | A provider picker naming every provider this deployment can currently show a balance for (§ below), then that provider's balance breakdown, and this installation's today / this month / all time spend **on that provider** with the share each price tier took, and the date the price table carries. A quota-metered provider's spend is its tokens "within plan" — a subscription has no per-request money; a pay-as-you-go provider the table does not price shows its tokens as unpriced. The picker is hidden with fewer than two such providers — nothing to pick between. Its footer carries **Top up** — for the provider the picker names, when that provider is one this plugin has a page for — beside **Refresh**. |
| Session spend line | `conversation.composer.dock` | `≈$0.12 this session`, plus `· N tok unpriced` when the table priced nothing for some of the session's models. Unaffected by the provider picker: this stays the current session's own ledger line at the deployment's one price table (see "Out of scope"). |

Hovering the chip previews the popover; leaving it starts a 200 ms grace period so the pointer can cross the gap to a `position: fixed` popover without it closing, cancelled by entering either the chip or the popover. Clicking the chip pins the popover open — mouse leave no longer closes it — until a click outside both, Escape, or clicking the chip again; focus inside the popover (the provider picker's open dropdown) also blocks a mouse-leave close. A **Refresh** button in the popover's footer refreshes the followed provider's reads immediately; the chip's own click no longer does. **Top up** sits beside it and opens the picked provider's own top-up page in a new window — the system browser under the desktop app, a new tab in a plain browser.

## Following the session

The chip's provider is the current session's selected model's provider, read straight off the session's own durable `modelSelection` projection — the same synchronous, no-round-trip read `@haoran/dsh-vision-switch` uses — never a separate guess. A session switch re-resolves it right away; the shared poll re-resolves it every tick too, which is what also picks up a model switch made without leaving the session. A blank/no-session view, an addressed-subagent session, or a session with no recorded selection yet falls back to DeepSeek.

## The provider picker

The popover's picker lists only providers this deployment can currently show a balance for, in two passes: first, statically, to providers this plugin's adapters can ever address at all — DeepSeek's named adapter, plus every route the configurable-provider directory declares (the generic adapter's only addressable set); then, probed, to whichever of those actually has a credential resolving right now, one cached `AdapterRegistry` read each, so a poll tick already holding a fresh answer costs no extra network call. A provider excluded by either pass never reaches the dropdown at all — there is nothing left to click through to a "balance lookup is not supported" message. The followed provider always appears, first, whether or not it passed the filter: its balance has already been read by the same call that fetched this roster, and the browser half restores it if the host's own answer ever omitted it. Fewer than two entries hides the picker row entirely, leaving the rest of the popover. Picking a listed provider previews its balance and its own spend without changing what the footer chip follows; picking the followed provider back (or nothing) reverts to following. That pick lasts exactly as long as the popover it was made in: every opening — a hover or a pinning click — starts the picker on the provider the session follows, so a comparison made a moment ago never carries into the next look, and an opening after the session moved to another model starts on that model's provider.

## The top-up links

The popover's **Top up** button opens the page the provider itself takes money on, for whichever provider the picker names. The addresses are a hardcoded table (`src/client/top-up-links.ts`), **maintained by hand and re-checked at every release** — these are console pages, not an API, and nothing here can detect one moving. Last re-checked: 2026-09-03.

| Provider | Page |
| --- | --- |
| `deepseek-official` | `https://platform.deepseek.com/top_up` |
| `moonshotai` | `https://platform.kimi.ai/console/pay` |
| `moonshotai-cn` | `https://platform.kimi.com/console/pay` |
| `kimi-coding` | `https://www.kimi.com/membership/pricing` |

A provider the table does not name shows no button: that is every custom gateway a deployment configures itself, whose billing page this plugin cannot know and will not guess from an API origin. Kimi For Coding is sold as a subscription rather than a balance, so its entry is the membership page the plan is bought and renewed on. The button opens a new window rather than navigating — the desktop shell hands that to the system browser, so the running session is never replaced.

## The adapter registry

One cache — refresh window, retry window, in-flight de-duplication, stale-on-failure serving — with two kinds of member:

- **Named adapters**, each with its own dedicated endpoint parser, ahead of the generic fallback: DeepSeek, the query this plugin always had, and Moonshot AI's two routes.
- **The generic fallback**, for every other provider `ctx.llm`'s configurable-provider directory can address with a settings-configured `baseURL` (a custom base-URL entry, in Models-page terms). It tries, in order, a **one-api/new-api-shaped** user-quota endpoint (`GET /api/user/self`, converting the returned dimensionless `quota` to a currency amount at a configured ratio) and the **legacy OpenAI dashboard billing pair** (`GET /dashboard/billing/subscription` + `/dashboard/billing/usage`, `hard_limit_usd` minus `total_usage` in cents). Only endpoint *shapes* are modeled here, from public documentation — no third-party source is copied. The shape list is `genericEndpoints` (below), so a gateway answering neither can be told its own. The first shape to answer is remembered per provider (runtime-only; a restart re-probes) so a matched provider is not re-probed on every read. Every candidate URL is fenced to the provider's own configured origin. Any failure — no directory entry, no configured `baseURL`, no key, or every shape failing — answers the quiet `unconfigured` state (short-TTL negative-cached, same as the reader's normal retry window), never a named adapter's detailed `unavailable` + reason.

### Named adapters

| Provider id | Endpoint | Base URL | Currency | Balance row mapping |
| --- | --- | --- | --- | --- |
| `deepseek-official` | `GET /user/balance` (derived from the chat base URL) | `llm-deepseek` settings, default `https://api.deepseek.com` | the account's own, from `balance_infos` | `total`/`granted`/`toppedUp` ← `total_balance`/`granted_balance`/`topped_up_balance` |
| `moonshotai` | `GET /v1/users/me/balance` | `llm-pi-ai` settings (`providers.moonshotai`), default `https://api.moonshot.ai` | fixed **USD** — the endpoint names none of its own | `total`/`granted`/`toppedUp` ← `available_balance`/`voucher_balance`/`cash_balance` |
| `moonshotai-cn` | `GET /v1/users/me/balance` | `llm-pi-ai` settings (`providers.moonshotai-cn`), default `https://api.moonshot.cn` | fixed **CNY** — the endpoint names none of its own | same mapping as `moonshotai` |
| `kimi-coding` | `GET /coding/v1/usages` (404 → `/coding/v1/usage`) | fixed `https://api.kimi.com` | — (a subscription quota, no money balance) | a `quota` view — one window per metered period, each a used percent (shown as what is left); see below |

`kimi-coding` is the one adapter that reports a subscription quota rather than a money balance, so it produces the `quota` view (below) instead of `ok`. Kimi For Coding meters a subscription in usage windows — a weekly allowance and one or more rolling windows — read from Kimi's own coding-plan usage route, the same one the Kimi CLI reads a subscription's remaining quota from. That route is not part of the Moonshot Open Platform's documented HTTP surface; it answers the usage payload only to the Kimi CLI's own client identifier, so the request carries `User-Agent: KimiCLI/1.6` (a client-identification header the route requires — the subscription key, not the header, is what authenticates the account, which is the caller's own). The response is decoded defensively: an undocumented route may change its shape between client releases, so any missing or off-type field degrades to `unavailable` rather than an error. Counts arrive either as JSON numbers or, since the route moved to protobuf-JSON (observed 2026-09-02), as decimal strings with enum-named units (`TIME_UNIT_MINUTE`); both are read, and a rolling span given in whole hours' worth of minutes is named in hours (`300 MINUTE` → `5h`). The credential defaults to `KIMI_CODING_API_KEY` (the `sk-kimi-*` subscription key the CLI itself uses) when the profile names none; the fixed usage route ignores any configured chat base URL. No price table entry applies: a quota read carries no per-model spend.

Both Moonshot routes read the same documented response body — `{ code, data: { available_balance, voucher_balance, cash_balance }, scode, status }`, verified against <https://platform.kimi.com/docs/api/balance> (China) and <https://platform.kimi.ai/docs/api/balance> (international) on 2026-08-31; both doc domains now redirect from `platform.moonshot.cn`/`platform.moonshot.ai`, unrelated to the API's own request domain (`api.moonshot.cn`/`api.moonshot.ai`), which neither redirect touches — and differ only in base URL and billed currency, so one parameterized adapter serves both, registered per id in the adapter registry. `isAvailable` reads the response's own `status` flag, the closest documented equivalent to DeepSeek's explicit `is_available`. Connection facts are found the same way the generic fallback finds any other pi-ai-routed provider's — through `ctx.llm`'s configurable-provider directory — but the credential defaults to `MOONSHOT_API_KEY` when the profile names none: pi-ai's own built-in environment variable for both routes, rather than the per-id name (`MOONSHOTAI_API_KEY`/`MOONSHOTAI_CN_API_KEY`) the generic fallback would otherwise derive. No price table entry is needed or looked up for either route: the balance read carries no per-model spend, only the account total.

## Refresh policy

The host caches the answer, not the key.

- A successful read is served for `refreshMs` (default 60 s). Every browser tab in the window shares it, so a second monitor costs no extra provider request.
- A failed read suppresses further attempts for `retryMs` (default 15 s), so a broken endpoint is not hammered once per open tab.
- Concurrent callers share one in-flight request. Clicking the popover's **Refresh** button bypasses the refresh window but still joins a request already in flight.
- When a refresh fails but an earlier read succeeded, the earlier numbers stay on screen dimmed and the popover says so. A balance from a minute ago is worth more than a dash, as long as it admits its age.
- The browser polls on `refreshMs` and skips the tick entirely while the tab is hidden.

## The states, and what each renders

`get(provider?, force?)` answers one of three states, for whichever provider it named (the followed provider when omitted).

| State | Fields | Rendered as |
| --- | --- | --- |
| `ok` | `currency`, `total`, optional `granted`/`toppedUp`, `isAvailable`, `fetchedAt`, `stale` | The chip, with the total at two decimals. Normal above `lowBalance`; warning tint below it; critical tint below `criticalBalance`, or whenever the provider reports `isAvailable: false` — an account can be suspended with money in it. `stale: true` dims the chip and adds a note to the popover. `granted`/`toppedUp` are a named adapter's own breakdown (DeepSeek's `granted_balance`/`topped_up_balance`, or Moonshot's `voucher_balance`/`cash_balance`); a generic-adapter read carries `total` alone. |
| `quota` | `windows` (each `key`, `usedPercent`, `resetsAt`), `isAvailable`, `fetchedAt`, `stale` | The `kimi-coding` subscription quota. The chip shows what is **left** of every window, labelled (`left 7d 58% · 5h 95%`), in place of a money amount; the popover lists every window as `58% left` with its reset time — the time of day when it is within the next day, the date and time otherwise. The weekly window is named as the 7-day window; a rolling window is named by its span (`5-hour window`). No tint (a quota carries no money threshold); `isAvailable: false` — the primary window fully consumed — adds the suspended note, and `stale: true` dims as for `ok`. |
| `unconfigured` | — | For the **followed** provider: **nothing at all** — no key resolves, no adapter serves this provider, or the generic adapter tried and found nothing. A deployment that never wanted this feature sees the sidebar it had before installing it. For a provider the **picker** explicitly named: "balance lookup is not supported for this provider" — the user asked, so this one explains rather than hides. |
| `unavailable` | `reason` (`http` / `network` / `timeout` / `malformed`), optional `status`, `fetchedAt` | Named adapters only (DeepSeek, `moonshotai`, `moonshotai-cn`, `kimi-coding`) — the generic adapter's failures fold into the quiet `unconfigured` state above instead. A dimmed `—` with the reason in the tooltip. The reason is a class, never the provider's text or the endpoint. |

`providers()` answers the picker's roster: `{ id, displayName }[]`, DeepSeek first.

`spend(provider?)` answers one provider's `today`, `month`, and `allTime` (the DeepSeek route when none is named) — each with a cost, a per-tier split, a request count, and unpriced tokens — plus `provider`, `since` (the oldest retained ledger row of that provider in that currency), `currency` (the price list actually used), `pricesAsOf`, and `timezone`. Totals are per provider and per currency: rows of one provider, or priced in one currency, are never folded into another's total; a row that recorded no provider counts under the empty id, which no picker entry reads.

## Configuration

Every key is validated at load and changeable from `cordis.yml`. The bundle patch ships the full default block; a profile patch targeting the `balance` id **replaces that whole block**, so restate every key you want to keep.

A Settings → Balance page (`settings.section`) also exposes two of these keys graphically, read and written live through the harness's own settings document rather than `cordis.yml`: the price table's per-model base rates for a currency already in the table (add/remove a model row; adding a currency or editing a time-of-day tier is not exposed here — a tier's own windows are carried through unedited when its row is saved, never dropped, and summarized as read-only text), and `lowBalance`/`criticalBalance`. Both take effect immediately, no restart. Every other key in the table below — including a price entry's schedules — still takes effect only through `cordis.yml`/a raw settings-document edit and the next restart.

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
| `genericEndpoints` | one-api/new-api user-quota, then the OpenAI dashboard billing pair | Candidate endpoint shapes the generic fallback adapter tries, in order, for any provider but DeepSeek. See "The adapter registry". |

No provider's connection is configured here. DeepSeek's is read from the `llm-deepseek` settings section, exactly as that provider resolves it (`baseURL`, then `$DEEPSEEK_BASE_URL`, then `https://api.deepseek.com`; `apiKeyEnv`, defaulting to `DEEPSEEK_API_KEY`). `moonshotai` and `moonshotai-cn` are read from wherever `ctx.llm`'s configurable-provider directory says the `llm-pi-ai` settings section's `providers.moonshotai`/`providers.moonshotai-cn` profile lives, same as any other pi-ai-routed provider; `baseURL` defaults to each route's own public origin (`https://api.moonshot.ai`, `https://api.moonshot.cn`) and `apiKeyEnv` defaults to `MOONSHOT_API_KEY` — pi-ai's own built-in default for both routes — rather than the per-id name derived below. Every other provider's `baseURL`/`apiKeyEnv` are read the same directory-addressed way, with an `apiKeyEnv` the profile does not name derived the way the Models page derives one (`<PROVIDER>_API_KEY`). Point a provider somewhere else and this plugin follows.

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
- **Contents** one JSON object per line, per LLM request: the time, the session id and log sequence number, the model and provider ids, the five token buckets, the cost, the currency it was priced in, and the price tier that applied. Unpriced rows carry `"unpriced": true` and a zero cost. **No prompts, no completions, no keys, no endpoints.** Aggregates are kept per provider and per currency, so a deployment that switches price lists sees the new currency start from zero rather than inheriting a total in the old one, and one provider's rows never count toward another's — the spend under a provider's balance in the popover is that route's own. A row that recorded no provider counts under the empty id, which no picker entry reads.
- **Retention** rows older than `ledgerDays` (default 400) are dropped at startup and the file rewritten. Loading streams the file; the in-memory aggregates are per local day, so memory is bounded by the retention window rather than by the request count. On a 12 MB ledger of 50 000 rows, startup takes about 0.11 s, and about the same again when compaction rewrites it.
- **Observation point** a read-only `session/event` subscription. That feed is post-commit and fire-and-forget, so a failure here cannot fail a turn; it carries the model, the provider, the usage, and a durable `(session, seq)` identity in one already-assembled record. The `llm/stream` waterfall was not used: it would put this plugin inside the request path and offers no durable request identity to write down.

### What is not backfilled

Aggregates count from the first row this installation wrote — the popover says "counting since &lt;date&gt;". Sessions that existed before the plugin was installed, and sessions resumed from disk (whose seeded history is not republished on the event feed), do not appear in the day, month, or all-time totals.

The **per-session** line is unaffected: it is a projection over each session's own durable log, so opening a months-old conversation prices its whole history at the current table.

Backfilling the ledger from existing sessions is a possible follow-up. It must go through the `sessionQuery` capability, never by reading the session-log files directly.

## Permissions / security

- **Network egress**: the *queried* provider's own configured origin, and nothing else. DeepSeek's endpoint is derived from its own `baseURL` by stripping one trailing `/v<digits>` and appending `/user/balance`; each Moonshot route's endpoint is its origin plus the documented `/v1/users/me/balance`, discarding any path the configured `baseURL` carries; the generic adapter's candidate URLs are built from a resolved provider's origin and are refused whenever the arithmetic would leave it. A base URL that is not `http(s)`, or any derivation that would leave the origin, is refused and reported as `unconfigured` rather than fetched. No pricing page, no telemetry, no update check.
- **Credentials**: whichever provider is queried, its API key is resolved through the host credential seam (`ctx.credentials.resolve`) **once per read** and dropped when the request completes, which is what makes a rotated key reach the next poll without a restart. It is sent as an `Authorization: Bearer` header — never in a URL, never logged, never returned to the browser, never written to the ledger, never cached alongside the balance. Only the *balance number* is cached.
- **No HTTP routes.** This plugin registers none. The browser half reaches the host through the harness's own `/api` Typert gateway, inheriting its trust fence.
- **Read-only Typert RPC.** The gateway exposes exactly three methods of its own, `accountBalance/get`, `accountBalance/spend`, and `accountBalance/providers` — no mutator. The Settings → Balance page writes through the harness's own settings RPC instead (the same one every settings row in the app uses, not a route this plugin adds), gated by that RPC's own loopback-only write rule; the polling windows and the generic adapter's endpoint shapes still change only through `cordis.yml`. A caller admitted to `/api` behind a reverse proxy learns no key, no endpoint, and no prompt.
- **No session events.** The plugin appends nothing to any session log; it only reads.
- **Ledger stays numeric-only and single-account.** The provider picker previews other providers' balances; it never writes to, or re-prices, the spend ledger, which stays exactly the DeepSeek-account-priced ledger described below.
- **Disk**: the ledger described above, and nothing else.

## Compatibility

Built against `@deepseek-ai/*` **0.1.2-alpha.2**; the peer ranges accept `>=0.1.2-alpha.2 <0.2.0-0`. Node `^22.19 || >=24`. The browser half requires the web GUI (`dsh web`), the slot registry, the locale service, and the Typert Remote gateway; the host half runs without any of them and simply puts up no UI.

## Install

```sh
dsh plugin --profile <name> add ./sumomok-dsh-balance-0.3.2.tgz
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

A multi-provider **spend ledger** (the ledger stays one deployment-priced account, whichever provider the picker previews), editing a price entry's schedules or adding a currency from the Settings page (see "Configuration" above — base rates and the two thresholds are graphical; the rest is not), and refreshing the balance when a request fails with a quota error (which would need a host-side listener on the LLM error path). None are precluded by the design.

Named adapters for specific providers beyond DeepSeek, Moonshot AI, and Kimi For Coding: the registry (`adapters.ts`) is structured to add one keyed by provider id ahead of the generic fallback — every other provider still goes through the generic adapter's best-effort endpoint probing. A future provider that meters a subscription quota rather than a money balance joins the same way `kimi-coding` does, producing the `quota` view.

## License

MIT
