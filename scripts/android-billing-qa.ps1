param([string]$OutputPath)
# debug 시험 APK와 production release AAB를 각각 빌드한 뒤 실행합니다. 기기 시험은 아닙니다.
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$androidRoot = Join-Path $projectRoot 'android'
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$lock = Get-Content -LiteralPath (Join-Path $projectRoot 'package-lock.json') -Raw | ConvertFrom-Json -AsHashtable
$gradle = Get-Content -LiteralPath (Join-Path $androidRoot 'app/build.gradle') -Raw
if ($gradle -notmatch 'versionCode\s+(\d+)') { throw 'Android versionCode 선언 없음' }
$versionCode = $Matches[1]
if ($gradle -notmatch 'versionName\s+"([^"]+)"') { throw 'Android versionName 선언 없음' }
$versionName = $Matches[1]
if ($package.version -ne $versionName -or $lock.version -ne $versionName -or $lock['packages']['']['version'] -ne $versionName) { throw 'package/lock/Android 버전 선언 불일치' }
$dateKst = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow, 'Korea Standard Time').ToString('yyyy-MM-dd')
if (-not $OutputPath) { $OutputPath = Join-Path $projectRoot ('docs/performance/billing-native-' + $dateKst.Replace('-', '') + '-v' + $versionName + '.json') }
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
if (Test-Path -LiteralPath $OutputPath) { throw ('기존 보고서를 덮어쓰지 않습니다: ' + $OutputPath) }
$aapt = Join-Path $sdk 'build-tools/36.0.0/aapt.exe'
$checks = @()
$dependencyResults = @{}
foreach ($variant in @('debug', 'release')) {
    $log = & (Join-Path $androidRoot 'gradlew.bat') -p $androidRoot --no-daemon --max-workers=2 '-Dorg.gradle.jvmargs=-Xmx1024m -Dfile.encoding=UTF-8' :app:dependencies --configuration ($variant + 'RuntimeClasspath') 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw ($variant + ' 의존성 조회 실패') }
    $billing = $log -match 'com.android.billingclient:billing:.*9\.1\.0'
    if ($billing -ne ($variant -eq 'debug')) { throw ($variant + ' Billing 의존성 분리 실패') }
    if ($variant -eq 'release' -and $log -match 'com.google.android.gms:play-services-ads|com.google.android.ump:') { throw 'release 광고 의존성 잔존' }
    $dependencyResults[$variant] = @{ billing910=$billing; sdkLines=@(($log -split "`n") | Where-Object { $_ -match 'com.android.billingclient:|com.google.android.gms:play-services-ads:|com.google.android.ump:' } | ForEach-Object { $_.Trim() }) }
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$artifacts = @()
foreach ($variant in @('debug', 'release')) {
    $relative = if ($variant -eq 'debug') { 'app/build/outputs/apk/debug/app-debug.apk' } else { 'app/build/outputs/bundle/release/app-release.aab' }
    $artifact = Join-Path $androidRoot $relative
    $archive = [System.IO.Compression.ZipFile]::OpenRead($artifact)
    try {
        $prefix = if ($variant -eq 'debug') { 'assets/' } else { 'base/assets/' }
        $marker = $archive.GetEntry($prefix + 'public/build-info.json')
        $reader = [System.IO.StreamReader]::new($marker.Open())
        try { $info = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
        $expected = $variant -eq 'debug'
        foreach ($flag in @('testTools', 'androidTestAds', 'androidTestBilling')) {
            if ($info.$flag -isnot [bool] -or $info.$flag -ne $expected) { throw ($variant + ' 마커 불일치: ' + $flag) }
        }
        $dexText = ''
        $dexEntries = @($archive.Entries | Where-Object { $_.FullName -match '(^|/)classes\d*\.dex$' })
        foreach ($entry in $dexEntries) {
            $memory = [System.IO.MemoryStream]::new(); $stream = $entry.Open()
            try { $stream.CopyTo($memory); $dexText += [System.Text.Encoding]::Latin1.GetString($memory.ToArray()) } finally { $stream.Dispose(); $memory.Dispose() }
        }
        $sdkFound = $dexText.Contains('Lcom/android/billingclient/api/BillingClient;')
        $bridgeFound = $dexText.Contains('Lcom/choidaeyoung/pawblossompuzzle/TestBillingPlugin;')
        if ($sdkFound -ne $expected -or $bridgeFound -ne $expected) { throw ($variant + ' DEX Billing 분리 실패') }
        $adsSdk = $dexText.Contains('Lcom/google/android/gms/ads/MobileAds;')
        $umpSdk = $dexText.Contains('Lcom/google/android/ump/UserMessagingPlatform;')
        $adsBridge = $dexText.Contains('Lcom/choidaeyoung/pawblossompuzzle/TestAdsPlugin;')
        if ($adsSdk -ne $expected -or $umpSdk -ne $expected -or $adsBridge -ne $expected) { throw ($variant + ' DEX 광고 SDK/브리지 분리 실패') }
        if (-not $expected -and $dexText -match 'BILLING_TEST_PUBLIC_KEY|BILLING_TEST_PRODUCT_ID|BILLING_TEST_PERMANENT_PRODUCT|PawblossomTestBilling|Lcom/google/android/gms/ads/|Lcom/google/android/ump/') { throw 'release DEX에 시험 구성/광고 잔존' }
        $artifacts += @{variant=$variant;bytes=(Get-Item -LiteralPath $artifact).Length;sha256=(Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant();buildInfo=$info;dexCount=$dexEntries.Count;billingSdk=$sdkFound;billingBridge=$bridgeFound;adsSdk=$adsSdk;umpSdk=$umpSdk;adsBridge=$adsBridge}
    } finally { $archive.Dispose() }
}
$debugManifest = & $aapt dump permissions (Join-Path $androidRoot 'app/build/outputs/apk/debug/app-debug.apk') | Out-String
if ($LASTEXITCODE -ne 0 -or -not $debugManifest.Contains('com.android.vending.BILLING')) { throw 'debug BILLING 권한 없음' }
$releaseManifest = [System.IO.File]::ReadAllText((Join-Path $androidRoot 'app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml'))
if ($releaseManifest -match 'com.android.vending.BILLING|billingclient|com.google.android.gms.ads|com.google.android.ump') { throw 'release Manifest에 수익화 잔존' }
$releaseConfig = [System.IO.File]::ReadAllText((Join-Path $androidRoot 'app/build/generated/source/buildConfig/release/com/choidaeyoung/pawblossompuzzle/BuildConfig.java'))
if ($releaseConfig.Contains('BILLING_TEST_')) { throw 'release BuildConfig에 상품/키 필드 잔존' }
$assetMatches = 0
foreach ($file in Get-ChildItem -LiteralPath (Join-Path $projectRoot 'dist') -Recurse -File) {
    $relative = [System.IO.Path]::GetRelativePath((Join-Path $projectRoot 'dist'), $file.FullName)
    $copied = Join-Path $androidRoot ('app/src/main/assets/public/' + $relative)
    if ((Get-FileHash -LiteralPath $file.FullName).Hash -ne (Get-FileHash -LiteralPath $copied).Hash) { throw ('최종 production 에셋 불일치: ' + $relative) }
    $assetMatches++
}
$lint = [System.IO.File]::ReadAllText((Join-Path $androidRoot 'app/build/reports/lint-results-debug.txt'))
if (-not $lint.Contains('0 errors, 15 warnings')) { throw '예상하지 않은 lint 결과' }
$releaseLint = [System.IO.File]::ReadAllText((Join-Path $androidRoot 'app/build/reports/lint-results-release.txt'))
if (-not $releaseLint.Contains('0 errors, 17 warnings')) { throw '예상하지 않은 release lint 결과' }
[xml]$jvm = Get-Content -LiteralPath (Join-Path $androidRoot 'app/build/test-results/testDebugUnitTest/TEST-com.choidaeyoung.pawblossompuzzle.BillingLogicTest.xml')
if ($jvm.testsuite.tests -ne '8' -or $jvm.testsuite.failures -ne '0' -or $jvm.testsuite.errors -ne '0') { throw 'JVM 구매 로직 검사 실패' }
$signature = & (Join-Path $sdk 'build-tools/36.0.0/apksigner.bat') verify --verbose (Join-Path $androidRoot 'app/build/outputs/apk/debug/app-debug.apk') | Out-String
if ($LASTEXITCODE -ne 0 -or -not $signature.Contains('v2): true')) { throw 'debug APK v2 검증 실패' }
$releaseSignature = & jarsigner -verify (Join-Path $androidRoot 'app/build/outputs/bundle/release/app-release.aab') | Out-String
if (-not $releaseSignature.Contains('jar is unsigned')) { throw '예상하지 않은 release AAB 서명 상태' }
$badging = & $aapt dump badging (Join-Path $androidRoot 'app/build/outputs/apk/debug/app-debug.apk') | Out-String
if ($LASTEXITCODE -ne 0 -or -not $badging.Contains("versionCode='$versionCode' versionName='$versionName'")) { throw '시험 APK 버전 불일치' }
$aar = Get-ChildItem -LiteralPath (Join-Path $env:USERPROFILE '.gradle/caches/modules-2/files-2.1/com.android.billingclient/billing/9.1.0') -Recurse -Filter '*.aar' | Select-Object -First 1
$report = @{dateKst=$dateKst;scope='실제 SDK 컴파일/로컬 JVM/정적 산출물 검사. 실제 Play/기기 결제 미검증';billingVersion='9.1.0';billingAarSha256=(Get-FileHash -LiteralPath $aar.FullName).Hash.ToLowerInvariant();dependencies=$dependencyResults;artifacts=$artifacts;debugBillingPermission=$true;releaseManifestAndConfigClean=$true;productionAssetMatches=$assetMatches;lint=@{debug='0 errors, 15 warnings';release='0 errors, 17 warnings';releaseAdditional='변경하지 않은 API 26 아이콘 2개의 MonochromeLauncherIcon 경고'};billingJvmTests=8;debugApkV2=$true;releaseAabSigned=$false;version=($versionName + ' / ' + $versionCode);localProductConfigurationPresent=(Test-Path -LiteralPath (Join-Path $androidRoot 'billing-test.properties'))}
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding utf8
Write-Output ($report | ConvertTo-Json -Depth 8)
