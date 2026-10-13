param(
    [string]$NodeHome,
    [string]$JavaHome,
    [string]$AndroidSdk
)

# Dot-source로 현재 PowerShell에만 적용합니다. 시스템 PATH와 실행 정책은 바꾸지 않습니다.
if (-not $NodeHome) {
    $toolRoot = Join-Path $env:LOCALAPPDATA 'Pawblossom\tools'
    if (Test-Path -LiteralPath $toolRoot) {
        $candidate = Get-ChildItem -LiteralPath $toolRoot -Directory -Filter 'node-v*-win-x64' |
            Where-Object { $_.Name -match '^node-v\d+\.\d+\.\d+-win-x64$' } |
            Sort-Object { [version]($_.Name -replace '^node-v|-win-x64$', '') } -Descending |
            Select-Object -First 1
        if ($candidate) { $NodeHome = $candidate.FullName }
    }
}
if ($NodeHome) {
    if (-not (Test-Path -LiteralPath (Join-Path $NodeHome 'node.exe')) -or
        -not (Test-Path -LiteralPath (Join-Path $NodeHome 'npm.cmd'))) {
        throw 'NodeHome에는 node.exe와 npm.cmd가 모두 있어야 합니다.'
    }
    $env:PATH = "$NodeHome;$env:PATH"
}
if (-not (Get-Command node -ErrorAction SilentlyContinue) -or
    -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw 'Node/npm을 찾지 못했습니다. 공식 Windows ZIP을 설치한 폴더를 -NodeHome으로 전달해 주세요.'
}
$nodeVersion = & node -p 'process.versions.node'
if ([version]$nodeVersion -lt [version]'22.0.0') { throw 'Node.js 22 이상이 필요합니다.' }

if ($JavaHome) {
    if (-not (Test-Path -LiteralPath (Join-Path $JavaHome 'bin\javac.exe'))) {
        throw 'JavaHome에는 bin\javac.exe가 있어야 합니다.'
    }
    $env:JAVA_HOME = $JavaHome
    $env:PATH = "$(Join-Path $JavaHome 'bin');$env:PATH"
}
if ($AndroidSdk) {
    foreach ($required in @('platform-tools\adb.exe', 'platforms\android-36\android.jar', 'build-tools\36.0.0\aapt2.exe')) {
        if (-not (Test-Path -LiteralPath (Join-Path $AndroidSdk $required))) {
            throw "Android SDK 구성요소가 없습니다: $required"
        }
    }
    $env:ANDROID_HOME = $AndroidSdk
    $env:PATH = "$(Join-Path $AndroidSdk 'platform-tools');$env:PATH"
}

Write-Output "Node: $((Get-Command node).Source) ($nodeVersion)"
Write-Output "npm: $((Get-Command npm.cmd).Source)"
Write-Output "JAVA_HOME: $env:JAVA_HOME"
Write-Output "ANDROID_HOME: $env:ANDROID_HOME"
Write-Output '이 설정은 현재 셸에서만 유지됩니다. Android local.properties는 별도로 확인해 주세요.'
