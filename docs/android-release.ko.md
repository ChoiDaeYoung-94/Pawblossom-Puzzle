# Android 빌드와 출시 준비

## 현재 설정과 검증

앱 이름은 Pawblossom Puzzle이며 개발용 applicationId는 `com.choidaeyoung.pawblossompuzzle`입니다. Play 등록 전에 최종 확정합니다. 현재 개발 브랜치의 versionName은 `0.1.5`, versionCode는 `6`입니다. Capacitor 8, minSdk 24, compileSdk/targetSdk 36, Android Gradle Plugin 8.13.0, Gradle 8.14.3, Build Tools 36.0.0을 사용합니다.

### v0.1.5 낙엽·퍼즐 연출 보강 (이슈 #30)

겹별 그림·크기·숫자 2/1과 2→1/✓ 피드백, 낙엽 날림·매치 반짝임·줄 쓸기·확산 원을 추가했습니다. 자동 테스트 78개·웹 테스트/일반 빌드·Capacitor 동기화·테스트 APK·테스트 도구를 제외한 AAB가 성공했습니다. APK v2 서명과 이전 인증서 일치, versionName 0.1.5/code 6, APK 내부 JS·CSS·새 낙엽 SVG와 테스트 dist 일치를 확인했습니다. APK는 `testTools:true`, AAB는 `false`이며 AAB는 unsigned입니다. 기본 production 웹에서는 테스트 선택 UI가 없는 것을 실행 확인했습니다. [연출 검증 기록](mobile-play-feedback.ko.md)을 참고합니다.

테스트 APK는 8,926,608바이트이며 SHA256은 `55fbe0ea8940cf2b1b41f5cdf574def93f8d12bfa5ac5465dad1d3ee14c0c83f`입니다. 기존 앱 위 업데이트와 실기기 가독성·연쇄 중첩·홈 복귀는 새 APK 재시험 대상입니다. 사운드 기본 믹스와 퍼즐 판정·목표·보상은 바꾸지 않았습니다.

### v0.1.4 테스트 선택 기능 (이슈 #28)

개발 서버와 `build:test`에서만 스테이지 제목 옆 **테스트** 버튼을 표시합니다. 1~10스테이지를 잠금과 관계없이 바로 선택하며 시험 완료·실패·재시작·다음 스테이지는 시험 상태를 유지합니다. 시험 결과는 완료 기록·별·코인·잠금 해제를 바꾸지 않습니다. 선택 창에서 **일반 플레이로 돌아가기**를 누르면 저장된 진행 스테이지를 시작하고 정상 보상을 적용합니다. 선택 취소는 보드·이동을 유지하며, 연쇄·결과 대기·튜토리얼 중에는 창을 열지 않습니다. 앱 재실행에는 시험 상태를 저장하지 않습니다.

테스트 APK를 만들 때는 `npm run android:sync:test` 후 `gradlew assembleDebug`를 사용합니다. 기본 `npm run android:sync`는 출시용 웹 에셋을 동기화합니다. `vite.config.ts`가 빌드 시 기능 여부와 `build-info.json`을 생성하며, 테스트 에셋으로 `preReleaseBuild`를 실행하면 실패합니다. 실제 테스트 에셋의 `bundleRelease` 차단과 일반 에셋 재동기화 후 성공을 확인했습니다. CI에서도 두 빌드의 기능 여부를 검사합니다.

자동 테스트 73개 및 실제 Chrome의 360×640·320×568·640×360 선택·취소·재시작·일반 복귀·영어·재실행 저장 유지 검사를 통과했습니다. 기본 production 웹 빌드에는 선택 버튼·대화상자가 없는 것을 별도로 실행 확인했습니다. APK v2 서명은 이전 테스트와 같고 내부 JS·CSS는 테스트 웹 빌드와 일치합니다. APK `testTools:true`, AAB `testTools:false`를 각각 압축 내부에서 확인했으며 AAB는 unsigned입니다.

| v0.1.4 산출물 | 바이트 | SHA-256 |
| --- | --- | --- |
| 테스트 선택 포함 개발용 APK | 8,924,876 | `6a3356e1e1a4cde72122383c5271f78a17481968a202a3bfcaee70c9d47f4d72` |
| 테스트 기능 제외 서명 전 AAB | 7,639,617 | `95b722c8cad270d6f7d6b874cbd008362a21fd93c20c1a4c5873a9a835d4380c` |

![스테이지 바로 선택](screenshots/test-level-picker-ko.png)
![가로 선택 화면](screenshots/test-level-picker-landscape.png)

2026-10-08 이 PC에서 웹 빌드와 Capacitor 동기화, `assembleDebug bundleRelease`가 성공했습니다. APK 서명 검증도 성공했으며 AAB는 `jarsigner -verify`로 unsigned임을 확인했습니다. Android 실기기 설치·실행은 아직 검증하지 않았습니다.

2026-10-11 첫 플레이 안내를 반영한 웹 빌드·Capacitor 동기화와 `assembleDebug bundleRelease` 재빌드가 성공했습니다. 서명 설정은 변경하지 않았으며 실기기 검증은 남아 있습니다([안내 검증 기록](tutorial-qa.ko.md)).

2026-10-13 새 PC에서 SDK와 전체 Temurin JDK 21.0.12.1+1을 구성한 뒤 `clean assembleDebug bundleRelease`가 성공했습니다. APK v2 서명 검증 통과, AAB unsigned 상태를 확인했습니다. 크기·체크섬·경고와 재현 명령은 [새 PC 검증 기록](new-pc-environment.ko.md)에 있습니다. 실기기 설치·실행은 아직 확인하지 않았습니다.

2026-10-14 사용자님의 v0.1.1 재시험을 반영해 음량·특수 제거 범위·아이콘 리소스를 보강했습니다. API별 아이콘 리소스·Manifest 참조와 APK v2 서명을 확인했고 이전 테스트 APK와 인증서가 같습니다. 기존 설치 위에 업데이트한 실제 기기 실행은 사용자님 재시험으로 확인합니다.

2026-10-14 v0.1.3은 마지막 약 1dB 음량 보정·정원 0~5단계·4~10스테이지 낙엽을 포함합니다. 자동 테스트 70개와 웹 빌드·Capacitor 동기화·`assembleDebug bundleRelease`가 성공했습니다. aapt에서 versionCode 4/versionName 0.1.3, apksigner에서 APK v2와 이전 테스트 인증서 일치를 확인했습니다. APK 내부 JS·CSS·낙엽 SVG의 SHA-256은 dist와 같습니다. AAB는 unsigned입니다. Gradle의 flatDir 및 SDK XML 버전 경고는 여전히 출력되지만 빌드 실패는 없었습니다.

| 산출물 | 바이트 | SHA-256 |
| --- | --- | --- |
| 개발용 APK | 8,923,597 | `3d846608bbeb383558d46a933ac7a6ebd22e77e1a0706e5b3be6e985d61834ee` |
| 서명 전 AAB | 7,638,794 | `d1b6232018fcab10e04131bec8589d9fd7d933e8cefe84f3309690d2794c5eb3` |

## 빌드 절차

2026-10-13 새 PC의 이전 Unity SDK 경로가 없어 사용자 동의 후 사용자 폴더에 SDK를 설치했습니다. [새 환경 확인과 Android 설정](new-pc-environment.ko.md)을 참고합니다. 과거 PC의 빌드 기록과 새 PC 검증 결과는 구분합니다.

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
