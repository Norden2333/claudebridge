param([string]$NodePath)
$ErrorActionPreference = 'Stop'
$Location = [System.IO.Path]::GetFullPath($PSScriptRoot)
$HomePath = [Environment]::GetFolderPath('UserProfile')
$Transient = @((Join-Path $HomePath 'Downloads'), ([Environment]::GetFolderPath('Desktop')), [System.IO.Path]::GetTempPath())
foreach ($Folder in $Transient) {
    if (-not $Folder) { continue }
    $Root = [System.IO.Path]::GetFullPath($Folder).TrimEnd('\')
    if ($Location.Equals($Root, [StringComparison]::OrdinalIgnoreCase) -or $Location.StartsWith($Root + '\', [StringComparison]::OrdinalIgnoreCase)) {
        Write-Host '建议使用安装向导；若继续直接注册此目录，请不要删除或移动此文件夹。'
        if ((Read-Host '继续请输入 Y；其他输入退出') -ne 'Y') { Write-Host '未执行'; exit }
        break
    }
}
if (-not $NodePath -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'runtime/node.exe'))) {
    $Bundled = Join-Path $PSScriptRoot 'runtime/node.exe'
    $Hash = (Get-FileHash -LiteralPath $Bundled -Algorithm SHA256).Hash.ToLower()
    if ($Hash -ne '3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237') { throw '配套运行环境校验失败，未安装。请重新获取完整安装包。' }
    $Signature = Get-AuthenticodeSignature -LiteralPath $Bundled
    if ($Signature.Status -ne 'Valid' -or $Signature.SignerCertificate.Subject -notmatch 'CN=OpenJS Foundation') { throw '配套运行环境签名未通过，未安装。' }
    $NodePath = $Bundled
}
if (-not $NodePath) {
    $runtime = Get-Command node -ErrorAction SilentlyContinue
    if (-not $runtime) { throw '请先安装 Node.js 22 或更新版本，再运行此文件。也可通过 -NodePath 指定 node.exe。' }
    $NodePath = $runtime.Source
}
& $NodePath (Join-Path $PSScriptRoot 'companion/install.mjs')
if ($LASTEXITCODE -ne 0) { throw '安装未完成，请查看上方提示。' }
