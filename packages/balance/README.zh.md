# @sumomok/dsh-balance

[English](README.md) | 中文

DeepSeek Harness Web 界面的账户余额与消费统计。侧边栏底部「设置」旁的图框显示服务方账户的剩余余额;悬停展开面板,给出余额构成,以及本机今日、本月、累计的消费。输入框下方另有一行,显示当前会话花了多少。

余额是服务方自己给的数字。消费是把 harness 已经记录的 token 用量,乘以本部署自己拥有的价格表算出来的——运行时不抓取任何页面;价格表里没有的模型,记为「未计价 token」,而不是悄悄当成 0。

## 显示什么,显示在哪

| 界面 | Slot | 内容 |
| --- | --- | --- |
| 侧边栏底部图框 | `sidebar.footer.action` | 剩余余额(`¥12.34`),按配置的阈值着色。56 px 窄栏下只显示数字;展开态悬停打开浮层。 |
| 浮层 | — | 合计 / 赠送 / 充值余额、读取时刻、今日 / 本月 / 累计消费及各价格档位占比、价格表日期。 |
| 会话消费行 | `conversation.composer.dock` | `本会话约 $0.12`;若该会话有模型不在价格表内,追加 `· N token 未计价`。 |

点击图框立即刷新两项读取。

## 刷新策略

宿主缓存的是答案,不是密钥。

- 一次成功读取在 `refreshMs`(默认 60 秒)内直接复用。窗口内所有标签页共享它,多开一个屏幕不会多打一次服务方请求。
- 一次失败读取在 `retryMs`(默认 15 秒)内不再尝试,避免一个坏掉的端点被每个标签页各敲一遍。
- 并发调用共用同一个在途请求。点击图框会跳过刷新窗口,但仍然并入已在途的请求。
- 刷新失败而此前读到过数值时,旧数值继续显示(变暗),浮层写明它是旧值。一分钟前的余额比一个破折号有用,只要它承认自己旧。
- 浏览器端按 `refreshMs` 轮询,标签页不可见时整跳过该次。

## 三种状态,各自渲染什么

`get()` 返回三种状态之一。

| 状态 | 字段 | 渲染 |
| --- | --- | --- |
| `ok` | `currency`、`total`、`granted`、`toppedUp`、`isAvailable`、`fetchedAt`、`stale` | 图框,余额保留两位小数。高于 `lowBalance` 为常态色;低于它为警告色;低于 `criticalBalance`、或服务方报告 `isAvailable: false` 时为危险色——账户可能余额充足却被停用。`stale: true` 时图框变暗,浮层加一行说明。 |
| `unconfigured` | — | **什么都不渲染。** 没有可用密钥,或配置的端点不是本插件允许访问的。从没打算用这个功能的部署,看到的就是装插件之前那个侧边栏,而不是一句解释故障的占位文字。 |
| `unavailable` | `reason`(`http` / `network` / `timeout` / `malformed`)、可选 `status`、`fetchedAt` | 变暗的 `—`,原因写在 tooltip 里。不弹 toast。原因只是分类,不含服务方原文,也不含端点。 |

`spend()` 返回 `today`、`month`、`allTime`(各含金额、按价格档位的拆分、请求数、未计价 token),外加 `since`(该币种下保留的最早一行时间)、`currency`(实际使用的价格表币种)、`pricesAsOf`、`timezone`。合计按币种分开:一个币种的行永远不会并入另一个币种的总额。

## 配置

每一项都在加载时校验,都可以从 `cordis.yml` 改。bundle patch 里写出了完整的默认块;profile 自己的 patch 若针对 `balance` 这个 id,会**整块替换** config,所以要保留的键必须逐条重写。

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

服务方连接不在这里配置:端点与 API key 引用都从 `llm-deepseek` 设置分节读取,解析顺序与该 provider 自己完全一致(`baseURL`,其次 `$DEEPSEEK_BASE_URL`,再次 `https://api.deepseek.com`;`apiKeyEnv` 默认 `DEEPSEEK_API_KEY`)。把 provider 指到别处,本插件跟着走。

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
- **内容** 每次 LLM 请求一行 JSON:时间、会话 id 与日志序号、模型与 provider id、五个 token 桶、费用、计价所用币种、生效的价格档位。未计价的行带 `"unpriced": true` 且费用为 0。**不含 prompt、不含回复、不含密钥、不含端点。** 聚合按币种分开保存,所以切换价格表时新币种从零开始,而不会继承旧币种的合计。
- **保留** 早于 `ledgerDays`(默认 400)的行在启动时丢弃并重写文件。加载走流式读取;内存里的聚合按本地日期分桶,所以内存由保留窗口决定,而不是由请求数决定。一个 5 万行、12 MB 的账目文件,启动约 0.11 秒;需要压实重写时再约 0.11 秒。
- **观测点** 只读订阅 `session/event`。该事件在提交之后单向广播,监听者出错不会让本轮失败;它在一条已经组装好的记录里同时给出模型、provider、用量,以及可持久化的 `(session, seq)` 身份。没有选 `llm/stream` 瀑布:那会把本插件放进请求路径,而且它不提供可落盘的请求身份。

### 哪些不会回填

聚合从本机写下的第一行开始计——浮层写明「自 &lt;日期&gt; 起统计」。安装之前就存在的会话,以及从磁盘恢复的会话(其种子历史不会在事件流上重播),都不计入今日 / 本月 / 累计。

**会话内**那一行不受影响:它是对该会话自身持久日志的投影,所以打开一个几个月前的会话,会按当前价格表把它的全部历史算一遍。

从既有会话回填账目是可能的后续工作。它必须走 `sessionQuery` 能力,绝不能直接读会话日志文件。

## 权限与安全

- **网络出口**:只有配置的服务方 origin。端点由 provider 自己的 `baseURL` 推导——去掉末尾一个 `/v<数字>`,再接 `/user/balance`;`baseURL` 不是 `http(s)`,或推导结果会离开该 origin 时,一律拒绝并报为 `unconfigured`,不会发出请求。不抓价格页,无遥测,无更新检查。
- **凭据**:API key **每次读取**都通过宿主凭据缝(`ctx.credentials.resolve`)重新解析,请求结束即丢弃——正因如此,轮换后的密钥无需重启即可在下一次轮询生效。它以 `Authorization: Bearer` 请求头发送:不进 URL、不写日志、不返回给浏览器、不写入账目文件。被缓存的只有*余额*。
- **不注册任何 HTTP 路由。** 浏览器端只经 harness 自己的 `/api` Typert 网关访问宿主,继承它的信任边界。
- **RPC 只读。** 网关上只有 `accountBalance/get` 与 `accountBalance/spend` 两个方法,没有任何写方法:价格表、阈值、轮询窗口都只能通过 `cordis.yml` 改。反向代理后被放行到 `/api` 的调用方,只能读数字,改不了任何东西,也拿不到密钥、端点和 prompt。
- **不写会话事件。** 本插件不向任何会话日志追加内容,只读。
- **磁盘**:只有上述账目文件。

## 兼容性

针对 `@deepseek-ai/*` **0.1.1-rc.2** 构建;peer 范围接受 `>=0.1.0-rc.1 <0.2.0`。Node `^22.19 || >=24`。浏览器端需要 Web 界面(`dsh web`)、slot 注册表、locale 服务与 Typert Remote 网关;宿主端不依赖其中任何一项,只是不会有界面。

## 安装

```sh
dsh plugin --profile <name> add ./haoran-dsh-balance-0.1.0.tgz
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

多服务方余额、设置页分节、以及在请求因配额报错时刷新余额(那需要在 LLM 错误路径上加宿主监听)。设计上都没有堵死。

## 许可

MIT
