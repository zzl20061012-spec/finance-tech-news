# 将财经与科技资讯部署到 GitHub Pages

这份指南使用 Windows PowerShell、公开 GitHub 仓库和 GitHub Pages。示例仓库名为 `finance-tech-news`。用你的 GitHub 用户名替换命令里的 `YOUR-GITHUB-USERNAME`。公开仓库可使用 GitHub Free 的 Pages 和标准 GitHub Actions 运行器。 [Pages 可用范围](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) · [Actions 计费说明](https://docs.github.com/en/actions/concepts/billing-and-usage)

## 1. 准备项目和终端

准备 Git for Windows、Node.js 24 LTS（包含 npm）和 GitHub 账号。把源码解压到单独的 `finance-tech-news` 文件夹。在该文件夹打开 PowerShell，或按实际路径修改下列命令。

```powershell
Set-Location -LiteralPath "$env:USERPROFILE\Downloads\finance-tech-news"
git --version
node --version
npm.cmd --version
Get-ChildItem -Force -Name
```

目录里应能看到 `package.json`、`index.html` 和 `.github`。如果想先在本机打开页面，依次安装依赖、抓取快照并启动开发服务器。浏览器打开命令显示的 `Local` 地址。首次抓取失败时，先看终端列出的来源错误再重试。

```powershell
npm.cmd ci
npm.cmd run update
npm.cmd run dev
```

按 `Ctrl+C` 退出开发服务器。需要检查本机生产构建时，执行 `npm.cmd run build` 和 `npm.cmd run preview`。本机每次重新抓取后，开发服务器可直接读取新快照。预览服务器读取 `dist`，需要重新构建。

## 2. 创建公开仓库并推送源码

1. 登录 GitHub，点右上角 **+ → New repository**。
2. 选择你的账号作为 **Owner**，仓库名填 `finance-tech-news`，可见性选 **Public**。
3. 保持 README、`.gitignore` 和许可证初始化选项未选，创建一个空仓库。
4. 回到现有源码目录，在 PowerShell 里运行下列命令。将名字和邮箱换成你的提交身份。邮箱可使用 GitHub **Settings → Emails** 提供的 `noreply` 地址。

```powershell
git init -b main
git config user.name "你的提交显示名"
git config user.email "你的 GitHub 提交邮箱"
git add -- .
git status --short
git commit -m "Add finance and technology news site"
git remote add origin https://github.com/YOUR-GITHUB-USERNAME/finance-tech-news.git
git remote -v
git push -u origin main
```

确认 `git status --short` 列出了 `.github/workflows/update-and-deploy.yml`、`package.json` 和源码。依赖、缓存、构建目录、快照以及 ZIP 都由 `.gitignore` 排除。HTTPS 推送出现登录提示时，按 Git 凭证管理器提示为正确的 GitHub 账号完成授权。

如果当前文件夹已经是 Git 仓库，用 `git branch --show-current` 和 `git remote -v` 检查分支及远程地址。已有 `origin` 指向目标仓库时，跳过 `git remote add origin`。确认需要更改现有指向后，可以用 `git remote set-url origin <仓库 HTTPS 地址>`。

## 3. 启用 Pages 并完成第一次部署

1. 打开 GitHub 仓库，进入 **Settings → Pages**。
2. 在 **Build and deployment** 下把 **Source** 设为 **GitHub Actions**。
3. 进入 **Actions → Update news and deploy → Run workflow**，分支选 `main`，确认运行。
4. 点进新出现的运行记录，等待 `build` 和 `deploy` 两项均成功。第一次推送如果早于 Pages 设置，可能已有一次失败，以上述设置后的运行结果为准。
5. 从 `deploy` 的部署记录或 **Settings → Pages → Visit site** 打开网页。项目站网址通常形如下例，保留末尾的 `/`。

```text
https://YOUR-GITHUB-USERNAME.github.io/finance-tech-news/
```

工作流会安装依赖、抓取数据、构建 `dist`，再上传并部署。它会自动创建 `data` 分支保存 `state.json` 供下次抓取使用。网站发布源保持 **GitHub Actions**，源码更新推送到 `main`。 [Pages 发布来源设置](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) · [手动运行工作流](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)

## 4. 核对在线数据和各板块条数

打开页面后，清空搜索框并选 **全部**，可看到总条数。分别点 **半导体**、**股市** 和 **AI板块**，可看当前板块条数。需要精确复核时，用 PowerShell 直接读取同一个发布快照。

```powershell
$siteUrl = 'https://YOUR-GITHUB-USERNAME.github.io/finance-tech-news/'
$snapshotUrl = $siteUrl.TrimEnd('/') + '/data/news.json'
$snapshot = Invoke-RestMethod -Uri $snapshotUrl

$updatedAt = [DateTimeOffset]$snapshot.updatedAt
$updatedInHongKong = $updatedAt.ToOffset([TimeSpan]::FromHours(8))
'香港时间 {0}' -f $updatedInHongKong.ToString('yyyy-MM-dd HH:mm:ss zzz')
'去重后总条数 {0}' -f @($snapshot.items).Count

$categories = [ordered]@{
    semiconductor = '半导体'
    market = '股市'
    ai = 'AI板块'
}

$categories.GetEnumerator() | ForEach-Object {
    $categoryId = $_.Key
    [pscustomobject]@{
        '板块' = $_.Value
        '条数' = @($snapshot.items | Where-Object { $_.categories -contains $categoryId }).Count
    }
} | Format-Table -AutoSize
```

一篇报道可以有多个标签，所以三个板块的条数相加可能大于去重后的总数。`updatedAt` 是快照的更新时间。新闻发布时间在各条 `publishedAt`，某次采集可能没有新的报道。

## 5. 确认定时更新

定时配置位于 [.github/workflows/update-and-deploy.yml](.github/workflows/update-and-deploy.yml)。当前设置每小时第 17 和第 47 分钟触发一次。GitHub 默认用 UTC 计算计划，香港时间与 UTC 相差整八小时，这两个分钟数相同。

```yaml
on:
  push:
    branches:
      - main
  schedule:
    - cron: '17,47 * * * *'
  workflow_dispatch:
```

1. 确认 GitHub 的默认分支为 `main`，且该分支包含这个工作流。
2. 首次手动运行成功后，等过一个预定时间。在 **Actions → Update news and deploy** 打开新运行的详情，查看触发事件是否为 `schedule` 或界面显示的 **Scheduled**。
3. 确认这次定时运行的 `build` 和 `deploy` 均通过，再打开站点快照查看 `updatedAt` 是否前进。手动触发和推送触发都可以发布站点，看到 `schedule` 的运行才能验证定时触发。

要改成每小时一次，把 cron 改为 `17 * * * *` 并提交到 `main`。Actions 高负载时可能延迟或漏跑。公开仓库连续 60 天没有活动时，GitHub 可能自动停用计划任务。届时到 **Actions** 重新启用该工作流，再检查下一次定时记录。 [GitHub 计划任务说明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

页面的 **下次自动刷新** 是浏览器的五分钟检查倒计时。**立即刷新** 会重新读取已发布快照。想立即抓取上游消息，用维护者的 **Run workflow**，等待部署成功后再刷新页面。

## 6. 排查空白、404 或数据停更

在 Chrome 或 Edge 按 `F12`，打开 **Network** 和 **Console**，重载页面。先查站点 HTML、`assets/index-*.js`、`assets/index-*.css`，再查 `data/news.json`。也可以把完整快照地址贴到新标签页，查看返回的是 JSON 还是 HTML。

| 看到的情况 | 核对与修复 |
| --- | --- |
| 首页显示 404 或根本打不开 | 从 **Settings → Pages → Visit site** 打开真实站点地址。检查 **Source** 是否为 **GitHub Actions**，以及最近一次 `deploy` 是否成功。项目站网址带 `/finance-tech-news/`。 |
| 页面一直写「正在加载资讯」，脚本或样式 404 | 查看 Network 是否从项目站前缀下请求 `assets/index-*.js` 和 CSS。确保发布的是工作流上传的 `dist`。本地通过 `npm.cmd run dev` 或 `npm.cmd run preview` 访问。 |
| 页面显示「暂时无法读取资讯」，JSON 404 或返回 HTML | 用项目站路径 `/finance-tech-news/data/news.json` 测试。预期看到带 `updatedAt`、`items` 和 `sources` 的 JSON。看 `Build the site`、`Save the collection state` 和 `Deploy to Pages` 的日志，本地可检查 `dist/data/news.json`。 |
| `Run workflow` 找不到或任务被跳过 | 核对工作流文件已经推到默认分支、你有写权限且 Actions 已启用。选择 `main`。这份配置的构建任务明确只在 `main` 执行。 |
| `Configure Pages` 或 `Deploy to Pages` 失败 | 确认选了 **GitHub Actions** 作为 Pages 发布源。展开失败步骤读取具体原因，查看 **Deployments** 是否已有最近一次成功发布。 |
| `Collect and validate news` 失败 | 展开日志查看哪些 RSS 超时、被限流或解析失败。所有来源都失败，或汇总后没有匹配条目时，工作流保留之前的线上快照。有的来源失败时，能发布其他来源的内容，并在页面标出受影响来源的状态。 |
| `Save the collection state` 失败 | 检查日志里的 `dist/data/news.json` 校验和 `git push` 报错。若提示推送权限或分支规则，确认工作流可写入其专用的 `data` 分支。 |
| 站点能打开，时间不变或显示超过 2 小时未更新 | 比较快照中的 `updatedAt` 和 Actions 最近一次成功部署时间。如果没跑定时，先检查是否有 `schedule` 运行。刚完成部署时可在 Network 勾选 **Disable cache** 后重载再检查，浏览器请求出现 `304` 也可能只是正常地复用已验证的缓存。 |
| 快照时间已更新，没看到新标题 | 检查是否在 **全部** 且搜索框为空。对比 `publishedAt` 和条数。有的轮次只有已收录内容，单源沿用旧数据也会令部分报道保持原状。 |

修改来源或关键词时，编辑 [config/news.json](config/news.json)。维护流程和配置字段见 [README.md](README.md)。

