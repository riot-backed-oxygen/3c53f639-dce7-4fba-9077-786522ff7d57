# 访问量与 IP 记录

启动服务后自动创建 MySQL 表 `site_visits`，沿用 `.env` 中的数据库连接配置。
数据库账号需要该库的 `CREATE`、`ALTER`、`UPDATE`、`INSERT`、`SELECT` 权限。
升级时自动为访问记录表添加时间偏移标记，并将旧 UTC 记录转换为东八区；已有业务表不受影响。

首页页脚显示累计访问量与今日访问量。IP 记录仅保存在数据库中，没有记录页、
页面入口、IP 明细接口或管理员密钥。

## 统计口径

- 成功返回 HTML 的页面 GET 请求计一次访问，刷新页面再次计数，包括浏览器的 304 协商缓存访问。
- 图片、CSS、JavaScript、API、HEAD 请求和失败的页面请求不计入。
- 筛选、分页、查看弹窗使用 API，不增加页面访问量。机器人请求 HTML 也会计入。
- 每条记录包括 IP、访问时间、页面路径和 User-Agent；不保存 URL 查询参数。
- `visited_at` 直接保存北京时间（Asia/Shanghai，UTC+8），例如 `2026-09-24 03:41:31.241`；“今日”也按北京时间计算。
- `utc_offset_minutes = 480` 表示已按东八区保存；旧版本写入的记录默认标记为 `0`，下次启动自动转换。标记和时间原子更新，重启或重试不会重复加八小时。
- 重启服务不会清空记录。统计写入失败会记服务端错误日志，不阻塞页面返回；失败的访问不补记。

公共接口 `GET /api/analytics/summary` 只返回累计/今日访问量、累计/今日独立 IP 数
以及统计日期和时区，不返回具体 IP。独立 IP 数不代表独立人数。

## 查询 IP 记录

在 MySQL 中执行：

```sql
SELECT id, visited_at AS visited_at_beijing, ip, path, user_agent
FROM site_visits
ORDER BY visited_at DESC, id DESC
LIMIT 100;
```

## 反向代理

在 Render 部署时，自动识别平台的 `RENDER=true` 环境变量，使用 `trust proxy = 1`，
从平台转发的 `X-Forwarded-For` 中取得访客 IP。本地运行默认使用直连 IP，忽略转发头。
Render 上如需显式配置，可在服务的 Environment 页面设置 `TRUST_PROXY=1`。

把自定义域名直接绑定到同一个 Render 服务不会改变代理链，无需调整。
若在 Render 外再添加 Cloudflare 橙云、CDN 或自己的反向代理，应按实际可信的代理链设置
`TRUST_PROXY`。支持代理跳数或 IP/CIDR 列表；跳数表示从应用向外信任多少跳，不能随意设大。
不要盲取转发头的第一个地址。设置 `TRUST_PROXY=0` 可显式关闭代理信任。

若通过 Nginx 等代理访问，请在 `.env` 设置 `TRUST_PROXY` 为实际可信的代理 IP/CIDR，
多个地址用逗号分隔。例如代理与 Node 在同一台机器、通过本机回环地址连接时：

```dotenv
TRUST_PROXY=loopback
```

代理应正确设置或追加 `X-Forwarded-For`；Express 从最靠近服务端的一跳向外检查，
采用第一个不可信地址作为访客 IP。不要将整个公网加入可信范围。
IPv4 映射的 IPv6 地址会归一化为 IPv4 地址，避免重复计为不同 IP。

Nginx 代理配置示例（重载代理配置后生效）：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

`::1` 是合法的 IPv6 本机回环地址，完整写法为 `0:0:0:0:0:0:0:1`。
通过代理访问却只看到 `::1` 时，说明应用拿到的是代理连接地址，需要配置可信代理并保证
代理转发 `X-Forwarded-For`。公网 IPv4 会保存为如 `203.0.113.20`，IPv6 会保存为如
`2001:db8::20`。系统保留真实地址类型，不把 IPv6 随意改为 IPv4。
历史 `::1` 记录没有保存转发头，无法还原当时的原始访客 IP。

重新部署更新后的服务时，会自动迁移历史 UTC 时间，并启用新的 IP 获取规则。
参考：[Render 关于获取客户端 IP 的说明](https://render.com/articles/how-render-handles-ddos-attacks)。

## 验证

运行 `npm test` 检查访问计数、IP 处理、数据库故障恢复与接口数据范围。
