# 来源及改动

本项目独立整合以下 MIT 代码，不是 Anthropic、claudeFS 或 Desktop Commander 的官方产品。

- claudeFS：Copyright (c) 2026 vincentping@gmail.com。保留了网页握手、MCP 协议与跨脚本通道；目录句柄、原有文件执行器和确认界面改由统一本机执行器及设置页替代。写权限由用户在扩展设置中明确开启，开启后不会逐次弹出确认。这与上游原版 claudeFS 的逐次修改确认不同。
- Desktop Commander：原许可见 `licenses/DesktopCommander-LICENSE.txt`。仅使用远程设备、验证和转发协议，替换了文件执行器；禁用遥测，设备使用通用名称，HTTP 和 WebSocket 共用用户明确选择的网络方式；代理模式不可用时不回退直连。本机命令及系统配置工具不提供给执行器。
- npm 依赖：版本与许可见 `DEPENDENCIES.json`；各依赖的许可文件随 `node_modules` 保留。依赖均来自已核对的官方 npm 包，分发包不执行依赖安装脚本。

来源快照、固定提交及修改前摘要见 `UPSTREAM.json`。0.1.7 原有代码的 MIT 授权保留在 `licenses/ClaudeFolderBridge-MIT-0.1.7.txt`。0.1.8 起包含 Clawd AGPL 素材的组合版本按 AGPL-3.0-only 分发，完整对应源码随包提供，见根目录 `LICENSE`；各独立上游组件仍保留其原许可。不要删除上游许可证后重新分发。

- Clawd on Desk：复用五份 SVG 动画，采用 AGPL-3.0-only。原许可及声明见 `licenses/Clawd-LICENSE.txt`、`licenses/Clawd-NOTICE.md`，固定提交和每份素材摘要见 `UPSTREAM.json`。没有复制其 Electron 运行器、Agent hooks 或外部服务功能；新增状态适配与小窗交互。角色来源不代表 Anthropic 或上游作者认可本插件。

0.4.1追加改动：Windows持久登录使用DPAPI，旧明文登录不复用；显著文件数据说明及当前浏览器个人资料同意拦截；工具禁止访问连接程序与私有状态；系统辅助程序使用固定路径；xmldom与undici更新为0.8.15与6.29.0。

0.4.2修复多重硬链接越权访问：这类文件不开放读取、改写、复制、移动或删除，搜索跳过；文件夹移动/删除遇到此类子项停止。普通文件不受此限制。若确实需要处理，请通过文件管理器另存为普通副本。独占发布过程中的内部临时链接在最终校验前解除，不改变正常文件保存行为。


中英双语修订：增加 Windows 安装/更新语言选择、本机语言偏好和离线界面目录，修复工作台按钮作用域。上游来源与许可证不变。桌宠作者和参与完善说明见 `CONTRIBUTORS.md`、`CONTRIBUTING.md`。
