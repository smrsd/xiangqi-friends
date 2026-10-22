[CmdletBinding()]
param(
    [string]$SdkPath = $(if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { 'D:\Dev\Android\sdk' }),
    [string]$JavaHome = $(if ($env:JAVA_HOME) { $env:JAVA_HOME } else { 'D:\Dev\jdk-17' }),
    [string]$ServerUrl = 'https://xiangqi-friends-smrsd.thelittleprince.chatgpt.site/',
    [ValidateRange(26, 99)][int]$CompileSdk = 35,
    [ValidateSet('Debug', 'Release')][string]$Configuration = 'Debug'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-BuildTool {
    param([string]$Tool, [string[]]$ToolArguments)
    & $Tool @ToolArguments
    if ($LASTEXITCODE -ne 0) { throw "Build tool failed with exit code ${LASTEXITCODE}: $Tool" }
}

$isDebug = $Configuration -eq 'Debug'
if ($ServerUrl) {
    $parsed = $null
    if (-not [Uri]::TryCreate($ServerUrl, [UriKind]::Absolute, [ref]$parsed)) {
        throw 'ServerUrl must be an absolute HTTPS origin.'
    }
    $localHttp = $isDebug -and $parsed.Scheme -eq 'http' -and @('localhost', '10.0.2.2').Contains($parsed.Host)
    if (($parsed.Scheme -ne 'https' -and -not $localHttp) -or -not $parsed.Host -or
        $parsed.UserInfo -or $parsed.Query -or $parsed.Fragment -or $parsed.AbsolutePath -ne '/') {
        throw 'ServerUrl must be an HTTPS origin without credentials, path, query, or fragment. Debug also allows http://localhost or http://10.0.2.2.'
    }
    $ServerUrl = $parsed.AbsoluteUri
}

$androidRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$buildRoot = [IO.Path]::GetFullPath((Join-Path $androidRoot 'build'))
$variant = $Configuration.ToLowerInvariant()
$intermediate = [IO.Path]::GetFullPath((Join-Path $buildRoot "intermediates\$variant"))
# Validate the actual deletion target before removing only generated variant files.
if (-not $intermediate.StartsWith($buildRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Generated build directory must stay under android/build.'
}
$androidJar = Join-Path $SdkPath "platforms\android-$CompileSdk\android.jar"
if (-not (Test-Path -LiteralPath $androidJar)) { throw "Android platform missing: $androidJar" }
$buildToolsRoot = Join-Path $SdkPath 'build-tools'
$buildTools = Get-ChildItem -LiteralPath $buildToolsRoot -Directory |
    Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' } |
    Sort-Object { [Version]$_.Name } -Descending | Select-Object -First 1
if (-not $buildTools) { throw "No stable Android build-tools found under $buildToolsRoot" }
$javac = Join-Path $JavaHome 'bin\javac.exe'
$java = Join-Path $JavaHome 'bin\java.exe'
$jar = Join-Path $JavaHome 'bin\jar.exe'
$keytool = Join-Path $JavaHome 'bin\keytool.exe'
$aapt2 = Join-Path $buildTools.FullName 'aapt2.exe'
$zipalign = Join-Path $buildTools.FullName 'zipalign.exe'
$d8 = Join-Path $buildTools.FullName 'lib\d8.jar'
$apksigner = Join-Path $buildTools.FullName 'lib\apksigner.jar'
foreach ($toolPath in @($javac, $java, $jar, $keytool, $aapt2, $zipalign, $d8, $apksigner)) {
    if (-not (Test-Path -LiteralPath $toolPath)) { throw "Required tool missing: $toolPath" }
}
if (Test-Path -LiteralPath $intermediate) { Remove-Item -LiteralPath $intermediate -Recurse -Force }
$generated = Join-Path $intermediate 'generated'
$classes = Join-Path $intermediate 'classes'
$dex = Join-Path $intermediate 'dex'
New-Item -ItemType Directory -Path $generated, $classes, $dex -Force | Out-Null
$main = Join-Path $androidRoot 'app\src\main'
$res = Join-Path $intermediate 'res'
Copy-Item -LiteralPath (Join-Path $main 'res') -Destination $res -Recurse
if ($isDebug) {
    Copy-Item -LiteralPath (Join-Path $androidRoot 'app\src\debug\res\xml\network_security_config.xml') `
        -Destination (Join-Path $res 'xml\network_security_config.xml') -Force
}
$utf8 = New-Object Text.UTF8Encoding($false)
$manifest = [IO.File]::ReadAllText((Join-Path $main 'AndroidManifest.xml'))
$manifest = $manifest.Replace('<manifest xmlns:', '<manifest package="io.xiangqifriends.app" xmlns:')
if ($isDebug) { $manifest = $manifest.Replace('android:allowBackup="false"', 'android:allowBackup="false" android:debuggable="true"') }
$manifestPath = Join-Path $intermediate 'AndroidManifest.xml'
[IO.File]::WriteAllText($manifestPath, $manifest, $utf8)
$compiledRes = Join-Path $intermediate 'compiled-res.zip'
$unsigned = Join-Path $intermediate 'unsigned.apk'
$aligned = Join-Path $intermediate 'aligned.apk'
Write-Host "Building XiangqiFriends $Configuration with platform $CompileSdk / build-tools $($buildTools.Name)"
Invoke-BuildTool $aapt2 @('compile', '--dir', $res, '-o', $compiledRes)
Invoke-BuildTool $aapt2 @('link', '-o', $unsigned, '-I', $androidJar, '--manifest', $manifestPath,
    '--java', $generated, '--min-sdk-version', '26', '--target-sdk-version', "$CompileSdk",
    '--version-code', '1', '--version-name', '1.0.0', '--auto-add-overlay', $compiledRes)
$configDirectory = Join-Path $generated 'io\xiangqifriends\app'
New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null
$escapedUrl = $ServerUrl.Replace('\', '\\').Replace('"', '\"')
$debugLiteral = $isDebug.ToString().ToLowerInvariant()
$buildConfig = @"
package io.xiangqifriends.app;
public final class BuildConfig {
    public static final boolean DEBUG = $debugLiteral;
    public static final String DEFAULT_SERVER_URL = "$escapedUrl";
    private BuildConfig() {}
}
"@
[IO.File]::WriteAllText((Join-Path $configDirectory 'BuildConfig.java'), $buildConfig, $utf8)
$sourcePaths = @(Get-ChildItem -LiteralPath (Join-Path $main 'java') -Filter '*.java' -Recurse) +
    @(Get-ChildItem -LiteralPath $generated -Filter '*.java' -Recurse)
$sourceList = Join-Path $intermediate 'java-sources.txt'
$quotedSources = $sourcePaths | ForEach-Object { '"' + $_.FullName.Replace('\', '/') + '"' }
[IO.File]::WriteAllLines($sourceList, [string[]]$quotedSources, $utf8)
Invoke-BuildTool $javac @('-J-Xms32m', '-J-Xmx256m', '-J-XX:+UseSerialGC', '-encoding', 'UTF-8', '-source', '8', '-target', '8', '-Xlint:-options',
    '-classpath', $androidJar, '-d', $classes, "@$sourceList")
$classesJar = Join-Path $intermediate 'classes.jar'
Invoke-BuildTool $jar @('-J-Xms16m', '-J-Xmx128m', '-J-XX:+UseSerialGC', '--create', '--file', $classesJar, '-C', $classes, '.')
Invoke-BuildTool $java @('-Xms32m', '-Xmx256m', '-XX:+UseSerialGC', '-cp', $d8, 'com.android.tools.r8.D8', '--lib', $androidJar,
    '--min-api', '26', '--output', $dex, $classesJar)

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::Open($unsigned, [IO.Compression.ZipArchiveMode]::Update)
try {
    foreach ($dexFile in @(Get-ChildItem -LiteralPath $dex -Filter '*.dex')) {
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $dexFile.FullName,
            $dexFile.Name, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $archive.Dispose() }
Invoke-BuildTool $zipalign @('-f', '-p', '4', $unsigned, $aligned)
$output = Join-Path $buildRoot "xiangqifriends-$variant.apk"
if ($isDebug) {
    $keystore = Join-Path $buildRoot 'debug.keystore'
    if (-not (Test-Path -LiteralPath $keystore)) {
        Invoke-BuildTool $keytool @('-J-Xms16m', '-J-Xmx128m', '-J-XX:+UseSerialGC', '-genkeypair', '-noprompt', '-keystore', $keystore, '-storepass', 'android',
            '-keypass', 'android', '-alias', 'androiddebugkey', '-dname', 'CN=Android Debug,O=XiangqiFriends,C=CN',
            '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000')
    }
    Invoke-BuildTool $java @('-Xms16m', '-Xmx128m', '-XX:+UseSerialGC', '-jar', $apksigner, 'sign', '--ks', $keystore, '--ks-pass', 'pass:android',
        '--key-pass', 'pass:android', '--ks-key-alias', 'androiddebugkey', '--out', $output, $aligned)
    Invoke-BuildTool $java @('-Xms16m', '-Xmx128m', '-XX:+UseSerialGC', '-jar', $apksigner, 'verify', '--verbose', '--print-certs', $output)
} else {
    $output = Join-Path $buildRoot 'xiangqifriends-release-unsigned.apk'
    Copy-Item -LiteralPath $aligned -Destination $output -Force
    Write-Host 'Release APK is unsigned. Sign it using your own external keystore before installation.'
}
Invoke-BuildTool $zipalign @('-c', '-p', '4', $output)
$hash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText("$output.sha256", "$hash  $([IO.Path]::GetFileName($output))`n", $utf8)
Write-Host "APK: $output"
Write-Host "SHA256: $hash"
