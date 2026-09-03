/**
 * This plugin's own settings namespace name, shared between the host half
 * (which passes it straight to `SettingsProvider.installSection`, resolving
 * the branded `SettingsNamespace` internally from the plain string) and the
 * browser half (which binds a scope over the same raw string —
 * `SettingsScopeSpec.namespace` takes a plain string too, so neither half has
 * a reason to import `@deepseek-ai/dsh-settings`'s branded type at all).
 *
 * @module @sumomok/dsh-balance/settings-namespace
 */

/** The namespace name, matching this plugin's own cordis short name. */
export const BALANCE_SETTINGS_NAMESPACE_NAME = 'balance'
