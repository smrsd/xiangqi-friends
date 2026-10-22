[CmdletBinding()]
param([string]$JavaHome = $(if ($env:JAVA_HOME) { $env:JAVA_HOME } else { 'D:\Dev\jdk-17' }))
$ErrorActionPreference = 'Stop'
$testOutput = Join-Path $PSScriptRoot 'build\tests'
New-Item -ItemType Directory -Path $testOutput -Force | Out-Null
& (Join-Path $JavaHome 'bin\javac.exe') '-J-Xms16m' '-J-Xmx128m' '-J-XX:+UseSerialGC' '-encoding' 'UTF-8' `
    '-d' $testOutput (Join-Path $PSScriptRoot 'app\src\main\java\io\xiangqifriends\app\ServerAddress.java') `
    (Join-Path $PSScriptRoot 'tests\io\xiangqifriends\app\ServerAddressTest.java')
if ($LASTEXITCODE -ne 0) { throw 'Android URL validation tests failed to compile.' }
& (Join-Path $JavaHome 'bin\java.exe') '-Xms16m' '-Xmx128m' '-XX:+UseSerialGC' '-cp' $testOutput 'io.xiangqifriends.app.ServerAddressTest'
if ($LASTEXITCODE -ne 0) { throw 'Android URL validation tests failed.' }
