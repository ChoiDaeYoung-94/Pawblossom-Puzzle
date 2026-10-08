# Android 빌드와 출시 준비

## 현재 설정과 검증

앱 이름은 Pawblossom Puzzle이며 개발용 applicationId는 `com.choidaeyoung.pawblossompuzzle`입니다. Play 등록 전에 최종 확정합니다. versionName은 `0.1.0`, versionCode는 `1`입니다. Capacitor 8, minSdk 24, compileSdk/targetSdk 36, Android Gradle Plugin 8.13.0, Gradle 8.14.3, Build Tools 36.0.0을 사용합니다.

2026-10-08 이 PC에서 웹 빌드와 Capacitor 동기화, `assembleDebug bundleRelease`가 성공했습니다. APK 서명 검증도 성공했으며 AAB는 `jarsigner -verify`로 unsigned임을 확인했습니다. Android 실기기 설치·실행은 아직 검증하지 않았습니다.

## 빌드 절차

Node.js 22 이상, Android SDK platform 36 및 Build Tools 36.0.0, JDK 21 이상이 필요합니다. 이 PC에서는 JDK 24.0.2와 기존 Unity 설치에 포함된 SDK를 사용했습니다. Unity로 게임을 개발한다는 의미는 아니며 Android 도구만 사용합니다.

`android/local.properties`를 생성하여 해당 PC의 SDK 위치를 적습니다. 이 파일은 Git에 저장하지 않습니다.

```properties
sdk.dir=C:/path/to/Android/Sdk
```

PowerShell:

```powershell
npm ci
npm run android:sync
$env:JAVA_HOME='C:\path\to\jdk'
Set-Location android
.\gradlew.bat assembleDebug bundleRelease
```

이번 빌드 출력:

- 테스트 APK: `android/app/build/outputs/apk/debug/app-debug.apk`
- 서명 전 AAB: `android/app/build/outputs/bundle/release/app-release.aab`

APK는 개발용 서명입니다. release signingConfig가 없으므로 AAB는 업로드 키로 서명하지 않은 결과입니다. `signReleaseBundle` 태스크명이 출력되어도 업로드용 서명이 준비됐다는 뜻은 아닙니다. 빌드 산출물은 Git에 넣지 않습니다.

## 환경에서 확인한 사항

SDK 기본 Build Tools 35가 없어 처음 빌드가 실패했습니다. 이미 설치된 36.0.0을 앱과 Capacitor 모듈에 동일하게 지정하여 해결했습니다. 설정 근거는 [Android Build Tools 공식 문서](https://developer.android.com/tools/releases/build-tools)입니다.

Program Files 아래 SDK는 메타데이터 쓰기 권한 경고를 내지만 현재 설치된 SDK로 빌드는 성공했습니다. SDK 업데이트 시 Android Studio에서 사용자 경로에 SDK를 구성하는 편이 유지보수에 적합합니다. 프로젝트가 자동으로 SDK 라이선스에 동의하거나 시스템 권한을 바꾸지는 않습니다.

CLI는 8.4.3으로 고정했습니다. 최초 8.5.3 CLI의 전이 개발 의존성 취약점이 npm audit에 표시되어 같은 메이저 버전으로 조정했으며 변경 후 audit은 0건입니다. Android/core는 8.5.3이며 실제 sync·빌드 성공을 확인했습니다.

## 다음 검증

1. 실제 Android에서 첫 실행, 네 방향 스와이프, 다중 터치, 연쇄 중 백그라운드 전환과 복귀를 확인합니다.
2. 실제 스피커로 BGM·효과음의 음량과 음색, 끊김, 음소거 복원을 조정합니다.
3. 테스트 ID 광고와 결제를 연결하고 실패·취소·구매 복원을 확인합니다.
4. 최종 앱 ID, 업로드 키와 키 보관, 서명 AAB, 스토어 소재·개인정보 문서·연령 및 데이터 설문을 준비합니다.
5. Play Console 테스트 요구사항을 해당 계정에서 확인하고 테스트 트랙부터 진행합니다.

현재 광고·결제 SDK는 미설치이며 게임 진행은 기기에 저장합니다. 저장소만으로 스토어 공개나 수익화가 완료되지는 않습니다. [Capacitor Android 공식 문서](https://capacitorjs.com/docs/android)를 환경 설정 기준으로 사용합니다.
