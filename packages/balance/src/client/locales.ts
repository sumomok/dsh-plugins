/**
 * Copy for the browser half, in the two locales the harness ships.
 *
 * @module @sumomok/dsh-balance/client/locales
 */

/** Locale namespace this plugin owns. */
export const NS = 'balance'

/** Every key the browser half looks up. */
export type BalanceKey =
  | 'title'
  | 'clickToPin'
  | 'clickToUnpin'
  | 'refresh'
  | 'topUp'
  | 'granted'
  | 'toppedUp'
  | 'total'
  | 'suspended'
  | 'stale'
  | 'updated'
  | 'unavailable'
  | 'reason.http'
  | 'reason.network'
  | 'reason.timeout'
  | 'reason.malformed'
  | 'provider.label'
  | 'provider.unsupported'
  | 'loading'
  | 'quota.title'
  | 'quota.left'
  | 'quota.chipLeft'
  | 'quota.resets'
  | 'quota.window.weekly'
  | 'quota.window.hours'
  | 'quota.window.days'
  | 'quota.window.weeks'
  | 'quota.window.minutes'
  | 'quota.window.months'
  | 'quota.window.short.weekly'
  | 'quota.window.short.hours'
  | 'quota.window.short.days'
  | 'quota.window.short.weeks'
  | 'quota.window.short.minutes'
  | 'quota.window.short.months'
  | 'spend.title'
  | 'spend.today'
  | 'spend.month'
  | 'spend.allTime'
  | 'spend.since'
  | 'spend.sinceEmpty'
  | 'spend.pricesAsOf'
  | 'spend.unpriced'
  | 'spend.tokens'
  | 'spend.withinPlan'
  | 'spend.session'
  | 'spend.requests'
  | 'settings.nav'
  | 'settings.unavailable'
  | 'settings.readOnly'
  | 'settings.saving'
  | 'settings.saved'
  | 'settings.error'
  | 'settings.thresholds.title'
  | 'settings.thresholds.low'
  | 'settings.thresholds.critical'
  | 'settings.prices.title'
  | 'settings.prices.currency'
  | 'settings.prices.model'
  | 'settings.prices.provider'
  | 'settings.prices.per'
  | 'settings.prices.input'
  | 'settings.prices.inputCacheHit'
  | 'settings.prices.output'
  | 'settings.prices.cacheWrite'
  | 'settings.prices.reasoning'
  | 'settings.prices.addRow'
  | 'settings.prices.removeRow'
  | 'settings.prices.save'
  | 'settings.prices.tiers'

/** English copy. */
export const en: Record<BalanceKey, string> = {
  title: 'Account balance',
  clickToPin: 'Click to pin',
  clickToUnpin: 'Click again to unpin',
  refresh: 'Refresh',
  topUp: 'Top up',
  granted: 'Granted',
  toppedUp: 'Topped up',
  total: 'Total',
  suspended: 'The provider reports this account cannot serve requests',
  stale: 'Last known value; the latest refresh failed',
  updated: 'Updated {time}',
  unavailable: 'Balance unavailable',
  'reason.http': 'The provider answered with an error',
  'reason.network': 'The provider could not be reached',
  'reason.timeout': 'The provider did not answer in time',
  'reason.malformed': 'The provider answered with something unreadable',
  'provider.label': 'Provider',
  'provider.unsupported': 'Balance lookup is not supported for this provider',
  loading: 'Loading…',
  'quota.title': 'Remaining quota',
  'quota.left': '{percent}% left',
  'quota.chipLeft': 'left',
  'quota.resets': 'resets {time}',
  'quota.window.weekly': '7-day window',
  'quota.window.hours': '{n}-hour window',
  'quota.window.days': '{n}-day window',
  'quota.window.weeks': '{n}-week window',
  'quota.window.minutes': '{n}-minute window',
  'quota.window.months': '{n}-month window',
  'quota.window.short.weekly': '7d',
  'quota.window.short.hours': '{n}h',
  'quota.window.short.days': '{n}d',
  'quota.window.short.weeks': '{n}w',
  'quota.window.short.minutes': '{n}m',
  'quota.window.short.months': '{n}mo',
  'spend.title': 'Spend',
  'spend.today': 'Today',
  'spend.month': 'This month',
  'spend.allTime': 'All time',
  'spend.since': 'Counting since {date}',
  'spend.sinceEmpty': 'Nothing recorded yet',
  'spend.pricesAsOf': 'Prices: {currency} ({date})',
  'spend.unpriced': '{tokens} tok unpriced',
  'spend.tokens': '{tokens} tok',
  'spend.withinPlan': '{tokens} tok · within plan',
  'spend.session': '≈{amount} this session',
  'spend.requests': '{count} requests',
  'settings.nav': 'Balance',
  'settings.unavailable': 'This deployment has no settings document for this plugin',
  'settings.readOnly': 'Settings cannot be edited from this connection',
  'settings.saving': 'Saving…',
  'settings.saved': 'Saved',
  'settings.error': 'Could not save',
  'settings.thresholds.title': 'Balance color thresholds',
  'settings.thresholds.low': 'Warn below',
  'settings.thresholds.critical': 'Critical below',
  'settings.prices.title': 'Price table',
  'settings.prices.currency': 'Currency',
  'settings.prices.model': 'Model',
  'settings.prices.provider': 'Provider (optional)',
  'settings.prices.per': 'Per (tokens)',
  'settings.prices.input': 'Input',
  'settings.prices.inputCacheHit': 'Cached input',
  'settings.prices.output': 'Output',
  'settings.prices.cacheWrite': 'Cache write',
  'settings.prices.reasoning': 'Reasoning',
  'settings.prices.addRow': 'Add model',
  'settings.prices.removeRow': 'Remove',
  'settings.prices.save': 'Save price table',
  'settings.prices.tiers': 'Time-of-day tiers: {names} — edit them in the plugin configuration',
}

/** Chinese copy. */
export const zh: Record<BalanceKey, string> = {
  title: '账户余额',
  clickToPin: '点击固定',
  clickToUnpin: '再次点击取消固定',
  refresh: '刷新',
  topUp: '充值',
  granted: '赠送',
  toppedUp: '已充值',
  total: '合计',
  suspended: '服务方报告该账户当前无法提供服务',
  stale: '上次成功获取的数值,最近一次刷新失败',
  updated: '更新于 {time}',
  unavailable: '余额不可用',
  'reason.http': '服务方返回了错误',
  'reason.network': '无法连接服务方',
  'reason.timeout': '服务方响应超时',
  'reason.malformed': '服务方返回了无法解析的内容',
  'provider.label': '供应商',
  'provider.unsupported': '该供应商暂不支持余额查询',
  loading: '加载中…',
  'quota.title': '剩余额度',
  'quota.left': '剩余 {percent}%',
  'quota.chipLeft': '剩余',
  'quota.resets': '{time} 重置',
  'quota.window.weekly': '7 天窗口',
  'quota.window.hours': '{n} 小时窗口',
  'quota.window.days': '{n} 天窗口',
  'quota.window.weeks': '{n} 周窗口',
  'quota.window.minutes': '{n} 分钟窗口',
  'quota.window.months': '{n} 个月窗口',
  'quota.window.short.weekly': '7天',
  'quota.window.short.hours': '{n}小时',
  'quota.window.short.days': '{n}天',
  'quota.window.short.weeks': '{n}周',
  'quota.window.short.minutes': '{n}分钟',
  'quota.window.short.months': '{n}个月',
  'spend.title': '消费',
  'spend.today': '今日',
  'spend.month': '本月',
  'spend.allTime': '累计',
  'spend.since': '自 {date} 起统计',
  'spend.sinceEmpty': '尚无记录',
  'spend.pricesAsOf': '价格:{currency}({date})',
  'spend.unpriced': '{tokens} token 未计价',
  'spend.tokens': '{tokens} token',
  'spend.withinPlan': '{tokens} token · 订阅额度内',
  'spend.session': '本会话约 {amount}',
  'spend.requests': '{count} 次请求',
  'settings.nav': '余额',
  'settings.unavailable': '此部署没有该插件的设置文档',
  'settings.readOnly': '当前连接下无法编辑设置',
  'settings.saving': '保存中…',
  'settings.saved': '已保存',
  'settings.error': '保存失败',
  'settings.thresholds.title': '余额着色阈值',
  'settings.thresholds.low': '警告阈值',
  'settings.thresholds.critical': '严重阈值',
  'settings.prices.title': '价格表',
  'settings.prices.currency': '币种',
  'settings.prices.model': '模型',
  'settings.prices.provider': '供应商(可选)',
  'settings.prices.per': '计价单位(token 数)',
  'settings.prices.input': '输入',
  'settings.prices.inputCacheHit': '缓存输入',
  'settings.prices.output': '输出',
  'settings.prices.cacheWrite': '缓存写入',
  'settings.prices.reasoning': '推理',
  'settings.prices.addRow': '新增模型',
  'settings.prices.removeRow': '移除',
  'settings.prices.save': '保存价格表',
  'settings.prices.tiers': '分时价格档:{names} — 请在插件配置中编辑',
}
