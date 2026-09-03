/**
 * The provider ids this plugin hardcodes: the routes its own named adapters
 * serve, shared between the host half (the adapter registry) and the browser
 * half (the followed-provider fallback and the top-up link table). Each is
 * fixed by the provider plugin that registers the route, not by configuration.
 *
 * Every other provider id is data — read from `ctx.llm`'s directory or from a
 * session's own model selection, never compiled in here.
 *
 * This module holds no imports on purpose: the browser half loads it, so
 * anything host-only reached from here would be inlined into the client
 * bundle.
 *
 * @module @sumomok/dsh-balance/provider-id
 */

/** The provider route `@deepseek-ai/dsh-llm-deepseek` registers. */
export const DEEPSEEK_PROVIDER_ID = 'deepseek-official'

/** Display name shown for {@link DEEPSEEK_PROVIDER_ID} when no directory entry names one. */
export const DEEPSEEK_DISPLAY_NAME = 'DeepSeek'

/** Provider route id pi-ai registers for Moonshot AI's international route. */
export const MOONSHOTAI_PROVIDER_ID = 'moonshotai'

/** Provider route id pi-ai registers for Moonshot AI's China route. */
export const MOONSHOTAI_CN_PROVIDER_ID = 'moonshotai-cn'

/** Provider route id pi-ai registers for Kimi For Coding. */
export const KIMI_CODING_PROVIDER_ID = 'kimi-coding'
