# @haoran/dsh-quote-message

English | [中文](README.zh.md)

Cite earlier content of the **current** session while you compose: select a passage in any chat message, or pick a whole message with `@message`, and a native reference chip carries that text into your prompt.

The model then knows exactly what "this" refers to, and you did not retype it.

## Why

A conversation of any length makes pronouns expensive. "Fix the second problem you listed" costs the model a re-read of everything above and a guess about which item you mean, and the guess is wrong often enough that the cheapest repair is to paste the passage back in by hand.

Pasting by hand loses the source: the model sees text with no indication that it is a quotation of its own earlier answer, or of your own earlier prompt. This plugin makes the citation explicit — role, position, and the text — in one chip you can see before you send.

## The two entry points

**Select → quote.** Select text inside any chat message — a user prompt, an assistant reply, the text of a tool result — and a small `Quote` pill appears above the selection. Click it and the chip is appended to the end of your draft, followed by the composer's own separating space. It goes to the end rather than the caret because the input machine publishes no caret: its draft state carries the text and a revision counter, nothing about where you are in it. Escape, a click elsewhere, or scrolling dismisses the pill, and it never takes focus away from the composer.

**`@message`.** Type `@` in the composer and the menu carries a *Messages in this session* group listing this session's messages, newest first, as `#12 assistant · the first 80 characters …`. Typing filters on the message text. Picking one inserts the same chip, carrying the whole message.

Both produce one chip. It renders like the built-in `@file` / `@session` chips, survives editing around it, and is expanded only when you send.

## What the model receives

Each chip expands, at submit time, into one markdown blockquote spliced in where the chip sat:

```
> [quote #12 assistant message msg_01J…]
> the first quoted line
>
> the second quoted line
```

The header names the source: `#<seq>` is the session event position, followed by the role, plus the host's message id when it recorded one. A selection that spans several messages, or sits in a row that is not a message, quotes as `[quote]` or `[quote #34]` — the position without a role — rather than not quoting at all.

The header follows the interface language, read at the moment you send rather than the moment you insert, so the same chip serializes as `[quote #12 assistant message]` in English and `[引用 #12 助手消息]` in Chinese. The truncation note below stays English in both: it measures the excerpt rather than addressing the reader.

Nothing else is injected. The blockquote is part of your prompt, and the host logs it as the ordinary `user/message` it is.

## Limits

- **4000 characters per quote.** A longer message is cut at 4000 code points and the block ends with `…(truncated, 9123 chars total)`, so the model knows it is reading an excerpt.
- **The pill appends; it does not insert at the caret.** The published input state carries no caret to insert at.
- **This session only.** Cross-session citation is what the host's own `@session` reference is for.
- **Text only.** Images and attachments in the quoted message are not carried, and assistant reasoning blocks are not quoted — a quote carries what was said.
- **Remove and re-quote to change one.** A chip is not editable in place.

## Install

```sh
pnpm run build
cd packages/quote-message && pnpm pack --pack-destination ../../dist
dsh plugin --profile <name> add ../../dist/haoran-dsh-quote-message-0.1.0.tgz
```

Once published, `dsh plugin --profile <name> add @haoran/dsh-quote-message` installs the same thing from npm.

The manifest declares `dsh.bundle.patch`, so the install appends the package to the profile's `dsh.profile.bundles` and its patch layer mounts the plugin; nothing needs to be added to the profile's own `cordis.patch.yml`. Install the tarball rather than a `link:` path — a linked copy resolves its own `@deepseek-ai/*` and loads a second cordis, which gives the plugin a different service registry than the one the application runs on.

The profile needs a bundle that composes the Web surface (`@deepseek-ai/dsh-web-app`); there is nothing to see in a headless profile.

## Permissions / security

This plugin is **client-only**. Its host half is a no-op that exists so the loader sees a real cordis plugin.

- **No network.** It opens no connection of its own; the quoted text never leaves the page except inside the prompt you send.
- **No filesystem.** It reads and writes no file, in the workspace or anywhere else.
- **No custom session events.** It writes nothing to the session log. Everything it contributes reaches the model through the ordinary prompt, which the host logs as `user/message` — so uninstalling it can never leave a session the host refuses to load.
- **No host routes, no host services, no RPC.** Nothing is added to the web server or the remote API.
- **No storage.** The quote lives in the composer draft and nowhere else; there is no cache, no local storage, and no state that survives a reload.

What it does touch: the conversation snapshot of the current session (read), the input trigger registry (one `@` source), one slot in the composer dock, and `document` selection events.

## Compatibility

Built against `@deepseek-ai/*` `0.1.1-rc.2` — a host of that generation (desktop app or source checkout). The peer ranges accept `>=0.1.0-rc.1 <0.2.0`, spelled so prerelease hosts match: `^0.1.0-rc.7` does **not** satisfy `0.1.1-rc.2` under semver prerelease rules.

The seams it uses are the published ones: `inputTriggers.registerSource` with a `ReferenceInsert` outcome and a `ReferenceCodec`, the `conversation.input.dock` slot, and the scoped `slash/input-insert-reference` event. It does no DOM surgery on host-rendered bubbles, intercepts no composer keystroke, and installs no MutationObserver — the one thing it reads out of the host's DOM is the `data-chat-flow-key` attribute the web client puts on every chat row for its own scroll anchoring.

## License

MIT.
