# dsh-plugins

English | [中文](README.zh.md)

Three plugins for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web GUI, developed outside that repository and published to npm under the `@sumomok` scope.

The harness treats everything as a plugin, and its out-of-tree extension path is a first-class one: a profile under `$DSH_HOME/profiles/<name>` lists bundle layers in its `package.json`, and any npm package declaring `dsh.bundle.patch` can be one of them. Nothing here needs a fork of the upstream checkout or a patch to it.

## Packages

| Package | npm | What it does |
| --- | --- | --- |
| [`packages/quote-message`](packages/quote-message) | `@sumomok/dsh-quote-message` | Quote earlier content of the current session into the composer as a native reference chip. |
| [`packages/edit-rerun`](packages/edit-rerun) | `@sumomok/dsh-edit-rerun` | Edit an earlier question and run again from that point, in a forked child session. |
| [`packages/balance`](packages/balance) | `@sumomok/dsh-balance` | Show the DeepSeek account balance and what this installation has spent. |

**[`@sumomok/dsh-quote-message`](packages/quote-message)** lets you cite earlier content of the current session while you compose: select a passage in any chat message, or pick a whole message with `@message`, and a native reference chip carries that text into your prompt, expanding at submit time into one markdown blockquote that names its source by position and role. It is client-only — the host half is a no-op that exists so the loader sees a real cordis plugin. Full documentation: [English](packages/quote-message/README.md) · [中文](packages/quote-message/README.zh.md).

**[`@sumomok/dsh-edit-rerun`](packages/edit-rerun)** adds two buttons to every completed turn's action row: edit the question that opened the turn and run again from that point, or rerun it as is. Both fork a child session whose history ends immediately before that turn, so the original conversation is never modified and the wrong exchange never stays in the model's context. Full documentation: [English](packages/edit-rerun/README.md) · [中文](packages/edit-rerun/README.zh.md).

**[`@sumomok/dsh-balance`](packages/balance)** puts a chip beside Settings at the sidebar foot showing what is left in the provider account, with a popover breaking down the balance and what this installation has spent today, this month, and in total, plus a line under the composer showing what the open conversation has cost. The balance is the provider's own number; the spend is the harness's own logged token usage priced against a table this deployment owns and can change from `cordis.yml`. Full documentation: [English](packages/balance/README.md) · [中文](packages/balance/README.zh.md).

## Install

Each package is an ordinary npm package that declares `dsh.bundle.patch`, so the harness's own plugin command installs it into a profile:

```sh
dsh plugin --profile <name> add @sumomok/dsh-quote-message
dsh plugin --profile <name> add @sumomok/dsh-edit-rerun
dsh plugin --profile <name> add @sumomok/dsh-balance
```

The install appends the package to the profile's `dsh.profile.bundles` and its patch layer mounts the plugin; nothing needs to be added to the profile's own `cordis.patch.yml`. All three contribute browser-side UI, so the profile needs a bundle that composes the Web surface (`@deepseek-ai/dsh-web-app`) — there is nothing to see in a headless profile.

Every published tarball carries a prebuilt `lib/`, so an install never runs a build at the install site.

## Compatibility

Built against `@deepseek-ai/*` **0.1.1-rc.2** — a host of that generation, desktop app or source checkout. Node `^22.19 || >=24`.

The peer ranges are spelled `>=0.1.0-rc.1 <0.2.0-0` rather than `^0.1.0-rc.7`, because a caret range over a prerelease does not match a later prerelease under semver rules: `^0.1.0-rc.7` does **not** satisfy `0.1.1-rc.2`. Every `@deepseek-ai/*` peer is optional, so a host that composes only some of them still installs.

## Security summary

Each package's own README carries the full statement; this is the short form.

- **quote-message** — no network, no filesystem, no storage, no custom session events, no host routes or services. The quoted text reaches the model only inside the prompt you send, which the host logs as the ordinary `user/message` it is.
- **edit-rerun** — no network beyond the client's own session RPC over the connection the GUI already has, no filesystem, no custom session events, no host routes, no host logic (the host half is an empty `apply`). It renders into two published slots and calls three published client services; it does no DOM surgery on host-rendered messages and installs no `MutationObserver`.
- **balance** — network egress to the configured provider's origin and nowhere else; a base URL whose derivation would leave that origin is refused rather than fetched. The API key is resolved through the host credential seam once per read, sent as an `Authorization` header, and never logged, cached, written to disk, or returned to the browser. The two RPC methods it exposes are read-only. Its only disk write is its own spend ledger under `$DSH_HOME/dsh-balance`.

None of the three writes custom session-event types, so uninstalling one can never leave a session the host refuses to load.

## Development

```sh
pnpm install
pnpm run build       # each package's own build: tsc, then its bundler
pnpm run test        # vitest over every package
pnpm run typecheck
pnpm run lint
```

Build before test: `packages/edit-rerun`'s build smoke reads the artifacts under its `lib/`, so a bare `pnpm run test` on a never-built checkout fails there rather than skipping.

Each package owns its whole build, because each emits a browser bundle in the closure-factory form the web shell's module loader consumes, which no shared node-platform config can produce. `pnpm --filter @sumomok/dsh-<name> run build` builds one on its own.

```
package.json          workspace root: shared toolchain, no runtime dependencies
pnpm-workspace.yaml   packages/*
tsconfig.base.json    the compiler face every package extends
tsconfig.json         solution file; one reference per package
eslint.config.js
packages/<name>/
  package.json        @sumomok/dsh-<name>
  tsconfig.json       extends ../../tsconfig.base.json
  cordis.patch.yml    the bundle layer this package contributes
  src/                sources; local imports carry the .ts extension
  tests/              vitest specs
  lib/                build output (git-ignored; shipped in the npm tarball)
```

`lib/` is git-ignored here and listed in each manifest's `files`, so the repository carries sources only while every published tarball carries the prebuilt artifacts.

## License

MIT.
