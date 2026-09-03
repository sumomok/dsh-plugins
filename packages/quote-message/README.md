# @sumomok/dsh-quote-message

English | [中文](README.zh.md)

Cite earlier content of the **current** session while you compose: select a passage in any chat message and a native reference chip carries that text into your prompt. When you send it, the quote comes back as its own card above your message instead of a row of `>` lines inside it.

The model then knows exactly what "this" refers to, and you did not retype it.

## Why

A conversation of any length makes pronouns expensive. "Fix the second problem you listed" costs the model a re-read of everything above and a guess about which item you mean, and the guess is wrong often enough that the cheapest repair is to paste the passage back in by hand.

Pasting by hand loses the source: the model sees text with no indication that it is a quotation of its own earlier answer, or of your own earlier prompt. This plugin makes the citation explicit — role, position, and the text — in one chip you can see before you send.

## How it works

**Select → quote.** Select text inside any chat message — a user prompt, an assistant reply, the text of a tool result — and a small `Quote` pill appears above the selection. Click it and the chip is appended to the end of your draft, followed by the composer's own separating space. It goes to the end rather than the caret because the input machine publishes no caret: its draft state carries the text and a revision counter, nothing about where you are in it. Escape, a click elsewhere, or scrolling dismisses the pill, and it never takes focus away from the composer.

The chip renders like the built-in `@file` / `@session` chips — same height, same colour, and a session glyph in place of the `@`, because a quote points at a message in this session — survives editing around it, and is expanded only when you send.

**`@` is not ours.** The trigger belongs to files and sessions; this plugin adds no group to that menu. It registers one trigger source carrying nothing but the codec, because a reference occurrence is expanded by looking its source name up in that roster — the registration is what makes a chip sendable, not a way onto the menu.

## What the model receives

Each chip expands, at submit time, into one markdown blockquote spliced in where the chip sat:

```
> Quote:
> the first quoted line
>
> the second quoted line
```

The header says one thing: that what follows is a quotation. Position, role, and the host's internal message id stay out of it — those are your context for choosing the passage, not the model's for reading it. The chip still carries them in its own payload (its label reads `Quote #12 assistant`, and a future resolver can use the id), and no projection a human or the model reads ever prints the id.

The header follows the interface language, read at the moment you send rather than the moment you insert: `Quote:` in English, `引用：` in Chinese. The truncation note below stays English in both — it measures the excerpt rather than addressing the reader.

Nothing else is injected. The blockquote is part of your prompt, and the host logs it as the ordinary `user/message` it is.

## In the transcript

A sent quote does not stay a run of `>` lines inside your bubble. The plugin lifts it above the message and sets it as a bare citation: a 2px rule down the left edge and the quoted text in secondary ink, no box and no label, in a right-aligned column that hugs the text under the bubble's own width cap. A quote longer than three lines clamps with a `Show more` toggle; the toggle appears only when the text really overflows, and expanding is a view state, not something stored. The `> Quote:` line the model reads marks a quotation rather than belonging to it, so it is dropped from what is displayed and never from what is logged.

This is a **shadow**, not a patch. The keyed `conversation.chat.node` slot renders the lowest-priority live entry of each cell, so this plugin registers for `user` and `steering` at `priority: -1`, reads the host's own renderer out of the slot ledger, and hands everything back to it — the host entry stays registered at its default priority and is never replaced or imported. A message with no quote block reaches it untouched: the render test asserts byte-identical markup against the incumbent rendered alone, and a browser capture of a plain message with and without the plugin installed differs in 20 of 287264 pixels, all inside the scrollbar column, none by more than 2/255.

**Retirement.** The day the harness renders quoted content itself, this half of the plugin is deleted and only the serialization stays. The shadow exists because the client publishes no submit-phase seam and no per-message decoration slot: a quote has to travel inside the prompt text, so lifting it back out can only be a render-time decision.

## Limits

- **4000 characters per quote.** A longer message is cut at 4000 code points and the block ends with `…(truncated, 9123 chars total)`, so the model knows it is reading an excerpt.
- **The pill appends; it does not insert at the caret.** The published input state carries no caret to insert at.
- **This session only.** Cross-session citation is what the host's own `@session` reference is for.
- **Text only.** Images and attachments in the quoted message are not carried, and assistant reasoning blocks are not quoted — a quote carries what was said.
- **Remove and re-quote to change one.** A chip is not editable in place.
- **Selection only.** There is no picker: quoting starts from text you select in the chat.
- **Copy copies the remainder, not the quote.** The host's copy action reads the bubble's own content, and the quote is no longer in it; on a quote-only message it copies nothing. The card's text is selectable, and the session log still holds the whole prompt.
- **Only a quote at an end of the message becomes a card.** A `>` run in the middle is your own prose and stays where you put it.

## Install

```sh
pnpm run build
cd packages/quote-message && pnpm pack --pack-destination ../../dist
dsh plugin --profile <name> add ../../dist/sumomok-dsh-quote-message-0.3.1.tgz
```

Once published, `dsh plugin --profile <name> add @sumomok/dsh-quote-message` installs the same thing from npm.

The manifest declares `dsh.bundle.patch`, so the install appends the package to the profile's `dsh.profile.bundles` and its patch layer mounts the plugin; nothing needs to be added to the profile's own `cordis.patch.yml`. Install the tarball rather than a `link:` path — a linked copy resolves its own `@deepseek-ai/*` and loads a second cordis, which gives the plugin a different service registry than the one the application runs on.

The profile needs a bundle that composes the Web surface (`@deepseek-ai/dsh-web-app`); there is nothing to see in a headless profile.

## Permissions / security

This plugin is **client-only**. Its host half is a no-op that exists so the loader sees a real cordis plugin.

- **No network.** It opens no connection of its own; the quoted text never leaves the page except inside the prompt you send.
- **No filesystem.** It reads and writes no file, in the workspace or anywhere else.
- **No custom session events.** It writes nothing to the session log. Everything it contributes reaches the model through the ordinary prompt, which the host logs as `user/message` — so uninstalling it can never leave a session the host refuses to load.
- **No host routes, no host services, no RPC.** Nothing is added to the web server or the remote API.
- **No storage.** The quote lives in the composer draft and nowhere else; there is no cache, no local storage, and no state that survives a reload.

What it does touch: the conversation snapshot of the current session (read), the input trigger registry (one `@` source), one slot in the composer dock, two keyed chat-node cells it shadows to draw the card, and `document` selection events.

## Compatibility

Built against `@deepseek-ai/*` `0.1.1-rc.2` — a host of that generation (desktop app or source checkout). The peer ranges accept `>=0.1.0-rc.1 <0.2.0`, spelled so prerelease hosts match: `^0.1.0-rc.7` does **not** satisfy `0.1.1-rc.2` under semver prerelease rules.

The seams it uses are the published ones: `inputTriggers.registerSource` with a `ReferenceInsert` outcome and a `ReferenceCodec`, the `conversation.input.dock` slot, the scoped `slash/input-insert-reference` event, and the keyed `conversation.chat.node` slot, entered at `priority: -1` for `user` and `steering` (documented shadowing: lowest live priority renders). It does no DOM surgery on host-rendered bubbles, intercepts no composer keystroke, and installs no MutationObserver — the one thing it reads out of the host's DOM is the `data-chat-flow-key` attribute the web client puts on every chat row for its own scroll anchoring.

## License

MIT.
