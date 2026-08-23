/**
 * Copy for the browser half, in the two locales the harness ships.
 *
 * @module @haoran/dsh-balance/client/locales
 */

/** Locale namespace this plugin owns. */
export const NS = 'balance'

/** Every key the browser half looks up. */
export type BalanceKey =
  | 'title'
  | 'clickToRefresh'
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
  | 'spend.title'
  | 'spend.today'
  | 'spend.month'
  | 'spend.allTime'
  | 'spend.since'
  | 'spend.sinceEmpty'
  | 'spend.pricesAsOf'
  | 'spend.unpriced'
  | 'spend.session'
  | 'spend.requests'

/** English copy. */
export const en: Record<BalanceKey, string> = {
  title: 'Account balance',
  clickToRefresh: 'Click to refresh',
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
  'spend.title': 'Spend',
  'spend.today': 'Today',
  'spend.month': 'This month',
  'spend.allTime': 'All time',
  'spend.since': 'Counting since {date}',
  'spend.sinceEmpty': 'Nothing recorded yet',
  'spend.pricesAsOf': 'Prices as of {date}',
  'spend.unpriced': '{tokens} tok unpriced',
  'spend.session': '≈{amount} this session',
  'spend.requests': '{count} requests',
}

/** Chinese copy. */
export const zh: Record<BalanceKey, string> = {
  title: '账户余额',
  clickToRefresh: '点击刷新',
  granted: '赠送',
  toppedUp: '充值',
  total: '合计',
  suspended: '服务方报告该账户当前无法提供服务',
  stale: '上次成功获取的数值,最近一次刷新失败',
  updated: '更新于 {time}',
  unavailable: '余额不可用',
  'reason.http': '服务方返回了错误',
  'reason.network': '无法连接服务方',
  'reason.timeout': '服务方响应超时',
  'reason.malformed': '服务方返回了无法解析的内容',
  'spend.title': '消费',
  'spend.today': '今日',
  'spend.month': '本月',
  'spend.allTime': '累计',
  'spend.since': '自 {date} 起统计',
  'spend.sinceEmpty': '尚无记录',
  'spend.pricesAsOf': '价格数据日期 {date}',
  'spend.unpriced': '{tokens} token 未计价',
  'spend.session': '本会话约 {amount}',
  'spend.requests': '{count} 次请求',
}
