# ClaudeBridge 0.6 · 重连诊断修订版

构建标识：`0.6.0-reconnect.20261016-publish.20261017`。兼容版本仍为 `0.6.0`；Chrome 扩展详情通过 version_name 显示完整构建标识。发布建议使用同名独立标签并勾选 Pre-release，不覆盖旧包。

基于当前修改版增加安装语言选择与界面切换。Windows 安装向导和更新/切回入口支持中文与 English；扩展设置、弹窗、工作台、首次使用及 Claude 文件小窗使用离线语言目录。

安装成功后保存语言偏好。手动选择的界面语言优先于安装默认值，重开页面仍保留。文件名、正文、路径和操作编号不受翻译影响；权限、身份、网络策略及恢复规则保持原有行为。

解压完整 Windows x64 包，双击 `安装Claude文件连接.exe`。不要只复制 EXE。安装器未作发行者代码签名。许可证及第三方归属保留在 LICENSE、NOTICE.md 与 licenses 目录。

Cowork 依赖第三方连接服务，仍为实验性。网络波动、结果延迟或正文缺失不等于文件操作失败；按原编号查询结果，不盲目重做。更多步骤见 `快速开始.md` 和 `文件使用指南.md`。

## 0.6（内部版本 0.6.0）

测试发布：统一安装与加载两步、首次使用前置条件、用途预设、运行版本与安装位置、连接解释、文件数与记录数、打开位置反馈及诊断预览。小窗四角缩放，自动成果直接更新原文件，不备份、不另存、不弹版本选择；C04设备验证与C05网络方式保持原样。网页 Chat 支持、Cowork 实验性，Claude Code/CLI/Remote Control 暂不支持。安装器未签名；macOS/Linux 与新 Claude 页面结构不能用本地模拟验证替代。


## 2026-10-16 重连诊断优化 / Reconnection diagnostics update

小窗、设置与弹窗区分旧连接收尾、正在连接和重试倒计时；不再把未知断连直接归因网络。新增本地连接阶段日志，最多120条、保留7天；字段白名单，不包含正文、文件路径、设备标识或凭据。诊断报告可包含这些阶段记录。日志写入失败不阻断连接；重试参数与文件执行规则不变。本次改动尚不能证明历史重连故障根因已消除。

The panel, settings and popup distinguish connection retirement, connecting and retry countdown. A bounded local history retains up to120 transitions for7 days, without content, file paths, device identifiers or credentials. Diagnostic exports may include these transitions. Log write failures do not block recovery. Retry timing and file execution rules are unchanged. This is a diagnostics improvement, not a confirmed fix for the historical outage.

## 2026-10-17 公开发布整理

补齐原有13个依赖包的锁文件及官方仓库完整性摘要；CI继续使用 npm ci，不升级依赖。统一源码安装、自动成果直接更新及本机工具恢复副本的说明。公开验证记录不含开发者本机路径；保留原许可证、来源和桌宠作者致谢。本轮不修改文件执行或重连时序，不更改已安装程序。新旧包以完整构建标识和 SHA256 区分。
