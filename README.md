# 沙煲饭热点（shabaofan-hot）

DeepSeek Harness 侧边栏插件。打开后是乔木式左列表 / 右文章，板块为 **GitHub热榜**、**Product Hunt趋势**、**Google Trend**（默认美国 US；Google 没有真正的「全球」Trending Now RSS）。点开条目会自动生成带小标题的分段中文介绍（已有缓存则直接显示，不耗额度），并尽量展示预览图。

支持的 DeepSeek Harness 版本：`0.2.1-rc.2` 到 `0.2.1-rc.5`，以及 `0.2.2-rc.1`。

## 在「添加插件」对话框安装

打开 DeepSeek Harness → 插件页 → **添加插件**，在「包名或地址」输入框粘贴下面任意一种：

```text
https://github.com/BorisSun0424-boop/shabaofan-hot
```

或官方文档里的 GitHub 简写（效果相同）：

```text
github:BorisSun0424-boop/shabaofan-hot
```

本插件是直接可运行的 JavaScript，没有构建脚本，从 GitHub 安装一般不需要再授权 `allowBuilds`。

仅粘贴包名 `shabaofan-hot` **目前会失败**：它还没有发布到 npm。对话框里的「中国大陆镜像源」（npmmirror）只对 npm 包名安装生效，**不会**代替从 GitHub 仓库下载。

安装完成后请 **Cmd+Q 完全退出**再打开 DeepSeek Harness（只关窗口不够，Host 不会加载新插件）。然后在侧栏打开「沙煲饭热点」。

## 用命令行安装

如果终端里能直接运行 `dsh`：

```bash
dsh plugin --profile desktop add https://github.com/BorisSun0424-boop/shabaofan-hot
```

或：

```bash
dsh plugin --profile desktop add github:BorisSun0424-boop/shabaofan-hot
```

若提示找不到 `dsh`，改用应用自带的命令（macOS）：

```bash
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add https://github.com/BorisSun0424-boop/shabaofan-hot
```

也可以安装已经打好的安装包：

```bash
dsh plugin --profile desktop add ./shabaofan-hot-0.5.1.tgz
```

装完同样需要 **Cmd+Q 完全退出**再打开。

## 额度说明

- **刷新列表**：只请求公开热榜（gitstock.org、Product Hunt Feed、Google Trends RSS / 公开代理），**不走模型，不耗 tok**。
- **中文介绍**：打开条目时若尚无缓存，会自动调用已配置模型生成介绍（可能耗额度）；命中本地缓存不再调用。文章页可「重新生成」。
- **每日自动介绍**（默认开）：北京时间约 **09:00** 先刷榜，再为 GitHub热榜 / Product Hunt趋势 / Google Trend 各前 N 条预生成介绍。顶栏可开关，也可点「立即生成今日介绍」。须先配置默认模型。

## Google Trend 说明

- 主源：`https://trends.google.com/trending/rss?geo=US`
- 国内网络常无法直连 Google：会回退公开代理，并做约 15 分钟内存缓存；仍失败时该板块单独报错，不影响其它榜。
- 条目含热搜词、大约热度（如 `500+`）、地区、Trends 链接；图片有则展示。

## 与乔木 RSS 的差异

乔木精选多在服务端加工好中文；本插件热榜是公开 HTTP，中文介绍在本机用已配置模型生成并缓存。
