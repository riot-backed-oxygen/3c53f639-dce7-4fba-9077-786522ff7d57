# 免费日译中

项目已接入 [MyMemory](https://mymemory.translated.net/)，默认无需注册、API Key 或新增依赖。需要 Node.js 20.3+（当前环境为 Node.js 22）。

重启服务后，在作品列表标题、作品详情标题和演员简介旁点击「翻译成中文」。完成后可切换「查看原文 / 显示译文」。只有点击时才向 MyMemory 发送该段文字，数据库保留原文。

## 启动与配置

```sh
npm start
```

免费公共接口有每日额度，额度规则以 [MyMemory 官方说明](https://mymemory.translated.net/doc/usagelimits.php) 为准。可选在 `.env` 中填写自己的联系邮箱，申请服务商提供的较高免费额度；留空也可以使用：

```dotenv
MYMEMORY_EMAIL=
```

邮箱仅由后端发给 MyMemory，不发送到浏览器。服务器需要能够访问 `https://api.mymemory.translated.net`。超时、额度不足、网络故障会在按钮旁显示提示，可点击重试。公共翻译记忆库的质量不一，人物名和专有名词可能不准确，页面提供原文切换。

## 接口与缓存

`POST /api/translate`，请求体：

```json
{"text":"今日はいい天気です。"}
```

响应包含 `translatedText`、`source: "ja"`、`target: "zh-CN"` 和 `provider: "MyMemory"`。当前功能固定为日文到简体中文。

- 同一文本的并发请求合并，成功结果在服务器内存中缓存 24 小时，最多 500 项（含分段结果）；重启会清空。
- 每段最多 450 UTF-8 字节，自动保留段落，避免超过服务商每次 500 字节的限制。单次最多接收 6000 UTF-8 字节。
- 最多同时处理 4 个不同文本，单个上游请求超时 12 秒，一次全文翻译总计最多 45 秒。错误和额度提示不缓存为译文。
- 译文以纯文本显示；翻译列表标题不会打开作品详情。

运行 `npm test` 验证分段、缓存、额度、超时和 HTTP 接口。

若之后需要大批量、无第三方每日额度限制的翻译，可自建 LibreTranslate / Argos Translate，但需要自备运行资源并安装支持日译中的模型；其托管服务不等于免费公共接口。
