# @haoran/dsh-edit-rerun

English | [中文](README.zh.md)

Pick an earlier question in the DeepSeek Harness web GUI, edit it, and run again from that point — without losing the conversation you already have.

## Why

A conversation goes wrong at one question. The answer under it, and everything the model did after it, all follow from a prompt that was missing a constraint, named the wrong file, or asked for the wrong thing. The only repair the GUI offers is to ask again at the bottom, which leaves the wrong exchange in the model's context, or to start over, which throws away the part that was working.

The harness [deliberately removed](https://github.com/deepseek-ai/deepseek-harness) the edit control from settled user messages: nothing backed it, and the branch control on a user bubble cut *after* the answer — the opposite of what "edit my question" means. This plugin fills that seat with the operation the host's own note described as out of scope for the bubble: a cut *before* the question, plus a composer prefill.

## What it does

Every completed turn's action row (beside copy and branch) gains two buttons:

| Button | What happens |
| --- | --- |
| **Edit the prompt and rerun** | Creates a child session whose history ends immediately before the edited question's turn, opens it, and puts the original question in the composer for you to change and send. |
| **Rerun this turn as is** | The same, and sends the question immediately. |

The original session is never modified. The child appears as an ordinary session, its title numbered `(1)`, `(2)`, …, and its header shows the lineage the host records for every fork.

## Boundary semantics

This is the whole rule, and it is worth reading once:

**The child session contains everything up to and including the turn before the edited question. It contains no part of the edited question's own turn.**

Concretely, for a question that opened turn *N*, the plugin takes the `turn/end` of the last completed turn strictly before it and calls `sessions.fork({ atSeq })` at that seq. The host cuts at the first `turn/end` at or after the anchor and then extends the cut through the standalone events that follow — a generated title, a context injection — up to the next `turn/start`. So the child's seeded log ends exactly where turn *N* was about to begin, the seed is a balanced transcript, and re-asking cannot duplicate the question.

Two consequences follow from the same rule:

- **A question that opened the session's first turn has no earlier boundary.** There is nothing to fork from, so the plugin connects the workspace's blank session instead — a sibling conversation in the same directory, with the question prefilled. This is the host's own "new chat here" path; no history is dropped, because there was none.
- **A steered turn reruns from its opening question.** A message you steered in mid-turn is model-visible history of that turn, and the turn is being replaced wholesale, so the rerun carries the question that opened the turn, not the steer.

## Limits

- **Text only.** The prefill carries the question's text. A question that included an image or attachment offers no button at all, rather than silently re-asking a different question without it. A reference chip that was in the original prompt arrives as the plain text it serialized to, not as a live chip.
- **No version tree.** Forks are peer sessions in the workspace list, exactly like the host's own branch action. The plugin stores no lineage of its own and adds no navigation between an original and its reruns.
- **The first-turn case creates a new session, not a fork.** Its title is the workspace default rather than a numbered child, and it is not linked to the original.
- **A paged transcript refuses rather than guesses.** If you scrolled into a long session and the events above the loaded window are not in the browser yet, the earliest loaded turn offers no button: forking there would cut at the wrong place. Scroll up until the older turns load.
- **The buttons address a turn, not a message.** They live on the turn's action row, so a turn with several user messages reruns from the one that opened it.

## Permissions / security

The plugin is a browser-side UI contribution and nothing else.

- **No network.** It opens no connection, fetches no URL, and contacts no service. Its only I/O is the client's own session RPC, over the connection the GUI already has.
- **No filesystem.** It reads and writes no file, in the workspace or anywhere else.
- **No custom session events.** It writes nothing to any session log. The question you rerun enters the child session as an ordinary prompt, which the host logs as `user/message` like any other. Uninstalling the plugin therefore cannot make an existing session unreadable — a hazard that has bricked sessions for users of plugins that logged their own event types.
- **No host routes and no host logic.** The host half (`lib/index.js`) is an empty `apply`; it exists only because a bundle needs a plugin entry.
- **Official seams only.** Two published slots (`conversation.chat.assistant-actions`, `conversation.input.dock`), three published client services (`sessions`, `workspaces`, `locale`), and the slot registry. No DOM surgery on host-rendered messages, no keyboard interception, no `MutationObserver`.
- **No persistence.** The question waiting for a forked composer lives in one in-memory map, capped at eight entries, and dies with the page.

## Install

```sh
pnpm --filter @haoran/dsh-edit-rerun run build
cd packages/edit-rerun && pnpm pack --pack-destination ../../dist
dsh plugin --profile <name> add ../../dist/haoran-dsh-edit-rerun-0.1.0.tgz
```

Or, once published:

```sh
dsh plugin --profile <name> add @haoran/dsh-edit-rerun
```

The manifest declares `dsh.bundle.patch`, so the install appends the package to the profile's `dsh.profile.bundles` and its patch layer mounts the plugin; it declares `dsh.client`, so the web plugin table serves the browser half. Nothing needs to be added to the profile's own `cordis.patch.yml`.

Install the tarball or the published package, never a `link:` path — a linked install loads a second copy of cordis and the plugin's services stop matching the host's.

## Compatibility

Built against the `@deepseek-ai/*` client packages at `0.1.1-rc.2`; the peer ranges accept any `0.1.x` host from `0.1.0-rc.1` up. Note that a caret range over a prerelease does not do this: `^0.1.0-rc.7` does **not** match `0.1.1-rc.2` under semver prerelease rules, which is why the ranges here are spelled out.

The plugin renders into `conversation.chat.assistant-actions` and `conversation.input.dock`, both published slots of `@deepseek-ai/dsh-client-ui-conversation`. If a future host renames either, the plugin fails loudly at registration rather than rendering into the wrong place.

## Development

```sh
pnpm --filter @haoran/dsh-edit-rerun run build   # tsc declarations + two esbuild bundles
pnpm exec vitest run packages/edit-rerun          # anchor rules, prefill store, build smoke
```

`scripts/build.mjs` emits `lib/client.js` in the closure-factory format the web shell's module loader expects, with the shell's seeded modules (React, cordis, `dsh-client-ui-slots`, `dsh-client-ui-primitives`) left external. The build smoke executes the real artifact through a stand-in loader, so a wrapper that would not load in the browser fails the test suite.

## License

MIT
