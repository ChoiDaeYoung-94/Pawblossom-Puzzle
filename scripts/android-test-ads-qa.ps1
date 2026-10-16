# 개발 도구 환경을 먼저 dot-source한 뒤 실행합니다. 웹 에셋은 finally에서 원본으로 복구합니다.
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$androidRoot = Join-Path $projectRoot 'android'
$marker = Join-Path $androidRoot 'app/src/main/assets/public/build-info.json'
$original = [System.IO.File]::ReadAllBytes($marker)
$checks = @()
$cases = @(
    @{ name='시험 에셋'; content='{"testTools":true,"androidTestAds":true}' },
    @{ name='누락'; content=$null },
    @{ name='손상 JSON'; content='{"testTools":' },
    @{ name='광고 필드 누락'; content='{"testTools":false}' },
    @{ name='문자열 false'; content='{"testTools":"false","androidTestAds":"false"}' }
)
try {
    foreach ($case in $cases) {
        if ($null -eq $case.content) { Remove-Item -LiteralPath $marker }
        else { [System.IO.File]::WriteAllText($marker, $case.content, [System.Text.UTF8Encoding]::new($false)) }
        $logPath = Join-Path $androidRoot ('release-guard-' + $checks.Count + '.log')
        & (Join-Path $androidRoot 'gradlew.bat') -p $androidRoot --no-daemon --max-workers=2 '-Dorg.gradle.jvmargs=-Xmx1024m -Dfile.encoding=UTF-8' :app:preReleaseBuild *> $logPath
        $exit = $LASTEXITCODE
        $log = [System.IO.File]::ReadAllText($logPath)
        if ($exit -eq 0 -or -not $log.Contains('npm run android:sync')) { throw ($case.name + ': 예상한 release 차단이 없습니다. ' + $logPath) }
        $checks += @{ case=$case.name; blocked=$true }
        Write-Output ($case.name + ': release 차단 확인')
    }
} finally {
    [System.IO.File]::WriteAllBytes($marker, $original)
}
@{dateKst='2026-10-15'; checks=$checks; restored=([Convert]::ToBase64String($original) -eq [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($marker)))} |
    ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $projectRoot 'docs/performance/test-ads-release-guard-20261015.json') -Encoding utf8
