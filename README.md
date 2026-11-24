# 财经与科技快讯

一个中英文资讯看板，覆盖半导体、股市和 AI 板块。网页支持手机和桌面布局、实时搜索、深浅色主题，以及自动和手动刷新。

## 本地运行

安装 Node.js 24 LTS 和 npm。在项目目录执行以下命令。

```sh
npm ci
npm run update
npm run dev
```

打开终端输出的本地地址，通常是 `http://localhost:5173`。另开终端运行 `npm run update` 可再次抓取资讯。网页的「立即刷新」会读取刚写入的快照。

要验证生产构建，依次运行以下命令。

```sh
npm test
npm run check
npm run build
npm run preview
```

## 修改来源和关注词

打开 [config/news.json](config/news.json)。来源、分类关键词和搜索别名都在这一个文件里。

| 字段 | 用途 |
| --- | --- |
| `sources` | 每个来源填写唯一的 `id`、显示名称 `name` 和 RSS/Atom 地址 `url`。设 `enabled: false` 可暂停。 |
| `sources[].defaultCategories` | 专题订阅可配置默认标签 `semiconductor`、`market`、`ai`。采集还会根据关键词补充标签。 |
| `sources[].summary` | 设为 `true` 时展示 RSS 提供的简短摘要。 |
| `keywords` | 分别设置半导体、股市和 AI 板块的中文及英文匹配词。 |
| `aliases` | 将同一公司或主题的股票代码、中英文名放入一组，例如 `["NVDA", "NVIDIA", "英伟达", "輝達"]`。 |

修改后运行 `npm run update`。常规媒体订阅会根据关键词筛选，没有命中标签的条目不会进入列表。摘要和来源名称来自订阅内容或来源配置，新增来源前请核对其使用和署名条件。

## 免费部署到 GitHub Pages

1. 创建一个公开 GitHub 仓库，将项目文件推送到默认分支 `main`。
2. 在仓库的 **Settings → Pages → Build and deployment** 下将 **Source** 设为 **GitHub Actions**。
3. 在 **Actions → Update news and deploy → Run workflow** 手动启动一次。完成后，可在 Pages 设置或工作流的部署记录打开站点。

后续每小时第 17、47 分钟以及推送 `main` 时会执行采集与发布。工作流使用 GitHub 自带的 `GITHUB_TOKEN`，并在首次成功采集后创建专用 `data` 分支。该分支保存按来源组织的 `state.json`。代码继续维护在 `main`。

当单个来源失败时，采集会复用该来源仍在保留窗口内的上次成功条目，并继续处理其他来源。全部来源失败时，这次运行会报错，在线站点继续展示上一份快照。工作流日志记录各来源是否可用。若公开仓库长期无活动导致定时被停用，可在 Actions 重新启用并手动运行。

浏览器只向本站读取静态的 `data/news.json`。打开页面时检查最新快照，前台每 5 分钟再检查一次。维护者可以通过 GitHub Actions 立即发起一轮新的上游抓取。

[GitHub Pages 发布设置](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) · [GitHub Actions 定时行为](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
