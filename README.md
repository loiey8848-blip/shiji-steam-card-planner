# 拾级 · Steam 配卡助手

根据现有库存和普通徽章的剩余合成次数，估算配齐 Steam 集换式卡牌的费用。可以按目标等级比较候选卡组，按游戏名称、AppID 或商店链接单独查价，也可以从已有普通卡牌的库存出发，比较补齐下一套的费用。

## 使用

1. 从 GitHub 的 Releases 下载 Windows x64 便携包。
2. 解压整个目录，双击「拾级.exe」。需要 Windows 10 或 11 x64 和 Microsoft Edge WebView2 Runtime。
3. 点击「同步」读取 Steam 账号后，选择「升级配卡」「指定游戏查价」或「库存补齐」。准备购买单后，在 Steam 官方页面核对订单并确认。

升级方案比较界面显示已核价的候选范围。市场报价随盘口和钱包币种变化。购买和登录在工具内打开的 Steam 官方页面完成。应用的网页会话和个人购买计划保存在本机 Windows 用户目录下。首次使用需在线读取卡组目录，后续可以使用本机缓存。

## 构建

在 Windows 上用 PowerShell 7 运行 `pwsh -File ./build.ps1`。脚本会下载固定版本的 WebView2 SDK，并使用 .NET Framework 4.x 的 C# 编译器生成 `dist/Steam配卡助手`。已有 SDK 可以用 `-WebView2Sdk` 指定其解压目录。

使用 Node.js 运行 `node tests/engine.test.cjs` 验证配卡算法。市场盘口来自 Steam 社区市场，候选目录来自 Steam Card Exchange。WebView2 的许可证和第三方声明随 Windows 便携包附带。
