#!/bin/sh
set -eu
cd "$(dirname "$0")"
command -v node >/dev/null || { printf '%s\n' '需要 Node.js 22 或更新版本。'; exit 1; }
printf '%s\n' '先关闭所有 Claude 标签页、设置和工作台。输入1普通更新、2切回、3升级旧授权格式、其他退出：'
read -r choice
case "$choice" in
1) node companion/install.mjs --update ;;
3) printf '%s\n' '下一次保存后旧程序不能读取新授权格式。确认升级请输入YES：'; read -r accept; [ "$accept" = 'YES' ] || exit 0; node companion/install.mjs --update --migrate-settings ;;
2) printf '%s\n' '粘贴更新结果中的 backupId：'; read -r backup; [ -n "$backup" ] || exit 1; node companion/install.mjs --rollback --backup "$backup" ;;
*) printf '%s\n' '未执行'; exit 0 ;;
esac
printf '%s\n' '完成后重新加载 Chrome 扩展，再刷新 Claude。'
