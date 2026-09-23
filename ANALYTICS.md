# 访问量与 IP 记录

启动服务后自动创建 MySQL 表 `site_visits`，沿用 `.env` 中的数据库连接配置。
数据库账号需要该库的 `CREATE`、`INSERT`、`SELECT` 权限。已有业务表不受影响。

首页页脚显示累计访问量与今日访问量。IP 记录仅保存在数据库中，没有记录页、
页面入口、IP 明细接口或管理员密钥。

## 统计口径

- 成功返回 HTML 的页面 GET 请求计一次访问，刷新页面再次计数，包括浏览器的 304 协商缓存访问。
- 图片、CSS、JavaScript、API、HEAD 请求和失败的页面请求不计入。
- 筛选、分页、查看弹窗使用 API，不增加页面访问量。机器人请求 HTML 也会计入。
- 每条记录包括 IP、访问时间、页面路径和 User-Agent；不保存 URL 查询参数。
- 时间以 UTC 写入数据库；“今日”按北京时间（Asia/Shanghai，UTC+8）计算。
- 重启服务不会清空记录。统计写入失败会记服务端错误日志，不阻塞页面返回；失败的访问不补记。

公共接口 `GET /api/analytics/summary` 只返回累计/今日访问量、累计/今日独立 IP 数
以及统计日期和时区，不返回具体 IP。独立 IP 数不代表独立人数。

## 查询 IP 记录

在 MySQL 中执行：

```sql
SELECT id,
       DATE_ADD(visited_at, INTERVAL 8 HOUR) AS visited_at_beijing,
       ip, path, user_agent
FROM site_visits
ORDER BY visited_at DESC, id DESC
LIMIT 100;
```

## 反向代理

默认使用直连 IP，忽略客户端自带的 `X-Forwarded-For`。
若通过 Nginx 等代理访问，请在 `.env` 设置 `TRUST_PROXY` 为实际可信的代理 IP/CIDR，
多个地址用逗号分隔。例如代理与 Node 在同一台机器、通过本机回环地址连接时：

```dotenv
TRUST_PROXY=loopback
```

代理应正确设置或追加 `X-Forwarded-For`；Express 从最靠近服务端的一跳向外检查，
采用第一个不可信地址作为访客 IP。不要将整个公网加入可信范围。
IPv4 映射的 IPv6 地址会归一化为 IPv4 地址，避免重复计为不同 IP。

## 验证

运行 `npm test` 检查访问计数、IP 处理、数据库故障恢复与接口数据范围。
