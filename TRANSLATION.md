# 日译中：DeepL / MyMemory

支持 [DeepL API](https://developers.deepl.com/docs) 和 [MyMemory](https://mymemory.translated.net/)，需要 Node.js 20.3+，无需新增依赖。

在作品列表标题、作品详情标题和演员简介旁点击「翻译成中文」，完成后可切换「查看原文 / 显示译文」。按钮旁显示实际服务商。只有点击时才发送该段文字，数据库保留原文。

## 启用 DeepL

在服务器 `.env` 中填写自己的 **DeepL API Free 或 API Pro** 密钥（普通网页版翻译订阅不等于 API 订阅）：

```dotenv
TRANSLATION_PROVIDER=deepl
DEEPL_API_KEY=你的真实密钥
```

服务端也接受 DeepL Node SDK 常用的 `DEEPL_AUTH_KEY`；如果两者同时存在，优先使用 `DEEPL_API_KEY`。

然后重启服务：

```sh
npm start
```

- API Free 密钥以 `:fx` 结尾，自动请求 `https://api-free.deepl.com/v2/translate`；API Pro 使用 `https://api.deepl.com/v2/translate`。
- 密钥仅通过后端的 `Authorization: DeepL-Auth-Key ...` 请求头发送，不进入浏览器、URL 或响应。请勿提交实际 `.env`。
- DeepL 一次发送完整文本以保留上下文，指定 `JA → ZH-HANS`（日文到简体中文），并启用 `preserve_formatting`。
- 密钥缺失或验证失败返回 503；请求过频、额度用尽返回 429；超时返回 504；其他上游故障返回 502。页面显示对应中文提示，可重试。
- 选中 DeepL 后，请求失败会显示错误，不自动改用其他服务商。额度和费用以 DeepL 账户套餐为准。

## 服务商选择

| `TRANSLATION_PROVIDER` | 行为 |
| --- | --- |
| `auto`（默认或留空） | 配置了非空 `DEEPL_API_KEY` 则使用 DeepL，否则使用 MyMemory |
| `deepl` | 强制 DeepL；缺少密钥时明确提示配置错误 |
| `mymemory` | 使用 MyMemory，即使已填写 DeepL 密钥 |

修改环境变量后需重启服务。无效的服务商配置会在翻译请求中返回 503。

MyMemory 无需 API Key。可选填写自己的联系邮箱，申请其较高免费每日额度：

```dotenv
TRANSLATION_PROVIDER=mymemory
MYMEMORY_EMAIL=
```

邮箱仅由后端发送。服务器需要能访问 `https://api.mymemory.translated.net`，额度规则以 [MyMemory 官方说明](https://mymemory.translated.net/doc/usagelimits.php) 为准。

## 接口与缓存

`POST /api/translate`，请求体：

```json
{"text":"今日はいい天気です。"}
```

响应示例：

```json
{"translatedText":"今天天气很好。","source":"ja","target":"zh-CN","provider":"DeepL"}
```

使用 MyMemory 时 `provider` 为 `MyMemory`。客户端无需传递服务商或密钥。

- 单次最多接收 6000 UTF-8 字节。DeepL 完整发送；MyMemory 按最多 450 UTF-8 字节分段并保留段落。
- 相同文本的并发请求合并；成功结果在内存中缓存 24 小时，最多 500 项（MyMemory 含分段结果），重启会清空。
- 最多同时处理 4 个不同文本；单个上游请求超时 12 秒，一次全文翻译最多 45 秒。错误不会缓存为译文。
- 译文以纯文本显示；翻译列表标题不会打开作品详情。

## 验证

运行 `npm test` 检查 DeepL Free/Pro 路由、认证、语言参数、服务商选择、缓存、额度、超时、并发限制和 HTTP 接口，以及现有 MyMemory 回归测试。测试使用模拟上游响应，不消耗翻译额度。

安装 Python Playwright 并启动应用后，可运行 `python tests/translation-ui.py http://127.0.0.1:3000` 验证页面交互；设置 `TRANSLATION_TEST_PROVIDER=MyMemory` 可验证另一服务商标识。浏览器测试使用模拟档案和翻译，不发送真实文本到第三方。真实 DeepL 联调需要配置有效 API Key。
