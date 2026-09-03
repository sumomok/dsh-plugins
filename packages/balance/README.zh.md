# @sumomok/dsh-balance

[English](README.md) | 中文

DeepSeek Harness Web 界面的账户余额与消费统计。侧边栏底部一个图框跟随当前会话所选模型所属的供应商,显示该账户的剩余余额(`DeepSeek ¥12.34`)——切换会话、或在会话内切换模型都会跟着变。悬停展开面板,顶部是一个供应商下拉(覆盖本部署当前能查到余额的那些供应商),下面是该供应商的余额构成,以及本机在该供应商上今日、本月、累计的消费——消费跟着下拉走,余额下面那个数字就是这条路由自己的。输入框下方另有一行,显示当前会话花了多少。

余额是服务方自己给的数字:DeepSeek 和 Moonshot AI(`moonshotai`、`moonshotai-cn`)都走各自的专属适配器;Kimi For Coding(`kimi-coding`)的订阅配额走它自己的适配器(按窗口给「已用百分比」,而不是货币余额);其余任何已配置的供应商走一个尽力而为的通用适配器,依次尝试几种常见 OpenAI 兼容网关会回答的端点形状。消费是把 harness 已经记录的 token 用量,乘以本部署自己拥有的价格表算出来的——运行时不抓取任何页面;价格表里没有的模型,记为「未计价 token」,而不是悄悄当成 0。

## 显示什么,显示在哪

**侦察结论:落位在 `sidebar.footer.action`,不在「设置」同一行。** 没有槽位能让第三方插件挤进「设置」触发按钮的同一行:`SidebarRoot.tsx` 的 `.footArea` 里,`sidebar.settings` 与 `sidebar.footer.action` 是纵向堆叠(`flex-direction: column`)的两个独立满宽 flex 子项,而「设置」触发按钮自己的内容(图标+文字)本身是一个单占用槽位(`settings.trigger`),已经被 `ui-settings-general` 占用。要落到「设置」同一行,core 需要二选一:(a) 把 `.footArea` 改成 `flex-direction: row`,让 `sidebar.footer.action` 靠右而不是堆叠在 `sidebar.settings` 上方;(b) 在触发按钮内部新开一个「尾部内容」槽位,且不能抢走按钮本身的点击目标。两者都没有,于是维持原位(`sidebar.footer.action`,仍在「设置」正上方),只是改成单行样式。

| 界面 | Slot | 内容 |
| --- | --- | --- |
| 侧边栏底部图框 | `sidebar.footer.action` | `供应商 ¥12.34`,按配置的阈值着色,供应商为当前会话所选模型所属的那一个。作为普通 flex 子项——这一行可能有别的插件共享——会撑满这一行留给它的宽度(独占时是整行,与别的插件共享时是它自己的那一份),供应商名靠最左、金额靠最右;挤不下供应商名时才退化成 `¥12.34`,而不是把邻居挤开或换行。56 px 窄栏下只显示金额;展开态悬停打开浮层。 |
| 浮层 | — | 顶部是供应商下拉(覆盖本部署当前能查到余额的供应商,见下),然后是该供应商的余额构成,以及本机在**该供应商**上的今日 / 本月 / 累计消费及各价格档位占比、价格表日期。按订阅配额计量的供应商,消费显示为「N token · 订阅额度内」——订阅没有单次金额;按量计费但价格表没配的,显示为「N token 未计价」。列表不足两项时下拉隐藏——没什么可选的。浮层底部除「刷新」外还有「充值」——针对下拉当前所指的那个供应商,且本插件收录了它的充值页时才出现。 |
| 会话消费行 | `conversation.composer.dock` | `本会话约 $0.12`;若该会话有模型不在价格表内,追加 `· N token 未计价`。不受供应商下拉影响:这里始终是当前会话自己在同一份部署价格表下的账目(见「不做的事」)。 |

悬停图框预览浮层;移出后进入 200ms 宽限期,让指针能跨过到 `position: fixed` 浮层之间的空隙而不被关闭,重新进入图框或浮层都会取消这次关闭。点击图框会把浮层固定展开——鼠标移出不再关闭它——直到在图框与浮层之外点击、按 Escape,或再次点击图框;浮层内部有元素处于焦点(例如供应商下拉的选项列表展开中)时,鼠标移出同样不会关闭它。浮层底部的「刷新」按钮才会立即刷新所跟随供应商的两项读取;图框自身的点击不再触发刷新。旁边的「充值」按钮在新窗口打开下拉当前所指供应商自己的充值页——桌面应用下交给系统浏览器,普通浏览器下是新标签页。

## 跟随会话

图框显示的供应商 = 当前会话所选模型所属的供应商,直接读取该会话自己的持久 `modelSelection` 投影——与 `@haoran/dsh-vision-switch` 所用的同一条同步、零往返读取——绝不额外猜测。切换会话会立即重新解析;共享轮询每一跳也会重新解析一次,这同时也是「会话内切换模型」被跟上的机制。空白/无会话视图、被寻址的子代理会话、或尚未记录任何选择的会话,都回落到 DeepSeek。

## 供应商下拉

浮层顶部的下拉只列本部署当前能查到余额的供应商,分两步筛:先静态筛到这个插件的适配器原则上够得着的供应商——DeepSeek 的专属适配器,加上可配置供应商目录声明的每条路由(通用适配器唯一够得着的范围);再逐一探测这些候选里哪些真的有凭据能解出来,每个供应商复用 `AdapterRegistry` 同一份缓存读一次,轮询已经有新鲜答案的那一跳不会多打一次网络请求。没通过任一步筛选的供应商根本不会出现在下拉里——不会再点开看到一句「暂不支持余额查询」。所跟随的供应商无论是否通过筛选都会排在第一位:它的余额已经被取来这份名单的同一次调用读过了,浏览器一侧会在宿主自己的答案漏掉它时补回来。列表不足两项时整行隐藏,浮层其余部分照常显示。选中某一项只预览它的余额与它自己的消费,不会改变图框跟随的对象;选回被跟随的供应商(或不选)即恢复跟随。这次选择只在这一次浮层里有效:每次打开浮层——悬停打开,或点击固定打开——下拉都从当前会话所跟随的供应商重新开始,所以刚才那次对比不会带到下一次;期间会话若换了模型,下一次打开就落在新模型所属的供应商上。

## 充值链接

浮层里的「充值」按钮打开下拉当前所指供应商自己收款的那个页面。地址是一张硬编码表(`src/client/top-up-links.ts`),**由人工维护,每次发版逐条重新核对**——它们是控制台页面而不是接口,页面搬家时本插件无从察觉。最近一次核对:2026-09-03。

| 供应商 | 页面 |
| --- | --- |
| `deepseek-official` | `https://platform.deepseek.com/top_up` |
| `moonshotai` | `https://platform.kimi.ai/console/pay` |
| `moonshotai-cn` | `https://platform.kimi.com/console/pay` |
| `kimi-coding` | `https://www.kimi.com/membership/pricing` |

表里没有的供应商不显示按钮:部署自己配置的各种网关都属于这一类,它们的账单页本插件无从知晓,也不会拿 API 的 origin 去猜。Kimi For Coding 卖的是订阅而不是余额,所以它这一条指向购买与续费所在的会员页。按钮打开的是新窗口而不是就地跳转——桌面外壳会把它交给系统浏览器,正在运行的会话不会被顶掉。

## 适配器注册表

一套缓存(刷新窗口、重试窗口、在途请求去重、刷新失败时served旧值)之下有两类成员:

- **专属适配器**,各自带自己的端点解析逻辑,排在通用兜底之前:本插件一直有的 DeepSeek,以及 Moonshot AI 的两条路由。
- **通用兜底**,服务于 `ctx.llm` 可配置供应商目录能给出一个已配置 `baseURL` 的任何其他供应商(用 Models 页的话说,即自定义 base URL 条目)。它依次尝试**one-api/new-api 形状**的用户余量端点(`GET /api/user/self`,把返回的无量纲 `quota` 按配置比例换算成货币金额)和**旧版 OpenAI dashboard billing 组合**(`GET /dashboard/billing/subscription` + `/dashboard/billing/usage`,`hard_limit_usd` 减去以分为单位的 `total_usage`)。这里只按公开文档参考端点*形状*,不抄任何第三方源码。端点候选列表是 `genericEndpoints`(见下),网关两种都不认时可以自己配一份。首个应答成功的形状会按供应商记住(仅存于运行时;重启后重新探测),这样匹配过的供应商不必每次都重新探测一遍。每个候选 URL 都被限定在该供应商自己配置的 origin 内。任何失败——目录里没有该条目、没有配置 `baseURL`、没有 key、或全部形状都失败——都回答安静的 `unconfigured` 状态(短 TTL 负缓存,与读取器平时的重试窗口相同),绝不是专属适配器那种带具体原因的 `unavailable`。

### 专属适配器

| 供应商 id | 端点 | Base URL | 币种 | 余额行映射 |
| --- | --- | --- | --- | --- |
| `deepseek-official` | `GET /user/balance`(由 chat base URL 推导) | `llm-deepseek` 设置,默认 `https://api.deepseek.com` | 账户自身货币,来自 `balance_infos` | `total`/`granted`/`toppedUp` ← `total_balance`/`granted_balance`/`topped_up_balance` |
| `moonshotai` | `GET /v1/users/me/balance` | `llm-pi-ai` 设置(`providers.moonshotai`),默认 `https://api.moonshot.ai` | 固定 **USD**——端点本身不带币种 | `total`/`granted`/`toppedUp` ← `available_balance`/`voucher_balance`/`cash_balance` |
| `moonshotai-cn` | `GET /v1/users/me/balance` | `llm-pi-ai` 设置(`providers.moonshotai-cn`),默认 `https://api.moonshot.cn` | 固定 **CNY**——端点本身不带币种 | 映射与 `moonshotai` 相同 |
| `kimi-coding` | `GET /coding/v1/usages`(404 → `/coding/v1/usage`) | 固定 `https://api.kimi.com` | —(是订阅配额,不是货币余额) | 一个 `quota` 视图——每个计量周期一个窗口,各自一个「已用百分比」(界面上按剩余显示);见下 |

`kimi-coding` 是唯一报告订阅配额而非货币余额的适配器,因此它产出 `quota` 视图(见下)而不是 `ok`。Kimi For Coding 把订阅按用量窗口计量——一个周窗加一个或多个滚动窗口——从 Kimi 自己的 coding-plan 用量端点读取,也就是 Kimi CLI 读取订阅剩余配额的同一个端点。该端点不属于 Moonshot 开放平台文档化的 HTTP 面;它只对 Kimi CLI 自己的客户端标识回答用量数据,所以请求带 `User-Agent: KimiCLI/1.6`(该端点要求的客户端标识头——真正给账户鉴权的是订阅 Key 而非这个头,账户是调用者自己的)。响应按防御式解析:未公开的端点结构可能随客户端版本变化,所以任何缺失或类型不符的字段都降级为 `unavailable` 而不是报错。计数既可能是 JSON 数字,也可能——自该端点改为 protobuf-JSON 后(2026-09-02 实测)——是十进制字符串,单位是枚举名(`TIME_UNIT_MINUTE`);两种都读,整小时的分钟跨度按小时命名(`300 MINUTE` → `5h`)。profile 未命名 `apiKeyEnv` 时,凭据默认取 `KIMI_CODING_API_KEY`(CLI 自己用的 `sk-kimi-*` 订阅 Key);固定的用量端点忽略任何已配置的聊天 base URL。不查任何价格表条目:配额读取不带任何按模型的消费。

两条 Moonshot 路由读的是同一份文档化响应体——`{ code, data: { available_balance, voucher_balance, cash_balance }, scode, status }`,已于 2026-08-31 对照 <https://platform.kimi.com/docs/api/balance>(中国)与 <https://platform.kimi.ai/docs/api/balance>(国际)核实;两个文档域名如今都从 `platform.moonshot.cn`/`platform.moonshot.ai` 重定向而来,与 API 自己的请求域名(`api.moonshot.cn`/`api.moonshot.ai`)无关,两者都不受这次重定向影响——两条路由只在 base URL 与计费币种上不同,所以由一个参数化的适配器同时服务,按 id 分别注册进适配器注册表。`isAvailable` 读的是响应自身的 `status` 字段,是文档里离 DeepSeek 那种明确 `is_available` 最近的等价物。连接信息的查找方式与通用兜底查找任何其他 pi-ai 路由供应商完全一致——都走 `ctx.llm` 的可配置供应商目录——但 profile 未命名 `apiKeyEnv` 时,默认值是 `MOONSHOT_API_KEY`:pi-ai 自己两条路由共用的内置环境变量,而不是通用兜底会推导出的按 id 区分的名字(`MOONSHOTAI_API_KEY`/`MOONSHOTAI_CN_API_KEY`)。这两条路由都不需要、也不会查任何价格表条目:余额读取不带任何按模型的消费,只有账户合计。

## 刷新策略

宿主缓存的是答案,不是密钥。

- 一次成功读取在 `refreshMs`(默认 60 秒)内直接复用。窗口内所有标签页共享它,多开一个屏幕不会多打一次服务方请求。
- 一次失败读取在 `retryMs`(默认 15 秒)内不再尝试,避免一个坏掉的端点被每个标签页各敲一遍。
- 并发调用共用同一个在途请求。点击浮层的「刷新」按钮会跳过刷新窗口,但仍然并入已在途的请求。
- 刷新失败而此前读到过数值时,旧数值继续显示(变暗),浮层写明它是旧值。一分钟前的余额比一个破折号有用,只要它承认自己旧。
- 浏览器端按 `refreshMs` 轮询,标签页不可见时整跳过该次。

## 三种状态,各自渲染什么

`get(provider?, force?)` 返回三种状态之一,针对它点名的那个供应商(省略时即被跟随的供应商)。

| 状态 | 字段 | 渲染 |
| --- | --- | --- |
| `ok` | `currency`、`total`、可选的 `granted`/`toppedUp`、`isAvailable`、`fetchedAt`、`stale` | 图框,余额保留两位小数。高于 `lowBalance` 为常态色;低于它为警告色;低于 `criticalBalance`、或服务方报告 `isAvailable: false` 时为危险色——账户可能余额充足却被停用。`stale: true` 时图框变暗,浮层加一行说明。`granted`/`toppedUp` 是专属适配器自己的构成拆分(DeepSeek 的 `granted_balance`/`topped_up_balance`,或 Moonshot 的 `voucher_balance`/`cash_balance`);通用适配器的读取只有 `total`。 |
| `quota` | `windows`(每个含 `key`、`usedPercent`、`resetsAt`)、`isAvailable`、`fetchedAt`、`stale` | `kimi-coding` 的订阅配额。图框显示每个窗口**剩余**多少并带标签(`剩余 7天 58% · 5小时 95%`),代替货币金额;浮层逐个列出每个窗口的「剩余 58%」及其重置时间——一天之内只显示时刻,更远的带日期。周窗命名为「7 天窗口」,滚动窗口按跨度命名(「5 小时窗口」)。不着色(配额没有货币阈值);`isAvailable: false`——主窗口已用满——加「已停用」说明,`stale: true` 与 `ok` 一样变暗。 |
| `unconfigured` | — | 对**被跟随**的供应商:**什么都不渲染。** 没有可用密钥、没有适配器能服务这个供应商、或通用适配器探测无果。从没打算用这个功能的部署,看到的就是装插件之前那个侧边栏。对**下拉**里显式选中的供应商:「该供应商暂不支持余额查询」——用户主动问了,这次就给解释而不是隐藏。 |
| `unavailable` | `reason`(`http` / `network` / `timeout` / `malformed`)、可选 `status`、`fetchedAt` | 只有专属适配器会用到(DeepSeek、`moonshotai`、`moonshotai-cn`、`kimi-coding`)——通用适配器的失败都并入上面那个安静的 `unconfigured`。变暗的 `—`,原因写在 tooltip 里。原因只是分类,不含服务方原文,也不含端点。 |

`providers()` 返回下拉的名单:`{ id, displayName }[]`,DeepSeek 排第一。

## 配置

每一项都在加载时校验,都可以从 `cordis.yml` 改。bundle patch 里写出了完整的默认块;profile 自己的 patch 若针对 `balance` 这个 id,会**整块替换** config,所以要保留的键必须逐条重写。

设置 → 余额页面(`settings.section`)也图形化暴露了其中两项,读写走 harness 自己的设置文档而非 `cordis.yml`:价格表中已有币种的按模型基础费率(可增删模型行;新增币种或编辑分时价格档不在此页面暴露——保存某行时,该行原有的价格档原样带过,绝不丢弃,只以只读文字概述),以及 `lowBalance`/`criticalBalance`。两者都立即生效,无需重启。下表其余每一项——包括价格档本身——仍然只能通过 `cordis.yml`/直接编辑设置文档并重启生效。

| 键 | 默认值 | 含义 |
| --- | --- | --- |
| `refreshMs` | `60000` | 一次成功读取的复用时长。最小 5000。 |
| `retryMs` | `15000` | 一次失败读取的静默时长。最小 1000。 |
| `timeoutMs` | `8000` | 单次余额请求的墙钟预算。最小 1000。 |
| `currency` | `[CNY, USD]` | 货币优先顺序。这一个列表决定两件事:账户持有多种货币余额时显示哪一行,以及在账户自身货币未知之前按哪份价格表计价。 |
| `lowBalance` | `10` | 低于此值显示警告色。 |
| `criticalBalance` | `1` | 低于此值显示危险色。不得高于 `lowBalance`。 |
| `ledgerDays` | `400` | 账目保留天数;更早的行在启动时丢弃并重写文件。 |
| `timezone` | `''` | 计算「今日 / 本月」边界所用的 IANA 时区。留空表示宿主进程所在时区。 |
| `root` | `''` | 账目文件所在目录。留空表示 `$DSH_HOME/dsh-balance`。 |
| `surfaces.footer` | `true` | 是否放出侧边栏底部图框。 |
| `surfaces.sessionSpend` | `true` | 是否放出会话消费行。 |
| `prices` | DeepSeek 公布的 CNY 与 USD 价 | 分币种的价格表,见下。 |
| `genericEndpoints` | one-api/new-api 用户余量端点,其次 OpenAI dashboard billing 组合 | 通用兜底适配器为 DeepSeek 以外的任何供应商依次尝试的候选端点形状,见「适配器注册表」。 |

这里不配置任何供应商的连接。DeepSeek 的仍从 `llm-deepseek` 设置分节读取,解析顺序与该 provider 自己完全一致(`baseURL`,其次 `$DEEPSEEK_BASE_URL`,再次 `https://api.deepseek.com`;`apiKeyEnv` 默认 `DEEPSEEK_API_KEY`)。`moonshotai` 与 `moonshotai-cn` 从 `ctx.llm` 可配置供应商目录所说的地址读取,即 `llm-pi-ai` 设置分节下的 `providers.moonshotai`/`providers.moonshotai-cn`,与任何其他 pi-ai 路由供应商一致;`baseURL` 默认取各自路由自己的公开 origin(`https://api.moonshot.ai`、`https://api.moonshot.cn`),`apiKeyEnv` 默认 `MOONSHOT_API_KEY`——这是 pi-ai 自己两条路由共用的内置默认值,而不是下面推导出的按 id 区分的名字。其余任何供应商的 `baseURL`/`apiKeyEnv` 都按同样的目录寻址方式读取;profile 未命名 `apiKeyEnv` 时,推导规则与 Models 页完全一致(`<供应商>_API_KEY`)。把供应商指到别处,本插件跟着走。

## 价格表

这些数字由你维护。价格**按币种**分表,每个币种一份:一家收两种货币的服务方公布的是两份价目表,而不是一份表加一个汇率——而「余额 ¥ / 消费 $」这两个数字没人能对得起来。

内置默认值带上了 DeepSeek 公布的两份表,均于 **2026-08-23** 抄录:

| 模型 | CNY 每 1M(未命中 / 命中 / 输出) | USD 每 1M(未命中 / 命中 / 输出) |
| --- | --- | --- |
| `deepseek-v4-flash` | ¥1.5 / ¥0.05 / ¥4.5 | $0.22 / $0.007 / $0.66 |
| `deepseek-v4-pro` | ¥4.5 / ¥0.15 / ¥13.5 | $0.66 / $0.022 / $1.98 |
| `deepseek-v4-flash-vision-exp` | ¥1.5 / ¥0.05 / ¥4.5 | $0.22 / $0.007 / $0.66 |

以上是空闲时段价,高峰时段翻倍。来源:<https://api-docs.deepseek.com/zh-cn/quick_start/pricing>(CNY,原文「空闲时段价格为高峰时段价格的一半。高峰时段为北京时间周一至周五 9:00 - 12:00、14:00 - 18:00(其余为空闲时段)。」)与 <https://api-docs.deepseek.com/quick_start/pricing>(USD,原文 "Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday")。两者指的是同一批时刻——北京时间 09:00 就是 UTC 01:00——每份表都按它自己那一页的时区书写而不做换算,于是两份都能直接和来源对照。DeepSeek 改价时更新对应的表并改 `asOf`,浮层会把它显示在币种旁边。运行时不会去抓这两个页面。

### 用哪一份表

1. 账户自身的计费货币——只要有一次余额读取成功就知道了;正是它让余额和消费两个数字可比。
2. 否则取 `currency` 里第一个该表有价格的币种。
3. 否则 `USD`,再否则按名称排序的第一份表——这样选择永远不是随机的。

浮层会写明用的是哪一份:`价格:CNY(2026-08-23)`。切换会重算一切——会话投影的缓存版本把币种和费率一起算进去了。

### 结构

schema 里没有任何厂商专有词汇。一个条目写出自己的基准价,和一组有序的具名档位;每个档位在该条目自己的 IANA 时区里声明若干时间窗,并且要么重写价格,要么给基准价乘一个系数。请求时刻落入的第一个档位生效;不落入任何窗口时用基准价。

```yaml
prices:
  asOf: '2026-08-23'          # 界面上显示在币种旁边
  tables:                     # 每个币种一份;服务方收哪种货币就加哪一份
    CNY:
      entries:
        - model: deepseek-v4-flash
          provider: deepseek-official   # 可选;省略则该模型在任意路由上都用这条
          per: 1000000                  # 一个费率单位覆盖多少 token
          timezone: Asia/Shanghai       # 下面时间窗所用的时区
          baseName: off-peak            # 基准档在界面上的名字(默认 "standard")
          base:
            input: 1.5                  # 未命中缓存的输入 token
            inputCacheHit: 0.05         # 命中缓存的输入 token
            output: 4.5                 # 生成 token
            # cacheWrite: 省略即取 `input`
            # reasoning:  省略即取 `output`
          schedules:
            - name: peak
              multiplier: 2             # …… 或 `rates: { input, inputCacheHit, output }`,二者只能取其一
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

加载时强制校验、不合规即报错的规则:

- `tables` 至少要有一个币种,且每个键都是三字母 ISO 4217 代码。
- 一个档位必须且只能声明 `rates` 与 `multiplier` 之一。
- `start` / `end` 为 `HH:MM`,`end` 不含端点;`end` 不晚于 `start` 表示跨午夜(`22:00`–`02:00` 是四小时),跨午夜的窗口归属于它开始的那一天。
- `days` 用 JavaScript 星期序号——**0 是周日**,6 是周六。省略(或空数组)表示每天。
- `timezone` 必须是本运行时认识的 IANA 时区;`per` 必须为正;费率不得为负;同一份币种表内、同一 provider 下同一模型只能出现一次。

DeepSeek 两份表都没有单独给缓存写入和思考 token 定价,所以这两项留空取默认:**缓存写入按未命中输入价计费,思考 token 按输出价计费。**

再加一个币种,带三档周末价——**此例为虚构,仅作说明**:

```yaml
    EUR:                                # 并非真实服务方,也不是真实价格
      entries:
        - model: example-large
          per: 1000000
          timezone: Europe/Berlin
          base: { input: 3, inputCacheHit: 0.3, output: 9, cacheWrite: 4 }
          schedules:
            - name: weekend             # 先匹配先生效,覆盖面最大的放最后
              multiplier: 0.6
              windows: [{ start: '00:00', end: '23:59', days: [0, 6] }]
            - name: night
              rates: { input: 1.5, inputCacheHit: 0.15, output: 4.5 }
              windows: [{ start: '22:00', end: '06:00', days: [1, 2, 3, 4, 5] }]
            - name: business
              multiplier: 1.4
              windows: [{ start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] }]
```

### harness 实际提供哪些匹配字段

每一次计价观测都是一条 `assistant/message` 会话事件,它同时带 **provider 路由 id**(`deepseek-official`)和**模型 id**(`deepseek-v4-flash`),外加事件自身的时间戳与 `TokenUsage`。写了 `provider` 的条目只匹配该路由,并优先于同模型未写 provider 的条目——于是可以只给一条路由单独定价,而不必把其余的重写一遍。

`TokenUsage` 的输入侧计数互不重叠(`inputTokens` 不含缓存流量),但 `reasoningTokens` 是 `outputTokens` 的子集,所以本插件在计价前会把它从生成 token 中扣除。被中断的一轮同样上报了服务方实际计费的用量,照常计入。

改动某份价格表,或切到另一个币种的表,都会改变会话投影的缓存版本,于是每个会话下次读取时按新价重算,而不是在旧价算出的合计上继续累加。

## 账目文件

聚合数字来自本插件自己的一个文件:

- **路径** `$DSH_HOME/dsh-balance/ledger.jsonl`(或 `<root>/ledger.jsonl`)。目录以 `0o700` 创建,文件以 `0o600` 创建。
- **内容** 每次 LLM 请求一行 JSON:时间、会话 id 与日志序号、模型与 provider id、五个 token 桶、费用、计价所用币种、生效的价格档位。未计价的行带 `"unpriced": true` 且费用为 0。**不含 prompt、不含回复、不含密钥、不含端点。** 聚合按供应商、按币种分开保存,所以切换价格表时新币种从零开始,而不会继承旧币种的合计;一家供应商的行也绝不会算进另一家的合计——浮层里余额下面的消费就是那条路由自己的。没记录 provider 的行归到空 id 下,任何下拉项都不读它。
- **保留** 早于 `ledgerDays`(默认 400)的行在启动时丢弃并重写文件。加载走流式读取;内存里的聚合按本地日期分桶,所以内存由保留窗口决定,而不是由请求数决定。一个 5 万行、12 MB 的账目文件,启动约 0.11 秒;需要压实重写时再约 0.11 秒。
- **观测点** 只读订阅 `session/event`。该事件在提交之后单向广播,监听者出错不会让本轮失败;它在一条已经组装好的记录里同时给出模型、provider、用量,以及可持久化的 `(session, seq)` 身份。没有选 `llm/stream` 瀑布:那会把本插件放进请求路径,而且它不提供可落盘的请求身份。

### 哪些不会回填

聚合从本机写下的第一行开始计——浮层写明「自 &lt;日期&gt; 起统计」。安装之前就存在的会话,以及从磁盘恢复的会话(其种子历史不会在事件流上重播),都不计入今日 / 本月 / 累计。

**会话内**那一行不受影响:它是对该会话自身持久日志的投影,所以打开一个几个月前的会话,会按当前价格表把它的全部历史算一遍。

从既有会话回填账目是可能的后续工作。它必须走 `sessionQuery` 能力,绝不能直接读会话日志文件。

## 权限与安全

- **网络出口**:只有*被查询*那个供应商自己配置的 origin。DeepSeek 的端点由它自己的 `baseURL` 推导——去掉末尾一个 `/v<数字>`,再接 `/user/balance`;每条 Moonshot 路由的端点是它的 origin 加上文档写明的 `/v1/users/me/balance`,配置 `baseURL` 里的任何路径都被丢弃;通用适配器的候选 URL 都从解析出的供应商 origin 构造,运算结果一旦会离开该 origin 就拒绝。`baseURL` 不是 `http(s)`,或推导会离开 origin 时,一律拒绝并报为 `unconfigured`,不会发出请求。不抓价格页,无遥测,无更新检查。
- **凭据**:无论查询哪个供应商,其 API key **每次读取**都通过宿主凭据缝(`ctx.credentials.resolve`)重新解析,请求结束即丢弃——正因如此,轮换后的密钥无需重启即可在下一次轮询生效。它以 `Authorization: Bearer` 请求头发送:不进 URL、不写日志、不返回给浏览器、不写入账目文件、不与余额一起缓存。被缓存的只有*余额数字*。
- **不注册任何 HTTP 路由。** 浏览器端只经 harness 自己的 `/api` Typert 网关访问宿主,继承它的信任边界。
- **自有 Typert RPC 只读。** 网关上本插件自己的方法只有 `accountBalance/get`、`accountBalance/spend`、`accountBalance/providers` 三个,没有任何写方法。设置 → 余额页面的写操作走的是 harness 自己的设置 RPC(应用里每一行设置都走这条路,不是本插件新加的路由),受该 RPC 自身"仅本机可写"规则约束;轮询窗口、通用适配器的端点形状仍然只能通过 `cordis.yml` 改。反向代理后被放行到 `/api` 的调用方拿不到密钥、端点和 prompt。
- **不写会话事件。** 本插件不向任何会话日志追加内容,只读。
- **账目文件始终纯数字、单账户。** 供应商下拉只预览其他供应商的余额,绝不写入或重新计价账目文件——账目文件始终是下方描述的那份 DeepSeek 账户计价账目,不受下拉影响。
- **磁盘**:只有上述账目文件。

## 兼容性

针对 `@deepseek-ai/*` **0.1.2-alpha.2** 构建;peer 范围接受 `>=0.1.2-alpha.2 <0.2.0-0`。Node `^22.19 || >=24`。浏览器端需要 Web 界面(`dsh web`)、slot 注册表、locale 服务与 Typert Remote 网关;宿主端不依赖其中任何一项,只是不会有界面。

## 安装

```sh
dsh plugin --profile <name> add ./sumomok-dsh-balance-0.3.2.tgz
# 发布后也可以:
dsh plugin --profile <name> add @sumomok/dsh-balance
```

包声明了 `dsh.bundle`,所以 `dsh plugin` 会自动把它的 patch 层追加到 profile。启动前先确认:

```sh
dsh --profile <name> --dump-config   # 应出现 "# == @sumomok/dsh-balance" 层
dsh web --profile <name>
```

用 `dsh plugin --profile <name> remove @sumomok/dsh-balance` 卸载,依赖与层一起移除。账目文件会原样留下;要丢弃就删掉 `$DSH_HOME/dsh-balance/`。

## 不做的事

多供应商**账目文件**(账目文件始终是一份按部署价格表计价的账户,不管下拉预览的是哪个供应商)、在设置页编辑某个价格条目的分时价格档或新增币种(见上方「配置」——基础费率与两个阈值是图形化的,其余不是)、以及在请求因配额报错时刷新余额(那需要在 LLM 错误路径上加宿主监听)。设计上都没有堵死。

针对具体供应商的专属适配器(DeepSeek、Moonshot AI、Kimi For Coding 之外的):注册表(`adapters.ts`)预留了按供应商 id 在通用兜底之前插入专属适配器的结构——其余每个供应商仍走通用适配器的尽力而为探测。今后若有供应商按订阅配额而非货币余额计量,按 `kimi-coding` 同样的方式接入,产出 `quota` 视图。

## 许可

MIT
