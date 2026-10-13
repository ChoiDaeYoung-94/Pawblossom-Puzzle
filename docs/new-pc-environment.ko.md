# 새 PC 개발 환경 확인

확인일: 2026-10-13 · [이슈 #10](https://github.com/ChoiDaeYoung-94/Pawblossom-Puzzle/issues/10)

## 경로

실제 프로젝트는 `C:\Users\user\Documents\ChatGPT\match3`입니다. 기존 `C:\Users\pc_17\Documents\ChatGPT`는 새 ChatGPT 폴더를 가리키는 정상 Junction입니다. 호환 연결을 삭제하거나 저장소 전체의 과거 경로를 치환하지 않았습니다. 과거 검증 기록의 절대 경로도 당시 환경을 설명하므로 유지합니다.

## 현재 사용할 수 있는 도구

| 도구 | 확인 결과 |
| --- | --- |
| Node/npm | 공식 Node v24.21.0 Windows x64 ZIP을 사용자 로컬 폴더에 설치, npm 11.19.0 실행 성공 |
| 설치 위치 | `%LOCALAPPDATA%\Pawblossom\tools\node-v24.21.0-win-x64` |
| 다운로드 검증 | nodejs.org 배포의 SHASUMS256.txt와 ZIP의 SHA256 일치 확인 |
| Java/JDK | 전체 Eclipse Temurin JDK 21.0.12.1+1 설치. `%LOCALAPPDATA%\Pawblossom\tools\jdk-21.0.12.1+1` |
| Git | Codex 런타임의 Git 실행, 원격 읽기 성공 |
| GitHub | Chrome 이슈 생성 성공. 기존 자격증명 HTTP 401을 확인한 뒤 Git Credential Manager 브라우저 인증 갱신, 계정 확인과 작업 브랜치 푸시 성공 |
| gh | 현재 PATH에 없음. 이슈·PR은 로그인된 브라우저를 사용할 수 있음 |
| Android SDK/adb | 사용자 동의 후 `%LOCALAPPDATA%\Android\Sdk`에 설치. Command-line Tools 22.0, Android 36 revision 2, Build Tools 36.0.0, Platform Tools 37.0.1 |

Node는 [공식 배포](https://nodejs.org/en/download/archive/v24.21.0)를 사용했습니다. JDK는 [Adoptium 공식 배포](https://adoptium.net/temurin/releases/?version=21&os=windows&arch=x64&package=jdk)의 Windows ZIP을 사용하고 API의 SHA256과 다운로드 파일이 일치하는지 확인했습니다. 시스템 PATH·전역 npm·실행 정책은 변경하지 않았습니다.

처음 확인한 Rider의 Java 21.0.7에는 javac가 있지만 jlink가 없었습니다. 첫 Android 빌드의 JdkImageTransform이 실패하여 전체 JDK로 교체했습니다. 설정 스크립트도 java·javac·jlink·java.base.jmod가 있는지 확인하도록 보강했습니다.

## 새 PowerShell에서 실행

```powershell
Set-Location C:\Users\user\Documents\ChatGPT\match3
. .\scripts\use-dev-tools.ps1
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd run dev
```

스크립트는 사용자 도구 폴더의 Node와 전체 JDK 21 설치를 버전순으로 찾고, 현재 프로세스의 PATH에만 추가합니다. `-NodeHome`·`-JavaHome`으로 다른 설치를 명시할 수도 있습니다. `npm.cmd`를 사용하면 npm.ps1 실행 정책에 의존하지 않습니다. 스크립트를 dot-source할 때 실행 정책이 차단하는 환경에서는 정책을 일괄 완화하지 말고 Node 폴더의 npm.cmd를 절대 경로로 실행하고 해당 셸의 PATH만 지정합니다.

## Android 환경 복구

기존 `android/local.properties`가 가리키던 Unity SDK는 새 PC에 없었습니다. 2026-10-13 사용자님의 명시적인 약관 동의와 설치·빌드 승인 후 [공식 SDK 도구](https://developer.android.com/tools)와 [sdkmanager](https://developer.android.com/tools/sdkmanager)로 다음 구성을 설치했습니다.

- SDK Platform Android 36
- Build Tools 36.0.0
- Platform Tools(adb)
- JDK 21 이상

다운로드한 `commandlinetools-win-15859902_latest.zip`은 공식 SHA256 `90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a`와 일치했습니다. 지정한 세 SDK 패키지만 설치했으며, 다른 PC의 라이선스 파일을 복사하지 않았습니다.

현재 SDK 경로 `C:/Users/user/AppData/Local/Android/Sdk`를 `android/local.properties`에 기록했습니다. 이 파일은 Git에서 제외되는 것을 확인했습니다. 정상 Junction과 시스템 PATH는 유지합니다. 설정 스크립트는 설치·약관 동의를 수행하지 않으며, 이미 설치된 구성요소를 확인해 현재 셸의 경로만 적용합니다.

```powershell
. .\scripts\use-dev-tools.ps1 -AndroidSdk "$env:LOCALAPPDATA\Android\Sdk"
npm.cmd run android:sync
.\android\gradlew.bat -p android clean assembleDebug bundleRelease
```

10월 11일의 기존 APK/AAB 기록과 새 PC 검증 결과를 구분합니다. `clean`으로 이전 PC의 빌드 산출물을 지우고 새 환경에서 생성합니다.

## 새 PC 검증

- `npm.cmd ci`: 잠금 파일 기준 의존성 재설치 성공, audit 0건
- 수정 전 42개, 지갑 라벨 회귀 검사 추가 후 43개 테스트 통과
- TypeScript·Vite 프로덕션 빌드 성공, 기존 Phaser 번들 크기 경고 유지
- 현재 셸 설정 스크립트로 Node/npm과 JDK 경로 출력 확인
- 언어 변경 시 별·코인 보조 라벨 갱신, 지갑 숫자·진행 유지 검사
- 새 PC Chrome에서 첫 실행·건너뛰기 확인, 라벨이 `별/코인`과 `Stars/Coins`로 왕복 갱신되는지 실제 DOM 확인
- SDK 구성요소 버전과 adb 실행 확인, `local.properties` Git 제외 확인
- 전체 JDK 21로 `clean assembleDebug bundleRelease` 성공(279개 태스크, 251개 실행)
- APK Signature Scheme v2 서명 검증 통과, AAB는 `jarsigner -verify`로 unsigned 확인
- jlink가 없는 Rider Java 경로를 설정 스크립트가 사전에 차단하는지 확인

산출물은 `android/app/build/outputs/apk/debug/app-debug.apk`(8,911,783바이트)와 `android/app/build/outputs/bundle/release/app-release.aab`(7,630,588바이트)입니다. package는 `com.choidaeyoung.pawblossompuzzle`, versionName 0.1.0, versionCode 1, targetSdk 36으로 확인했습니다. 빌드 산출물은 Git에 넣지 않습니다.

| 산출물 | SHA256 |
| --- | --- |
| APK | `6264e31158f18fdfcf8f694558fde9dd22599e980b47e1ca9e2305900630e60b` |
| AAB | `8b1381fd0b2f2df4972d92946e8be8151531bd972a72e7df273ea85fae5732e4` |

Phaser 번들 크기·flatDir 경고와 최신 SDK 메타데이터 XML v4를 기존 도구가 v3까지 이해한다는 경고가 남아 있습니다. 이 환경에서는 빌드가 성공했으며, 경고 제거를 위해 이번 작업에서 AGP·Gradle을 추가 업그레이드하지 않았습니다.

광고·결제·실기기·실제 음향·스토어 검증은 이번 환경 복구 결과에 포함되지 않습니다.
