param([switch]$SelfTest,[ValidateSet('zh-CN','en')][string]$Language='zh-CN')
$ErrorActionPreference = 'Stop'
$script:UiLanguage=$Language
$script:StatusKey='仅安装当前用户的连接，不会读取你的资料文件。此预览尚未正式发布。'
$script:StatusDetail=''
$Translations=@{
 '第一步：本机程序已安装。第二步：请在 Chrome 加载扩展，是否加载成功需到扩展首次使用页检查。'='Step 1: The local program is installed. Step 2: Load its extension in Chrome. Confirm it on the extension setup page.'
 '第一步：安装本机程序。第二步：在 Chrome 加载安装目录下的 extension。仅解压新包不算升级。'='Step 1: Install the local program. Step 2: Load the extension folder from the installation directory in Chrome. Extracting a new package does not update the running program.'
 '这个安装包没有配套运行环境，请获取Windows完整包。'='The bundled runtime is missing. Obtain the complete Windows package.'
 '运行环境校验失败，未安装。'='Runtime checksum validation failed. Nothing was installed.'
 '运行环境签名未通过，未安装。'='Runtime signature validation failed. Nothing was installed.'
 '安装 Claude 文件连接'='Install Claude Folder Bridge'
 '让 Claude 在你选择的文件夹里工作'='Let Claude work in a folder you choose'
 '配套运行环境已经包含，不用另装 Node.js。不改代理、不改全局软件。安装完成后，还需在 Chrome 中加载扩展，再选择允许访问的文件夹。'='The runtime is included. No separate Node.js installation is required. Proxy and global software settings are unchanged. After installation, load the extension in Chrome and choose your working folder.'
 '安装到这里：'='Installation folder:'
 '更换位置'='Change location'
 '安装'='Install'
 '复制扩展路径'='Copy extension path'
 '打开安装文件夹'='Open install folder'
 '仅安装当前用户的连接，不会读取你的资料文件。此预览尚未正式发布。'='Installs the connection for the current Windows user only. Your documents are not read during installation.'
 '选择安装位置的上级文件夹'='Choose the parent installation folder'
 '已复制。Chrome打开 chrome://extensions/，开启开发者模式，加载这个extension文件夹。'='Path copied. Open chrome://extensions/ in Chrome, enable Developer mode, and load this extension folder.'
 '本机安装程序没有启动。'='The local installer did not start.'
 '正在校验和安装，请稍等。'='Validating and installing. Please wait.'
 '没有完成安装：'='Installation did not complete: '
 '安装结果需要核对。'='The installation result needs verification.'
 '配套程序安装完成。点“复制扩展路径”，在Chrome扩展页面加载，再点插件选择自己的测试文件夹。原解压包现在可以另行保留。'='Installation complete. Copy the extension path and load it on the Chrome extensions page. Then open the extension and choose your working folder. You may keep the original extracted package separately.'
 '安装正在收尾，请等结果出现后再关闭。'='Installation is finishing. Wait for the result before closing.'
 '安装向导初始状态不正确。'='Invalid initial installer state.'
 '安装包预检查失败。'='Package preflight failed.'
 '只读预检查产生了改动。'='The read-only preflight changed files.'
 '程序已安装，但语言偏好未能保存。请在连接设置中重新选择语言。'='The program was installed, but the language preference could not be saved. Choose the language again in connection settings.'
}
function Tr([string]$Text){if($script:UiLanguage -eq 'en' -and $Translations.ContainsKey($Text)){return $Translations[$Text]};return $Text}
function Set-WizardStatus([string]$Key,[string]$Detail=''){$script:StatusKey=$Key;$script:StatusDetail=$Detail;if($Status){$Status.Text=(Tr $Key)+$Detail}}

[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$Node = Join-Path $PSScriptRoot 'runtime/node.exe'
if (-not (Test-Path -LiteralPath $Node)) { throw (Tr '这个安装包没有配套运行环境，请获取Windows完整包。') }
if ((Get-FileHash -LiteralPath $Node -Algorithm SHA256).Hash.ToLower() -ne '3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237') { throw (Tr '运行环境校验失败，未安装。') }
$Signature = Get-AuthenticodeSignature -LiteralPath $Node
if ($Signature.Status -ne 'Valid' -or $Signature.SignerCertificate.Subject -notmatch 'CN=OpenJS Foundation') { throw (Tr '运行环境签名未通过，未安装。') }
$Script = Join-Path $PSScriptRoot 'companion/windows-setup.mjs'
$script:Destination = Join-Path $env:LOCALAPPDATA 'Programs/ClaudeFolderBridge'
$script:Process = $null
$script:Installed = $false
$Form = New-Object System.Windows.Forms.Form
$Form.Text = (Tr '安装 Claude 文件连接')
$Form.ClientSize = New-Object System.Drawing.Size(640,520)
$Form.StartPosition = 'CenterScreen'
$Form.FormBorderStyle = 'FixedDialog'
$Form.MaximizeBox = $false
$Form.BackColor = [System.Drawing.Color]::FromArgb(249,247,242)
$Form.Font = New-Object System.Drawing.Font('Microsoft YaHei UI',10)
function Label([string]$Text,[int]$X,[int]$Y,[int]$Width,[int]$Height) {
 $Control = New-Object System.Windows.Forms.Label
 $Control.Text=$Text; $Control.Location=New-Object System.Drawing.Point($X,$Y); $Control.Size=New-Object System.Drawing.Size($Width,$Height)
 $Form.Controls.Add($Control); return $Control
}
$Title=Label (Tr '让 Claude 在你选择的文件夹里工作') 24 60 590 42
$Title.Font=New-Object System.Drawing.Font('Microsoft YaHei UI',15,[System.Drawing.FontStyle]::Bold)
$Description=Label (Tr '配套运行环境已经包含，不用另装 Node.js。不改代理、不改全局软件。安装完成后，还需在 Chrome 中加载扩展，再选择允许访问的文件夹。') 24 112 590 80
$PathLabel=Label (Tr '安装到这里：') 24 202 590 26
$Location=New-Object System.Windows.Forms.TextBox
$Location.Location=New-Object System.Drawing.Point(24,234);$Location.Size=New-Object System.Drawing.Size(460,28);$Location.ReadOnly=$true;$Location.Text=$script:Destination;$Form.Controls.Add($Location)
function Button([string]$Text,[int]$X,[int]$Y,[int]$Width) {
 $Control=New-Object System.Windows.Forms.Button
 $Control.Text=$Text;$Control.Location=New-Object System.Drawing.Point($X,$Y);$Control.Size=New-Object System.Drawing.Size($Width,34)
 $Form.Controls.Add($Control);return $Control
}
$Choose=Button (Tr '更换位置') 492 233 122
$Install=Button (Tr '安装') 24 283 110
$Copy=Button (Tr '复制扩展路径') 145 283 165;$Copy.Enabled=$false
$Open=Button (Tr '打开安装文件夹') 322 283 190;$Open.Enabled=$false
$Status=Label (Tr '仅安装当前用户的连接，不会读取你的资料文件。此预览尚未正式发布。') 24 334 590 93
$Steps=Label '' 24 434 590 65
$LanguageLabel=Label 'Language / 语言' 24 19 145 26
$LanguageChoice=New-Object System.Windows.Forms.ComboBox
$LanguageChoice.DropDownStyle='DropDownList';$LanguageChoice.Location=New-Object System.Drawing.Point(172,16);$LanguageChoice.Size=New-Object System.Drawing.Size(230,28)
[void]$LanguageChoice.Items.Add('中文（简体）');[void]$LanguageChoice.Items.Add('English');$LanguageChoice.SelectedIndex=if($script:UiLanguage -eq 'en'){1}else{0};$Form.Controls.Add($LanguageChoice)
function Render-Language {
 $Form.Text=Tr '安装 Claude 文件连接';$Title.Text=Tr '让 Claude 在你选择的文件夹里工作'
 $Description.Text=Tr '配套运行环境已经包含，不用另装 Node.js。不改代理、不改全局软件。安装完成后，还需在 Chrome 中加载扩展，再选择允许访问的文件夹。'
 $PathLabel.Text=Tr '安装到这里：';$Choose.Text=Tr '更换位置';$Install.Text=Tr '安装';$Copy.Text=Tr '复制扩展路径';$Open.Text=Tr '打开安装文件夹'
 $Status.Text=(Tr $script:StatusKey)+$script:StatusDetail
 $Steps.Text=if($script:Installed){Tr '第一步：本机程序已安装。第二步：请在 Chrome 加载扩展，是否加载成功需到扩展首次使用页检查。'}else{Tr '第一步：安装本机程序。第二步：在 Chrome 加载安装目录下的 extension。仅解压新包不算升级。'}
}
$LanguageChoice.Add_SelectedIndexChanged({$script:UiLanguage=if($LanguageChoice.SelectedIndex -eq 1){'en'}else{'zh-CN'};Render-Language})
Render-Language
$Timer=New-Object System.Windows.Forms.Timer;$Timer.Interval=250
$Choose.Add_Click({
 $Dialog=New-Object System.Windows.Forms.FolderBrowserDialog;$Dialog.Description=(Tr '选择安装位置的上级文件夹');
 if($Dialog.ShowDialog() -eq 'OK'){$script:Destination=Join-Path $Dialog.SelectedPath 'ClaudeFolderBridge';$Location.Text=$script:Destination};$Dialog.Dispose()
})
$Copy.Add_Click({[System.Windows.Forms.Clipboard]::SetText((Join-Path $script:Destination 'extension'));Set-WizardStatus '已复制。Chrome打开 chrome://extensions/，开启开发者模式，加载这个extension文件夹。'})
$Open.Add_Click({Start-Process -FilePath (Join-Path ([Environment]::GetFolderPath('Windows')) 'explorer.exe') -ArgumentList ('"'+$script:Destination+'"')})
$Install.Add_Click({
 if($script:Process){return}
 try {
  $Info=New-Object System.Diagnostics.ProcessStartInfo
  $Info.FileName=$Node;$Info.Arguments='"'+$Script+'" --install "'+$PSScriptRoot+'" "'+$script:Destination+'" '+$script:UiLanguage
  $Info.UseShellExecute=$false;$Info.CreateNoWindow=$true;$Info.RedirectStandardOutput=$true;$Info.RedirectStandardError=$true
  $script:Process=New-Object System.Diagnostics.Process;$script:Process.StartInfo=$Info
  if(-not $script:Process.Start()){throw (Tr '本机安装程序没有启动。')}
  $script:Output=$script:Process.StandardOutput.ReadToEndAsync();$script:Failure=$script:Process.StandardError.ReadToEndAsync()
  $Choose.Enabled=$false;$Install.Enabled=$false;$LanguageChoice.Enabled=$false;Set-WizardStatus '正在校验和安装，请稍等。';$Timer.Start()
 }catch{Set-WizardStatus '没有完成安装：' $_.Exception.Message;if($script:Process){$script:Process.Dispose();$script:Process=$null};$Choose.Enabled=$true;$Install.Enabled=$true;$LanguageChoice.Enabled=$true}
})
$Timer.Add_Tick({
 if(-not $script:Process -or -not $script:Process.HasExited){return};$Timer.Stop()
 try{
  $Text=$script:Output.Result;$Failure=$script:Failure.Result
  if($script:Process.ExitCode -ne 0){throw $Failure}
  $Result=$Text|ConvertFrom-Json
  if(-not $Result.installed -or $Result.target -ne $script:Destination){throw (Tr '安装结果需要核对。')}
  $script:Installed=$true;Render-Language;$Copy.Enabled=$true;$Open.Enabled=$true;$LanguageChoice.Enabled=$true
  if($Result.languageSaved -eq $false){Set-WizardStatus '程序已安装，但语言偏好未能保存。请在连接设置中重新选择语言。';return}
  Set-WizardStatus '配套程序安装完成。点“复制扩展路径”，在Chrome扩展页面加载，再点插件选择自己的测试文件夹。原解压包现在可以另行保留。'
 }catch{Set-WizardStatus '没有完成安装：' $_.Exception.Message;$Choose.Enabled=$true;$Install.Enabled=$true;$LanguageChoice.Enabled=$true}
 finally{$script:Process.Dispose();$script:Process=$null}
})
$Form.Add_FormClosing({param($sender,$event);if($script:Process){$event.Cancel=$true;Set-WizardStatus '安装正在收尾，请等结果出现后再关闭。'}})
if($SelfTest){
 $LanguageChoice.SelectedIndex=1;if($Install.Text -ne 'Install'){throw 'English selector failed'}
 $LanguageChoice.SelectedIndex=0;if($Install.Text -ne '安装'){throw 'Chinese selector failed'}
 $LanguageChoice.SelectedIndex=if($Language -eq 'en'){1}else{0}

 if($Form.Controls.Count -lt 9 -or $Copy.Enabled -or $Open.Enabled){throw (Tr '安装向导初始状态不正确。')}
 $Target=if($env:CFB_GUI_TEST_TARGET){$env:CFB_GUI_TEST_TARGET}else{Join-Path $PSScriptRoot '../gui-selftest-not-created'}
 $Text=& $Node $Script --plan $PSScriptRoot $Target
 if($LASTEXITCODE -ne 0){throw (Tr '安装包预检查失败。')}
 $Plan=$Text|ConvertFrom-Json
 if($Plan.changesApplied){throw (Tr '只读预检查产生了改动。')}
 $Form.Dispose();$Timer.Dispose();Write-Output ('GUI self-test passed; install not executed; version='+$Plan.version);exit 0
}
try{[void]$Form.ShowDialog()}finally{$Timer.Dispose();$Form.Dispose()}
