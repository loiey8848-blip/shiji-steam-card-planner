param(
    [string]$WebView2Sdk,
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'dist')
)

$ErrorActionPreference = 'Stop'
$version = '1.0.3537.50'
$output = Join-Path $OutputDirectory 'Steam配卡助手'
$cache = Join-Path $PSScriptRoot '.build'
if (!$WebView2Sdk) {
    $WebView2Sdk = Join-Path $cache "webview2-$version"
    if (!(Test-Path -LiteralPath (Join-Path $WebView2Sdk 'lib/net462/Microsoft.Web.WebView2.Core.dll'))) {
        New-Item -ItemType Directory -Force -Path $cache | Out-Null
        $archive = Join-Path $cache "webview2-$version.zip"
        $packageName = 'microsoft.web.webview2'
        Invoke-WebRequest -Uri "https://api.nuget.org/v3-flatcontainer/$packageName/$version/$packageName.$version.nupkg" -OutFile $archive
        Expand-Archive -LiteralPath $archive -DestinationPath $WebView2Sdk -Force
    }
}

$csc = Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$assemblies = Join-Path $WebView2Sdk 'lib/net462'
$assets = @('index.html', 'style.css', 'data.js', 'engine.js', 'progress.js', 'inventory.js', 'steam-form.js', 'ui.js', 'button-burst.js')
$references = @('System.dll', 'System.Core.dll', 'System.Drawing.dll', 'System.Net.Http.dll', 'System.Web.Extensions.dll', 'System.Windows.Forms.dll')
$sdkLibraries = @('Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll')

New-Item -ItemType Directory -Force -Path (Join-Path $output 'app') | Out-Null
$compilerArguments = @(
    '/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/codepage:65001',
    "/out:$output/拾级.exe", "/win32icon:$PSScriptRoot/assets/shiji.ico"
)
$compilerArguments += @($references | ForEach-Object { "/reference:$_" })
$compilerArguments += @($sdkLibraries | ForEach-Object { "/reference:$assemblies/$_" })
$compilerArguments += Join-Path $PSScriptRoot 'app/Host.cs'
$compilerArguments += Join-Path $PSScriptRoot 'app/NavTabButton.cs'
& $csc @compilerArguments
if ($LASTEXITCODE -ne 0) { throw "C# compiler exited with code $LASTEXITCODE." }

foreach ($asset in $assets) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "app/$asset") -Destination (Join-Path $output "app/$asset")
}
foreach ($library in $sdkLibraries) {
    Copy-Item -LiteralPath (Join-Path $assemblies $library) -Destination (Join-Path $output $library)
}
Copy-Item -LiteralPath (Join-Path $WebView2Sdk 'runtimes/win-x64/native/WebView2Loader.dll') -Destination $output
foreach ($notice in 'LICENSE', 'NOTICE') {
    Copy-Item -LiteralPath (Join-Path $WebView2Sdk "$notice.txt") -Destination (Join-Path $output "WebView2-$notice.txt")
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '使用说明.txt') -Destination $output
Get-Item -LiteralPath (Join-Path $output '拾级.exe')
