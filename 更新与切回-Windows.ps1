param([string]$NodePath,[ValidateSet('zh-CN','en')][string]$Language)
$ErrorActionPreference = 'Stop'

if(-not $Language){$Selection=Read-Host 'Language / 语言: 1 中文, 2 English';$Language=if($Selection -eq '2'){'en'}else{'zh-CN'}}
$UpdateTexts=@{
 '配套运行环境校验失败，未执行。'='Bundled runtime checksum validation failed. No action was performed.'
 '配套运行环境签名未通过，未执行。'='Bundled runtime signature validation failed. No action was performed.'
 '需要 Node.js 22 或更新版本；可通过 -NodePath 指定已有 node.exe。'='Node.js 22 or later is required. Use -NodePath to specify an existing node.exe.'
 '先关闭全部 Claude 标签页、设置和工作台；只更新代码，保留设置和登录。'='Close Claude tabs, extension settings, and the workbench first. Updating changes program files and preserves settings and login.'
 '输入 1 普通更新；输入 2 切回；输入 3 升级旧授权格式；其他输入退出'='Enter 1 to update, 2 to roll back, 3 to migrate legacy settings, or another value to exit'
 '新程序保留旧设置，下一次保存时升级授权格式；此后不能直接切回旧程序。'='The old settings are retained until the next save migrates them. After migration, downgrading may not be possible.'
 '确认升级请输入 YES'='Enter YES to confirm migration'
 '未执行'='No action performed'
 '读取更新记录失败，未切回。'='Update history could not be read. No rollback was performed.'
 '输入上面序号，或直接粘贴 backupId；空白取消'='Choose a listed number or paste a backupId. Leave blank to cancel'
 '序号无效，未切回。'='Invalid selection. No rollback was performed.'
}
function Tr([string]$Text){if($Language -eq 'en' -and $UpdateTexts.ContainsKey($Text)){return $UpdateTexts[$Text]};return $Text}
if (-not $NodePath -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'runtime/node.exe'))) {
    $Bundled = Join-Path $PSScriptRoot 'runtime/node.exe'
    if ((Get-FileHash -LiteralPath $Bundled -Algorithm SHA256).Hash.ToLower() -ne '3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237') { throw (Tr '配套运行环境校验失败，未执行。') }
    $Signature = Get-AuthenticodeSignature -LiteralPath $Bundled
    if ($Signature.Status -ne 'Valid' -or $Signature.SignerCertificate.Subject -notmatch 'CN=OpenJS Foundation') { throw (Tr '配套运行环境签名未通过，未执行。') }
    $NodePath = $Bundled
}
if (-not $NodePath) { $Runtime = Get-Command node -ErrorAction SilentlyContinue; if (-not $Runtime) { throw (Tr '需要 Node.js 22 或更新版本；可通过 -NodePath 指定已有 node.exe。') }; $NodePath = $Runtime.Source }
Write-Host (Tr '先关闭全部 Claude 标签页、设置和工作台；只更新代码，保留设置和登录。')
$Choice = Read-Host (Tr '输入 1 普通更新；输入 2 切回；输入 3 升级旧授权格式；其他输入退出')
if ($Choice -eq '1') { & $NodePath (Join-Path $PSScriptRoot 'companion/install.mjs') --update }
elseif ($Choice -eq '3') { Write-Host (Tr '新程序保留旧设置，下一次保存时升级授权格式；此后不能直接切回旧程序。'); $Accept = Read-Host (Tr '确认升级请输入 YES'); if ($Accept -ne 'YES') { Write-Host (Tr '未执行'); exit }; & $NodePath (Join-Path $PSScriptRoot 'companion/install.mjs') --update --migrate-settings }
elseif ($Choice -eq '2') {
    $Rows = @((& $NodePath (Join-Path $PSScriptRoot 'companion/install.mjs') --list-updates) | ConvertFrom-Json)
    if ($LASTEXITCODE -ne 0) { throw (Tr '读取更新记录失败，未切回。') }
    for ($i = 0; $i -lt $Rows.Count; $i++) { Write-Host ('{0}. {1} -> {2}  {3}  {4}' -f ($i + 1), $Rows[$i].from, $Rows[$i].to, $Rows[$i].state, $Rows[$i].time) }
    $Selection = Read-Host (Tr '输入上面序号，或直接粘贴 backupId；空白取消')
    if (-not $Selection) { Write-Host (Tr '未执行'); exit }
    $Backup = $Selection
    $Index = 0
    if ([int]::TryParse($Selection, [ref]$Index)) { if ($Index -lt 1 -or $Index -gt $Rows.Count) { throw (Tr '序号无效，未切回。') }; $Backup = $Rows[$Index - 1].id }
    & $NodePath (Join-Path $PSScriptRoot 'companion/install.mjs') --rollback --backup $Backup
}
else { Write-Host (Tr '未执行'); exit }
if ($LASTEXITCODE -ne 0) { throw '未完成，请查看上方说明；不要反复覆盖安装。' }
Write-Host '完成后在 Chrome 扩展页面点重新加载，再刷新 Claude。'

if($LASTEXITCODE -eq 0 -and $Choice -in @('1','2','3')){ & $NodePath (Join-Path $PSScriptRoot 'companion/install.mjs') --set-ui-language $Language; if($LASTEXITCODE -ne 0){Write-Warning $(if($Language -eq 'en'){'Program operation completed, but the language preference was not saved.'}else{'程序操作已完成，但语言偏好未保存。'})} }
