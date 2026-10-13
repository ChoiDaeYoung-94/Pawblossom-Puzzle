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
| Java/JDK | Rider 2025.1.3의 `jbr`, Java 21.0.7, javac 존재 확인 |
| Git | Codex 런타임의 Git 실행, 원격 읽기 성공 |
| GitHub | Chrome 이슈 생성 성공. 기존 자격증명 HTTP 401을 확인한 뒤 Git Credential Manager 브라우저 인증 갱신, 계정 확인과 작업 브랜치 푸시 성공 |
| gh | 현재 PATH에 없음. 이슈·PR은 로그인된 브라우저를 사용할 수 있음 |
| Android SDK/adb | 확인한 기존 Unity 경로와 일반 SDK 경로에 없음. Android 빌드 미재검증 |

Node는 [공식 배포](https://nodejs.org/en/download/archive/v24.21.0)를 사용했습니다. 시스템 PATH·전역 npm·실행 정책은 변경하지 않았습니다. Rider의 JDK는 이번에 확인한 임시 사용 경로이며 IDE를 업데이트하거나 제거하면 다시 확인해야 합니다.

## 새 PowerShell에서 실행

```powershell
Set-Location C:\Users\user\Documents\ChatGPT\match3
. .\scripts\use-dev-tools.ps1 -JavaHome 'C:\Program Files\JetBrains\JetBrains Rider 2025.1.3\jbr'
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd run dev
```

스크립트는 사용자 도구 폴더의 Node ZIP 설치를 버전순으로 찾고, 현재 프로세스의 PATH에만 추가합니다. `-NodeHome`으로 다른 설치를 명시할 수도 있습니다. `npm.cmd`를 사용하면 npm.ps1 실행 정책에 의존하지 않습니다. 스크립트를 dot-source할 때 실행 정책이 차단하는 환경에서는 정책을 일괄 완화하지 말고 Node 폴더의 npm.cmd를 절대 경로로 실행하고 해당 셸의 PATH만 지정합니다.

## Android 재개 조건

기존 `android/local.properties`는 존재하지 않는 이전 Unity SDK를 가리킵니다. 새 SDK가 준비되기 전 임의 경로로 바꾸지 않았습니다. [공식 SDK 도구](https://developer.android.com/tools)와 [sdkmanager](https://developer.android.com/tools/sdkmanager) 기준으로 SDK 경로와 라이선스 상태를 확인한 뒤 다음 구성을 준비해야 합니다.

- SDK Platform Android 36
- Build Tools 36.0.0
- Platform Tools(adb)
- JDK 21 이상

SDK 구성과 약관 확인 후 현재 PC의 실제 경로를 `android/local.properties`에 적습니다. 이 파일은 Git에서 제외됩니다. 스크립트에 `-AndroidSdk <경로>`를 전달하면 위 구성요소 존재를 확인하고 ANDROID_HOME과 현재 PATH만 설정합니다. SDK 설치나 라이선스 동의를 자동 수행하지 않습니다.

공식 다운로드 화면은 Android SDK 약관 동의를 요구합니다. 명령줄 도구와 위 SDK 구성요소 설치에 대한 사용자 확인을 요청했으며, 동의 전 다운로드·라이선스 수락을 진행하지 않습니다.

이후 `npm.cmd run android:sync`와 `android\gradlew.bat -p android assembleDebug bundleRelease`를 실행합니다. 10월 11일의 기존 APK/AAB 성공 기록은 새 PC에서 다시 성공했다는 의미가 아닙니다.

## 새 PC 검증

- `npm.cmd ci`: 잠금 파일 기준 의존성 재설치 성공, audit 0건
- 수정 전 42개, 지갑 라벨 회귀 검사 추가 후 43개 테스트 통과
- TypeScript·Vite 프로덕션 빌드 성공, 기존 Phaser 번들 크기 경고 유지
- 현재 셸 설정 스크립트로 Node/npm과 JDK 경로 출력 확인
- 언어 변경 시 별·코인 보조 라벨 갱신, 지갑 숫자·진행 유지 검사
- 새 PC Chrome에서 첫 실행·건너뛰기 확인, 라벨이 `별/코인`과 `Stars/Coins`로 왕복 갱신되는지 실제 DOM 확인

광고·결제·실기기·실제 음향·SDK 설치·Android 빌드·스토어 검증은 이번 웹 검증 결과에 포함되지 않습니다.
