param([string]$NodePath)
$ErrorActionPreference = 'Stop'
if (-not $NodePath -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'runtime/node.exe'))) {
    $Bundled = Join-Path $PSScriptRoot 'runtime/node.exe'
    if ((Get-FileHash -LiteralPath $Bundled -Algorithm SHA256).Hash.ToLower() -ne '3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237') { throw '配套运行环境校验失败，未执行。' }
    $Signature = Get-AuthenticodeSignature -LiteralPath $Bundled
    if ($Signature.Status -ne 'Valid' -or $Signature.SignerCertificate.Subject -notmatch 'CN=OpenJS Foundation') { throw '配套运行环境签名未通过，未执行。' }
    $NodePath = $Bundled
}
if (-not $NodePath) {
    $runtime = Get-Command node -ErrorAction SilentlyContinue
    if (-not $runtime) { throw '请通过 -NodePath 指定安装时使用的 node.exe。' }
    $NodePath = $runtime.Source
}
$Clear = Read-Host '是否同时永久清除本机私有数据？默认否；需要清除请输入 YES'
if ($Clear -eq 'YES') {
    Write-Host '请先关闭使用此插件的 Chrome；清除不进回收站，工作文件与授权设置保留。服务端设备需在 Manage devices 页面另行撤销。'
    if ((Read-Host '再次确认永久清除请输入 YES') -ne 'YES') { Write-Host '取消私有数据清除，仅移除注册。' }
    else { & $NodePath (Join-Path $PSScriptRoot 'companion/install.mjs') --purge-private --confirm-purge; if ($LASTEXITCODE -ne 0) { throw '私有数据清除未完成，未继续卸载。' } }
}
& $NodePath (Join-Path $PSScriptRoot 'companion/install.mjs') --uninstall
if ($LASTEXITCODE -ne 0) { throw '卸载未完成，请查看上方提示。' }
