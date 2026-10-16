# Android 빌드와 출시 준비

## 2026-10-16 · debug 보상형 시험 하네스 (이슈 #83)

기준 `662c95aee9c9818c1579bb9d1b4b1bc86b4aec84`, 작업 `codex/rewarded-test-ads`입니다. 기존 GMA **25.4.0** 안의 `RewardedAd`를 debug 전용 `TestAdsPlugin`에 추가했습니다. UMP **4.0.0**, Billing **9.1.0**, AppID·Manifest·release 등록·버전 0.1.7/code 8·상품/콘솔은 그대로입니다. testing + Android debug에서만 수동 형식 선택/로드/표시를 허용하고 기본 꺼짐·동의 보호·billing 차단을 유지합니다.

`RewardLedger`는 현재 plugin 실행의 SDK 콜백 수만 메모리에 기록합니다. 네이티브 `onUserEarnedReward`만 해당 attempt에 1회 기록하고, show/클릭/impression/dismiss/error/JS 명령으로 가산하지 않습니다. 취소/실패/폐기/TTL/파괴/새 attempt 뒤 늦은 응답과 중복 show/earn을 차단합니다. 표시 중 billing/동의 차단이면 기록 권한을 무효화하되 실제 SDK 전면창의 조기 가짜 닫힘은 만들지 않습니다. 게임 지급·저장·별·코인·이동·잠금과 연결하지 않습니다.

공식 [Android Rewarded 안내](https://developers.google.com/admob/android/rewarded)(2026-10-15 갱신, 2026-10-16 확인)의 Legacy Java API와 Google 시험 단위 `ca-app-pub-3940256099942544/5224354917`를 사용합니다. main thread에서 호출하며 **Google 제공 광고의 보상→닫힘 순서만 지원**합니다. mediation 추가/일반 callback 순서 지원, 운영 보상 정책·SSV·서버 검증 완료를 의미하지 않습니다.

`scripts/use-dev-tools.ps1` 환경에서 `gradlew.bat -p android --no-daemon --max-workers=2 :app:compileDebugJavaWithJavac :app:compileReleaseJavaWithJavac --dry-run`으로 의존 작업을 확인한 뒤 동일 명령에서 `--dry-run`만 빼고 컴파일했습니다. 최종 콜백 수정 후 재컴파일 통과입니다. 리소스 처리/compile용 라이브러리 JAR 작업은 포함하며 앱 APK/AAB package/assemble/bundle·Capacitor sync는 실행하지 않았습니다. releaseRuntimeClasspath에 광고/UMP/Billing 시험 SDK가 없고 release javac 클래스에 `TestAdsPlugin`/`RewardLedger`가 없는 것을 확인했습니다. 기존 APK/AAB의 수정 시각은 각각 2026-10-16 14:46/14:48 그대로입니다. dry-run/compile/release 의존성/JVM 원본 로그는 Git 밖 `C:\Users\user\Documents\ChatGPT\Pawblossom-builds\v0.1.7\issue-83-native`에 보존합니다.

순수 Java ledger **5개**, 자동 **369개**, 타입 검사, testing/production 웹 빌드와 브라우저 IPC/주요 회귀 통과입니다. [상세 범위](browser-qa.ko.md#2026-10-16--보상형-시험-광고와-콜백-단발-기록-이슈-83). 실제 SDK/UMP/기기 OS 복귀·운영 보상 정책/서버 검증/SSV·실서비스/스토어는 [#73](https://github.com/ChoiDaeYoung-94/Pawblossom-Puzzle/issues/73) 미완료로 유지합니다. 단말 테스트·APK 전달 보류와 오디오 믹스 변경 금지를 유지합니다.

## 2026-10-16 · 데이터·권한·SDK 기술 현황 (이슈 #81)

**현재 소스의 기술 현황 작성만 완료했으며 개인정보처리방침·데이터 보안 설문·출시 적합성 확정은 미완료**입니다. 기준은 [main `fb199314475e5110628693a286a1230e37acd20e`](https://github.com/ChoiDaeYoung-94/Pawblossom-Puzzle/tree/fb199314475e5110628693a286a1230e37acd20e)입니다. 앱 `0.1.7`/code `8`, 한국·미국 준비와 어린이부터 중장년까지의 기획을 유지합니다. 실제 대상 연령·동의 설계는 아직 확정하지 않았습니다. 아래는 정적 소스 관찰이며, 최신 배포 APK/AAB의 merged manifest·전이 SDK·실제 네트워크/OS 저장 동작을 검증한 결과가 아닙니다. 이번 변경은 이 문서와 출시 체크리스트, [미완료 후속 #73](https://github.com/ChoiDaeYoung-94/Pawblossom-Puzzle/issues/73)의 백업 확인 항목뿐입니다.

### 앱 자체 저장과 초기화

웹/Capacitor WebView에서 `localStorage`를 사용합니다. [저장 스키마와 3키](../src/state.ts), [회차 저장·설정·초기화 호출](../src/main.ts)을 대조했습니다.

| 위치/필드 | 현재 목적과 처리 | 구분·미검증 사항 |
| --- | --- | --- |
| `pawblossom.save.v1` | 정규화한 `SaveData` JSON을 저장·로드합니다. | 앱 자체 저장이며 계정/서버 저장이 아닙니다. 저장소 사용 불가·손상·지원하지 않는 형식은 별도 상태로 보호합니다. |
| `pawblossom.save.v1.backup` | 구조 검증한 복구 사본 1개입니다. 성공 저장 시 primary보다 먼저 쓰며 기존 baseline을 보관하므로 직전 저장일 수 있습니다. primary 부재/손상 시 검증한 사본을 복원합니다. | 동일 localStorage의 앱 내부 사본이며 OS 백업과 다릅니다. 용량/읽기 실패와 미래 형식·충돌은 덮어쓰기를 차단하며 원자적 다중키 저장이 아닙니다. |
| `pawblossom.save.v1.reset` | 확인한 초기화에서 먼저 `'1'` 마커를 기록합니다. 다음 정상 저장으로 기본/새 진행을 primary와 사본에 기록한 뒤 마커를 지웁니다. | 초기화는 전체 `localStorage.clear()`가 아닙니다. 마커 동안 과거 사본을 로드하지 않으며, 과거 바이트/외부 OS 백업의 즉시 완전 삭제를 보장하지 않습니다. SDK 저장소 삭제도 수행하지 않습니다. |
| `version`, `highestLevel`, `completed`, `stars`, `coins`, `garden` | 저장 형식, 스테이지 잠금/완료, 첫 완료 보상과 정원 진행을 유지합니다. | 코인은 현재 게임 내 진행 값입니다. 이 스키마에 결제 수단·구매 토큰·이름·이메일·생년월일·광고 ID 필드는 없습니다. |
| `language`, `music`, `sfx`, `tutorialSeen` | 한국어/영어·BGM/효과음 켜짐·첫 안내 완료를 유지합니다. 초기화 시 기본값(한국어·음향 켜짐·안내 미완료)로 돌아갑니다. | 원격 사용자 프로필/연령 확인 정보가 아닙니다. |
| 선택적 `inProgress` | `schema`, `levelId`, `levelSignature`, `board`, `leaves`, `moves`, `score`, `collected`, `shuffles`, `clearedLeaves`: 일반 플레이의 마지막 안정된 8×8 보드·특수블록/낙엽·목표/이동/점수·섞기 잔여를 검증해 이어갑니다. 완료 시 삭제하며 시험 회차는 저장하지 않습니다. | 손상되거나 현재 스테이지 구성과 맞지 않는 회차는 복원하지 않습니다. 실제 Android 저장소 소진·업데이트/재설치·강제 종료·기기 이동은 #73에서 미검증입니다. |

### 직접 통신·로컬 에셋·권한

검색 범위는 저장소 `src` 전체와 `android/app/src/{main,debug,release}/java`, `capacitor.config.ts`, `index.html`입니다. `fetch`, XHR, WebSocket/EventSource/sendBeacon, CapacitorHttp, HttpURLConnection/OkHttp/Retrofit/Socket 및 공유/외부 열기 호출(`ACTION_SEND`, `ACTION_VIEW`, `FileProvider.getUriForFile`, URI grant flag, `navigator.share`, Share/Browser/openUrl)을 검색해 **직접 호출 일치 없음(rg 종료코드1)**을 확인했습니다. `localStorage` 외 sessionStorage/IndexedDB/cookie/Preferences/SharedPreferences 사용 검색에서도 앱 작성 코드의 영속 저장 구현은 위 SaveStore만 확인했습니다. Firebase/analytics/Crashlytics/PlayFab/Supabase/Sentry 및 URL 검색은 `GardenArt.ts`의 SVG namespace만 일치했습니다. XML namespace·npm registry·Gradle 다운로드 주소는 사용자 데이터 전송 endpoint로 세지 않습니다.

이 검색에는 설치 패키지/SDK 내부·생성 dist·플랫폼/Google Play 서비스·실행 중 호출·전체 전이 의존성 분석이 포함되지 않습니다. **직접 통신 호출 부재를 전체 데이터 수집 없음·완전 오프라인·SDK 통신 없음으로 해석하지 않습니다.** debug의 네이티브 SDK 호출은 아래에 따로 기록합니다.

| 항목 | 소스에서 확인한 사실 | 출시 전 확인 |
| --- | --- | --- |
| 웹 배포/에셋 | [Capacitor 설정](../capacitor.config.ts)은 `webDir: 'dist'`이며 `server.url`이 없습니다. [main](../src/main.ts)은 로컬 Fontsource Nunito/Fraunces와 `/assets/meadow.png`, `/assets/pip.png`를 사용합니다. [BoardScene](../src/BoardScene.ts)·[결과 아트](../src/ResultPip.ts)·[index.html](../index.html)은 로컬 SVG/WebP를 읽습니다. 한국어는 기기 기본 글꼴입니다. | 실제 배포 파일의 포함/원격 요청·캐시/오프라인 동작 확인. 로컬 개발 서버 통신과 Android 배포를 구분합니다. |
| 기본 권한 | [main manifest](../android/app/src/main/AndroidManifest.xml)은 `android.permission.INTERNET`를 선언합니다. 같은 파일에는 위치·연락처·카메라/마이크·광고 ID·BILLING 권한 선언이 없습니다. | 라이브러리 manifest가 병합되는 실제 변형별 최종 권한/컴포넌트를 확인해야 합니다. main 파일만으로 최종 권한 목록을 확정하지 않습니다. |
| FileProvider | main manifest의 provider는 `${applicationId}.fileprovider`, `exported=false`, `grantUriPermissions=true`, `@xml/file_paths`를 선언합니다. [경로 XML](../android/app/src/main/res/xml/file_paths.xml)은 `external-path`와 `cache-path` 각각 `path="."`로 넓은 범위를 지정합니다. 위 앱 작성 코드 검색에서 URI 발급/공유 호출은 발견하지 못했습니다. | 선언만으로 실제 공유가 있었다거나 항상 안전하다고 판정하지 않습니다. 라이브러리 동작·URI 임시 권한 부여·필요 경로 범위 검토가 남습니다. |
| OS 백업 | main manifest의 application은 **`allowBackup=true`**입니다. `android/app/src` XML 검색에서 `fullBackupContent`, `dataExtractionRules`, `backupAgent`는 없었습니다. targetSdk는 [variables.gradle](../android/variables.gradle)의 36입니다. | WebView localStorage 및 SDK 저장 파일의 OS 클라우드 백업/D2D 포함·제외, 제조사/OS/사용자 설정별 복원과 초기화 후 옛 기록 복원 가능성을 확인합니다. 별도 규칙 부재를 백업 보장으로 해석하지 않습니다. |

[Android Auto Backup 공식 안내](https://developer.android.com/identity/data/autobackup)(확인일 2026-10-16)는 OS 클라우드 백업과 기기 간 이동(D2D), 버전별 규칙을 구분합니다. 기본 앱 데이터 백업에는 제외 영역과 실행 조건이 있고 실제 백업이 발생하지 않을 수도 있습니다. target31+의 일부 제조사에서는 `allowBackup=false`조차 D2D를 막지 않을 수 있으므로 단일 플래그로 모든 이동을 통제한다고 가정하지 않습니다. `fullBackupContent`와 `dataExtractionRules`의 적용 OS/target 조건을 검토해야 합니다. 문서의 명시적 allowBackup 설정은 **권고**이며 현재 이미 true를 명시했습니다. 백업 허용/제외 정책 결정과 실제 WebView 저장 포함 여부는 아직 확인하지 않았습니다.

[설정 안내의 KO/EN 문구](../src/i18n.ts)는 앱이 자체 제공하는 클라우드·다른 기기 복원 기능이 없다는 현재 구현 기준입니다. **이 문구와 OS가 수행할 수 있는 백업/기기 이동은 별개**이며, 현재 문구만으로 기기 밖 전송이 전혀 없거나 다른 기기에서 기록이 절대로 돌아오지 않는다고 보장할 수 없습니다. 문구·설정·동작 변경은 이번 범위에 포함하지 않았고, 실제 백업 검증과 제품 방침 결정 후 안내의 정확성을 다시 검토합니다.

### SDK/변형별 경계

| 구분 | 현재 소스/잠금 파일 근거 | 데이터 처리와 한계 |
| --- | --- | --- |
| 공통 런타임 | [package-lock.json](../package-lock.json): Capacitor Android/Core **8.5.3**, App **8.1.2**. Phaser **3.90.0**와 로컬 Fontsource를 사용합니다. App은 [main](../src/main.ts)에서 앱 활동 상태·뒤로가기·최소화를 처리합니다. [capacitor.settings.gradle](../android/capacitor.settings.gradle)·[capacitor.build.gradle](../android/app/capacitor.build.gradle)은 Capacitor Android/App 모듈을 연결합니다. | App 버전은 package.json의 범위 `^8.0.0`과 잠금 파일의 실제 해석 버전을 구분합니다. 이 목록만으로 SDK/AndroidX/플랫폼 내부 전체 데이터 동작을 확정하지 않습니다. |
| debug 광고 | [app/build.gradle](../android/app/build.gradle): **GMA25.4.0·UMP4.0.0은 debugImplementation**. [debug manifest](../android/app/src/debug/AndroidManifest.xml)는 공개 시험 App ID·측정 초기화 지연·MobileAdsInitProvider 및 AD_ID/AdServices 권한 제거 지시를 둡니다. [TestAdsPlugin](../android/app/src/debug/java/com/choidaeyoung/pawblossompuzzle/TestAdsPlugin.java)은 수동 prepare 후 UMP 갱신/필요 양식·canRequestAds 확인·GMA 초기화/시험 광고 요청을 수행합니다. | 일반 게임의 운영/보상 광고가 아닙니다. 수동 시험 경로도 SDK 통신/저장 가능성을 별도 검증해야 하며, 권한 제거·아동 관련 시험 파라미터가 수집 없음이나 국가/연령별 동의 적합성을 보장하지 않습니다. |
| debug 결제 | 같은 Gradle의 **Billing9.1.0은 debugImplementation**입니다. [TestBillingPlugin](../android/app/src/debug/java/com/choidaeyoung/pawblossompuzzle/TestBillingPlugin.java)은 조건을 만족하면 로드/복귀·명시적 복원에서 Play 조회, 상품/구매 처리와 서명·구매 토큰 검증/acknowledge를 수행합니다. [BillingLedger](../android/app/src/debug/java/com/choidaeyoung/pawblossompuzzle/BillingLedger.java)는 토큰·권한·중복/재시도 상태를 메모리에 둡니다. JS snapshot은 상태·권한·가격·오류 등을 전달하며 토큰/서명 필드는 없습니다. | 앱 자체 서버 전송/영속 구매 원장은 발견하지 못했으나 Play/SDK의 보관·통신과 다릅니다. 현재 `android/billing-test.properties`는 없으며 실상품/키/가격 설정·실구매/환불 검증은 미완료입니다. 토큰 값·키·개인 계정은 기록하지 않습니다. |
| release | [release 광고 등록](../android/app/src/release/java/com/choidaeyoung/pawblossompuzzle/TestAdsRegistration.java)·[결제 등록](../android/app/src/release/java/com/choidaeyoung/pawblossompuzzle/TestBillingRegistration.java)은 no-op입니다. [vite.config.ts](../vite.config.ts)는 production에서 시험3flags=false, testing에서 true로 만들며 Gradle preReleaseBuild는 시험/누락/손상 마커를 차단합니다. GMA/UMP/Billing은 release 의존성으로 선언하지 않았습니다. | 현재 release의 운영 광고/결제 서비스는 미구현입니다. 이전 v0.1.7 산출물의 SDK/브리지/권한 제외 근거는 아래 과거 검사에 보존하며 이번 소스 조사와 최신 배포 검증을 합치지 않습니다. 최종 서명 배포의 merged manifest·RuntimeClasspath/DEX·웹 flags·전이 SDK·트래픽을 다시 확인해야 합니다. |

Gradle의 Google services 플러그인 classpath/조건부 적용 코드도 확인했습니다. 현재 `android/app/google-services.json`·`android/google-services.json`은 없고 앱 작성 소스에서 Firebase 분석/푸시 연결은 발견하지 못했습니다. 빌드 도구 선언을 활성 운영 SDK로 세거나 반대로 미래 설정에서도 항상 제외된다고 단정하지 않습니다. UMP/Play 등 **SDK 내부 영속 저장·보유 기간·전송 대상/항목은 이번 정적 검색으로 확인하지 않았습니다.**

### 공식 기준과 출시 전 결정/검증

확인일 2026-10-16: [Google Play 데이터 보안 안내](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en-GB)를 읽었습니다(`hl=en`은 총괄 조사에서500이었고 같은 문서의 en-GB 본문 확인). **필수**: 공개/비공개 테스트·production 등 해당 Play 앱은 데이터 보안 양식이 필요하고, 수집이 없더라도 양식과 개인정보처리방침 링크가 필요합니다. 내부 테스트 트랙에만 있는 앱은 안내상 예외입니다. 앱에 포함한 SDK·관리하는 WebView의 처리도 검토해야 하며 기기 밖으로 보내지 않고 순수 로컬 처리하는 데이터는 수집 신고 범위와 구분합니다. **권고**: 제출 전 앱 권한/API와 SDK 제공자의 데이터 처리 자료를 검토합니다. 이 원칙을 최종 설문의 수집/공유 없음 답변으로 대신하지 않습니다.

- 실제 배포 변형·모든 활성 트랙·merged manifest/권한·SDK 전이/버전·네트워크 트래픽과 SDK의 저장/보유/전송/삭제를 확인하고 데이터 항목·목적·공유·암호화·선택/필수·삭제 답변을 결정합니다.
- OS 클라우드 백업/D2D 방침, 규칙 필요성, 실제 WebView/SDK 파일 포함과 복원·초기화 후 거동을 #73에서 확인합니다. 현재 true를 유지하며 허용/제외 결정을 대신하지 않습니다.
- 공개 운영 주체·지원 연락처/개인정보처리방침 URL·보유/삭제 절차, 실제 대상 연령·한국/미국 동의와 필요한 보호자 절차를 확정해야 합니다. 연락처/URL·생년월일 수집·연령 게이트·정책 본문을 임의로 만들지 않았습니다.
- 운영 광고/결제 도입 여부·상품/가격/국가·서버 검증/권한 복원·환불/취소 운영을 먼저 결정하고 해당 SDK·스토어 고지를 검증해야 합니다. 현재 debug 시험 구현을 운영 서비스 완료로 표시하지 않습니다.

검증은 기준 소스·심벌/설정/잠금 파일과 문장 수작업 대조, 문서 링크/앵커와 `git diff --check`입니다. 앱/에셋/Android/SDK/config/package/CI/dist/version/audio는 변경하지 않아349개/JVM/게임 브라우저 검사를 반복하지 않습니다. 최신 PR/main Node22·24 CI 결과는 PR에 별도 기록합니다. 단말 테스트·APK 전달 및 새 APK/AAB·Android 동기화·콘솔/Drive 작업은 계속 보류합니다.

## 2026-10-16 · 스토어 아이콘과 소재 자동 검사 (이슈 #79)

`assets/store/play-icon-v1.png`에 **512×512, 32-bit RGBA PNG, sRGB, 불투명 배경, 12,527바이트** 초안을 보존했습니다. SHA256은 `21b8cd48bb2872f0dd5fb47d9f1052485d467fd6764f7fe37a7255968edd584c`입니다. 기존 자체 발바닥·꽃 원본을 확장했고 Android/브랜드 원본을 보존했습니다. [원본·정확한 내보내기·해시·검증](assets.ko.md#2026-10-16--google-play-스토어-아이콘과-소재-검증-이슈-79)을 기록했으며 **총괄 초안 시각 검수 완료(최종 사용자/출시 소재 승인 별도)**입니다. 별도 검수 SVG에서 32/48px 식별과 30% 모서리 마스크의 심벌 잘림 없음을 확인했습니다.

`npm run store:check`·`npm run store:test`로 아이콘·피처 그래픽의 PNG 구조/해독/CRC·공식 파일 규격·참조 해시와 실패 경계12개를 검사하고 Node22·24 CI에 연결했습니다. 기존349개·타입/launcher 검사도 로컬 통과했으며 최신 PR/main 빌드 CI 결과는 PR에 기록합니다. 최종 상업권리/사용자 소재 확정·실기기 스크린샷·콘솔 업로드/노출 검증은 [#73](https://github.com/ChoiDaeYoung-94/Pawblossom-Puzzle/issues/73)에서 계속 미완료입니다. APK/AAB·Android 동기화·앱 버전·오디오·운영 서비스 변경과 단말 테스트/전달은 계속 보류합니다.

## 2026-10-16 · 피처 그래픽 초안 (이슈 #77)

`assets/store/play-feature-v1.png`에 **1024×500, 24-bit RGB PNG(no alpha), 1,313,700바이트**의 소개 삽화 초안을 보존했습니다. SHA256은 `aaeeab330e36941dd89cc0a6b232ab4503cd218f52f8ddaa5477af593c19b4f4`입니다. [원본·참조·전체 프롬프트·공식 규격/권고 구분·검증](assets.ko.md#2026-10-16--google-play-피처-그래픽-초안-이슈-77)을 기록했으며 총괄 초안 시각 검수 완료(최종 사용자/출시 소재 승인 별도)입니다. 한국·미국 공용 게임 제목과 KO/EN alt 초안을 준비한 단계입니다.

**최종 소재 승인·실제 기기 스크린샷·스토어 아이콘 최종 검수·Play Console 등록/노출 형식별 잘림·overlay 검증은 미완료**입니다. 실제 게임 캡처가 아닌 자체 핍/초원 참조의 마케팅 삽화입니다. 이번 작업에는 APK/AAB·Android 동기화·버전/패키지·Drive/콘솔·운영 광고/결제·오디오 변경이 없습니다. 단말 테스트·APK 전달 보류와 [후속 #73](https://github.com/ChoiDaeYoung-94/Pawblossom-Puzzle/issues/73)을 유지합니다.

## 현재 설정과 검증

앱 이름은 Pawblossom Puzzle이며 개발용 applicationId는 `com.choidaeyoung.pawblossompuzzle`입니다. Play 등록 전에 최종 확정합니다. 현재 main의 versionName은 `0.1.7`, versionCode는 `8`입니다. Capacitor 8, minSdk 24, compileSdk/targetSdk 36, Android Gradle Plugin 8.13.0, Gradle 8.14.3, Build Tools 36.0.0을 사용합니다.

## 2026-10-16 · 한영 스토어 소개 초안 (이슈 #75)

원본은 [store-listing-drafts.json](store-listing-drafts.json)입니다. `locales`의 `ko-KR`·`en-US`에 제목·짧은 소개·전체 소개만 두고, 초안 상태·기준 커밋·공식 출처·기능 근거·출시 전 미확정 사항은 별도 `metadata`에 기록했습니다. 게임 기본 언어는 `gameDefaultLocale: "ko-KR"`이고 영어를 지원합니다. 스토어 기본 언어는 아직 선택하지 않아 `storeDefaultLocale: null`로 구분합니다. 기준 `c3be5c24e5fa736a3a78db732fd8bd7c3989ca38`의 실제 보드·목표·첫 완료 보상·정원·핍·언어/음소거 구현과 에셋/오디오 기록을 대조했습니다. 여러 친구·지역이나 확정 출시 스테이지 수, 클라우드·멀티플레이·매일 보상·상점·무제한·광고 없음·작동하는 광고 제거 구매·오프라인 검증 완료·최종 대상 연령은 소개에 약속하지 않습니다.

확인일은 **2026-10-16**입니다. [앱 설정·소개 한도](https://support.google.com/googleplay/android-developer/answer/9859152?hl=en), [메타데이터 정책](https://support.google.com/googleplay/android-developer/answer/9898842?hl=en), [소개 작성 권장사항](https://support.google.com/googleplay/android-developer/answer/13393723?hl=en-GB)을 확인했습니다. 마지막 문서의 `hl=en`은 429 응답이어서 같은 문서의 `en-GB` 본문을 읽었습니다. 정확한 기능 설명·번역 일관성·오해 유발 메타데이터 금지를 기준으로 작성했으며 정책 전반의 출시 적합성 판정은 아닙니다.

| 언어 | 제목 (최대 30자) | 짧은 소개 (최대 80자) | 전체 소개 (최대 4,000자) |
| --- | ---: | ---: | ---: |
| ko-KR | 17 | 36 | 467 |
| en-US | 17 | 70 | 984 |

문자 수는 JSON을 해석한 문자열의 공백·문장부호·LF 줄바꿈을 포함한 Unicode 코드 포인트 수이며 현재 BMP 문자만 있어 JavaScript `length`와 같습니다. JSON 파싱·중복 키·locale 누락/중복·필드·문자 수/한도·기능 일치·문서 링크와 `git diff --check`를 확인했습니다. 제품 코드가 바뀌지 않아 기존 브라우저·Android 검사는 반복하지 않습니다. PR 최신 head의 Node 22·24 CI와 병합 후 main CI는 별도 확인 대상이며 결과는 해당 PR에 남깁니다.

**초안 작성만 완료**했습니다. 첫 공개 콘텐츠·아트·두 언어 최종 문구, 지원 이메일/공개 연락처·개인정보처리방침 URL, 실제 대상 연령·콘텐츠 등급·동의/데이터 보안 설문, 가격·상품·운영 광고/결제와 필요한 표시, 언어별 스크린샷·피처 그래픽·스토어 아이콘, 최종 앱 ID·스토어 기본 언어 선택(게임의 한국어 기본과 별도)·국가/카테고리/태그·계정별 테스트 조건과 콘솔 등록은 확정·검증 전입니다. 개인 계정·연락처·URL·가격·상품을 추정하거나 등록하지 않았습니다. 스토어 제출·심사 통과·출시 완료가 아니며 [보류 검증 #73](https://github.com/ChoiDaeYoung-94/Pawblossom-Puzzle/issues/73)을 유지합니다. 단말 테스트·APK 전달은 보류하며 새 APK/AAB·Android 동기화·버전·음량·계정/서비스·Drive/콘솔 변경은 없습니다.

## 2026-10-16 · v0.1.7 누적 테스트 빌드 (이슈 #66)

v0.1.6 이후의 30스테이지, 안정된 회차 저장·손상 복구, 키보드·터치 취소·가독성, 핍 전용 결과 아트와 오디오 복구를 묶었습니다. 기준 `850c1f6c066e432ac24cb2d6180d954856ba7dc1`에서 버전/검증 도구를 준비한 **`c6b157826ba9e7fed79d1f748ef606131f2b0e1b`**의 앱 코드·리소스로 빌드했습니다. 이후 수정은 검증 스크립트의 package-lock 빈 이름 키 파싱·정상 차단 후 성공 종료코드와 기술 기록이며 APK 앱 소스를 바꾸지 않습니다. package.json·lock 루트/패키지 버전과 Android 0.1.7/code 8을 대조했습니다.

실제 경로 `C:\Users\user\Documents\ChatGPT\match3`에서 `scripts/use-dev-tools.ps1`을 dot-source하여 Node **24.21.0**, Temurin JDK **21.0.12.1**, 기존 SDK 36으로 실행했습니다. 순서는 `npm test` → `npm run android:sync:test` → `assembleDebug testDebugUnitTest lintDebug` → 버전명 APK 사본 보존 → `npm run android:sync` → `bundleRelease lintRelease compileReleaseJavaWithJavac` → release guard 10종 및 원본 production 마커 복구 → 네이티브·전수 에셋 검사입니다. Gradle에는 `--no-daemon --max-workers=2 -Dorg.gradle.jvmargs="-Xmx1024m -Dfile.encoding=UTF-8"`를 사용했습니다.

| 산출물 | 바이트 | SHA-256 |
| --- | ---: | --- |
| `Pawblossom-Puzzle-v0.1.7-2026-10-16-c6b1578-debug.apk` | 14,044,758 | `3c4952f544ce7391b6ae8427106a90c67d022eaa06fd9ab199617d792dea7220` |
| `Pawblossom-Puzzle-v0.1.7-2026-10-16-c6b1578-release-unsigned.aab` | 7,717,275 | `ec4ccafbbcc9f4895948cc52d53d4083a2f02c24d9e0a0e558d2cf4b9b367210` |

두 사본과 `SHA256SUMS-v0.1.7.txt`는 **Git 밖 `C:\Users\user\Documents\ChatGPT\Pawblossom-builds\v0.1.7`**에 보존했습니다. 체크섬 파일 자체의 SHA-256은 `2af9ce5d61d01c7dd7e40295c19cfb9df5abf68e99a2f60f1b892cbb8f0cdd48`입니다. 원본 Android 출력과 testing/production dist 사본·빌드 로그·브라우저 원본 결과도 보존합니다. AAB는 검증용 unsigned이며 Drive 업로드 대상이 아닙니다. APK·키·AAB는 Git에 넣지 않습니다. 총괄 읽기검토 후 기존 Drive 폴더에 APK·체크섬 두 파일의 업로드 완료를 확인했고, 재다운로드한 APK 크기·해시가 원본과 같습니다. [기존 전달 기록](remote-device-test.ko.md)에 근거와 검증 범위를 기록합니다.

- 자동 **284개**, Billing JVM **8개** 성공. debug lint **0 errors/15 warnings**, release **0 errors/17 warnings**이며 release 추가 2개는 기존 API 26 아이콘 MonochromeLauncherIcon 경고입니다. 기존 Phaser 500KB 번들·Gradle flatDir/폐기 예정 API 경고는 남아 있습니다.
- aapt에서 applicationId 유지, versionName **0.1.7/code 8**, minSdk **24**/targetSdk **36**을 확인했습니다. apksigner **v2** 통과. 총괄이 실제 Drive에서 내려받은 전달 v0.1.6 APK는 8,928,012바이트·SHA-256 `1fe585a3635dcf428a0f74e034806b269023b6c1898755f5f3c2be431095d818`로 과거 기록과 일치합니다. 두 APK 인증서 SHA-256은 **`3db1481f54ab024e442493713f4d5dd400b985e4c2a41852b4b389a6e2df47b3`**로 같습니다. 기존 기본 debug signing을 유지했고 새 키 생성/서명 변경은 없습니다. 실제 단말의 업데이트 성공까지 검증한 결과는 아닙니다.
- debug 8개 DEX에서 **GMA 25.4.0·UMP 4.0.0·Billing 9.1.0 SDK와 두 브리지**, BILLING 권한 및 세 시험 flags true를 확인했습니다. release RuntimeClasspath/1개 DEX/Manifest/BuildConfig에는 수익화 SDK·시험 브리지·BILLING/광고 항목·상품/키 필드가 없습니다. release AAB의 세 flags는 false이며 `jarsigner -verify`는 **unsigned**입니다. [네이티브 검사](performance/billing-native-20261016-v0.1.7.json).
- 시험 true·누락·손상·필드 누락·문자열·숫자 등 **10종**은 `preReleaseBuild`를 모두 차단했습니다. finally에서 원본 마커를 바이트 단위로 복구했습니다. [차단/복구](performance/billing-release-guard-20261016-v0.1.7.json). 검증 스크립트도 전체 차단 확인과 보고서 저장 뒤에는 성공을 반환하도록 정리하여, 마지막 Gradle의 의도된 실패 종료코드를 잘못 전파하지 않습니다.
- APK↔testing dist와 AAB↔production dist 각각 **29개 웹 파일**(JS/CSS·모든 그림/폰트·핍 WebP·build-info 포함)의 경로·크기·SHA-256 전수 일치. Capacitor 추가 파일 `cordova.js`, `cordova_plugins.js`는 두 산출물 모두 0바이트이며 예상 밖 웹 파일이 없습니다. 마지막 dist/Android public도 production 29개와 같고 세 flags 모두 false입니다. [파일별 해시·이전 인증서 비교](performance/batched-artifacts-20261016-v0.1.7.json).
- 두 PowerShell QA 스크립트는 현재 버전·한국 날짜를 읽고 `-OutputPath`를 받으며 기존 보고서 경로를 덮어쓰지 않습니다. 과거 20261015 JSON을 보존했습니다. [브라우저 재검사](browser-qa.ko.md)의 원본도 새 외부 폴더로 분리했습니다.

`android/billing-test.properties`는 계속 없으며 실제 상품 ID·키·가격·실구매 설정을 만들지 않았습니다. debug에는 명시적 요청의 수동 시험 광고만 있고 운영 광고·게임 보상 광고는 없습니다. 실제 Android 설치·저장소 소진·강제 종료·오디오 포커스/전화/Bluetooth·UMP/GMA 실행·Play 구매/복원·스토어 검증은 미완료입니다. 콘솔 변경·구매·앱 삭제/재설치는 수행하지 않았습니다. 이번 결과는 출시 완료나 대상 연령/국가별 운영 적합성 검증이 아닙니다.

## 광고·광고 제거 결제 도입 판단 (이슈 #51)

2026-10-15 공식 자료와 배포 태그를 조사했습니다. 사용자님이 **첫 출시 준비 국가를 한국·미국**으로 선택했고, 어린이부터 중장년까지의 기획은 유지합니다. 아래 #51 판단 당시에는 광고·결제 SDK나 작동하는 상품 UI가 없었습니다. 후속 #54에서 추가한 debug 전용 시험 광고와 미검증 범위는 아래 별도 구현 기록을 기준으로 합니다.

### 광고와 연령·동의

어린이·연령 불명 이용자에게는 Families에 맞는 SDK·비맞춤형 광고·형식 제한을 함께 적용해야 합니다. mixed audience 운영에는 중립 연령 확인이 필요합니다. 실제 앱·그림·표현과 맞는 연령대를 선언하고, 광고 편의를 위해 성인 전용으로 바꾸지 않습니다. 게임을 방해하는 광고는 선택형·보상형도 5초 후 닫을 수 있어야 하며 앱 시작 직후 전면 광고·시청/구매를 압박하는 표현을 피합니다. 승인 SDK 목록은 래퍼나 앱 전체의 승인을 의미하지 않습니다. [Families 정책](https://support.google.com/googleplay/android-developer/answer/9893335?hl=en), [대상 연령·중립 연령 화면](https://support.google.com/googleplay/android-developer/answer/9867159?hl=en), [SDK 목록](https://support.google.com/googleplay/android-developer/answer/12955712?hl=en).

다음 개발 단계는 **전체 요청에 아동 보호 설정을 적용한 Android 테스트 광고 한 형식**입니다. Google 테스트 ID만 사용하고 중개 네트워크를 추가하지 않습니다. 이는 시험 전략이며 운영 연령 확인이나 부모 동의의 면제 근거가 아닙니다. SDK 자동 초기화와 요청 전 보호 신호 적용, 병합 Manifest의 식별자 권한·실제 수집도 확인합니다. 설정·연령·동의·구매 상태가 불명확하면 자동 광고를 보류합니다.

#54에서 공식 문서와 실제 GMA 25.4.0 API를 대조해 정정했습니다. **광고 요청의 TFCD와 TFUA를 동시에 true로 설정하지 않습니다.** 둘 다 true이면 TFCD가 우선하며 두 API는 deprecated입니다. 실제 구현은 초기화 전에 `setAgeRestrictedTreatment(AgeRestrictedTreatment.CHILD)`와 최대 등급 `G`를 설정합니다. 별도로 UMP에는 `ConsentRequestParameters.setTagForUnderAgeOfConsent(true)`를 적용합니다. 이는 모든 시험 요청을 아동 보호 수준으로 다루는 설정이며 실제 이용자의 연령 판정이 아닙니다. [AdMob 요청 설정·상호작용](https://developers.google.com/admob/android/targeting), [GMA 변경 이력](https://developers.google.com/admob/android/rel-notes), [UMP 미성년 처리](https://developers.google.com/admob/android/privacy/gdpr).

UMP는 앱 시작마다 정보를 갱신하고 필요한 양식을 표시한 뒤 `canRequestAds`를 확인합니다. 필요할 때 개인정보 선택 변경 진입점을 제공합니다. 요청 허용을 두 경로에서 확인해도 초기화·광고 요청은 중복 실행하지 않습니다. 앱 자체의 저장된 동의 값이나 `npa`만으로 이 흐름을 대체하지 않습니다. [UMP 구현](https://developers.google.com/admob/android/privacy).

| 국가 | 설계에 반영할 조건 |
| --- | --- |
| 한국 | 만 14세 미만의 개인정보 처리에 법상 동의가 필요한 경우 법정대리인 동의와 확인이 필요합니다. UMP나 아동의 확인 버튼이 이를 대신하지 않습니다. [개인정보 보호법 제22조의2](https://law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1020398523) |
| 미국 | COPPA 적용 대상 서비스의 만 13세 미만 개인정보 수집·이용·제공과 부모 동의 조건을 검토합니다. 타깃 광고 등 비필수 제3자 제공의 별도 검증 가능한 부모 동의 요구를 포함합니다. 개정 규칙의 일반 준수기한은 2026-04-22입니다. [FTC 설명](https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-finalizes-changes-childrens-privacy-rule-limiting-companies-ability-monetize-kids-data), [공포문·적용일](https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule) |

국가별 아동 기준 이상을 곧바로 성인으로 분류하지 않습니다. 중립 연령 입력은 기본값·거짓 응답 유도를 피하고, 생년월일 원본은 저장·전송하지 않는 방향으로 설계합니다. 문맥 광고·내부 운영 예외도 데이터와 목적에 따른 조건이 있어 비개인화 설정만으로 부모 동의 불필요라고 판단하지 않습니다. 필요한 동의가 준비되지 않은 데이터 처리는 차단합니다. [FTC COPPA FAQ](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions). 이는 한국·미국의 모든 법률·주별 의무나 출시 적합성 판정을 마친 결과가 아닙니다.

### SDK 후보와 도입 순서

| 후보 | 2026-10-15 확인 내용 | 다음 검증 |
| --- | --- | --- |
| `@capacitor-community/admob@8.2.1` | MIT, Capacitor 8.5 이상 안내. 태그 Gradle 기본 GMA `25.4.+`·UMP `4.0.0` | 첫 광고 시험의 우선 후보. 동적 GMA 버전을 재현 가능한 실제 버전으로 고정하고 보호 설정·동의·형식·복귀를 확인 |
| `capacitor-plugin-cdv-purchase@13.19.1` | MIT, Capacitor 6·7·8 지원 선언. 태그의 Capacitor Gradle은 Billing `9.0.0` | 무료 결제 우선 검증 후보. README의 Billing 8.3 표기와 달라 태그 의존성을 기준으로 실제 빌드·복원 확인 |

근거: [AdMob 릴리스](https://github.com/capacitor-community/admob/releases/tag/v8.2.1), [광고 Gradle](https://github.com/capacitor-community/admob/blob/v8.2.1/android/build.gradle), [결제 릴리스](https://github.com/j3k0/cordova-plugin-purchase/releases/tag/v13.19.1), [Capacitor 지원](https://github.com/j3k0/cordova-plugin-purchase/blob/v13.19.1/capacitor/package.json), [Billing Gradle](https://github.com/j3k0/cordova-plugin-purchase/blob/v13.19.1/capacitor/android/build.gradle). 호환성 선언은 이 프로젝트의 실제 빌드·실기기 검증과 다릅니다. 래퍼 MIT 라이선스는 Google SDK·서비스 약관을 대체하지 않습니다.

현재 core/android 8.5.3과 CLI 8.4.3의 버전 차이는 기존 취약점 대응 기록이 있으므로, 설치 전에 버전 정렬·잠금 파일·audit·Android 빌드를 함께 검토합니다. 서버 운영을 줄이는 RevenueCat은 별도 계정·서비스 비용 조건이 있고, Capawesome Purchases는 유료 Insiders 경로입니다. 지금 유료 서비스를 선택하거나 가입하지 않습니다. [RevenueCat SDK](https://github.com/RevenueCat/purchases-capacitor), [서비스 요금](https://www.revenuecat.com/pricing), [Capawesome](https://capawesome.io/docs/sdks/capacitor/purchases/).

래퍼가 필요한 기능을 제공하지 않으면 광고 제거 한 상품의 `queryProductDetails`·구매·현재 구매 조회·승인·구매 이벤트만 노출하는 Android JVM Kotlin/Java 브리지를 비교합니다. Kotlin/Native나 범용 수익화 계층을 선행 도입하지 않습니다. [Capacitor 네이티브 코드](https://capacitorjs.com/docs/android/custom-code).

### 광고 제거 한 상품의 구매 상태

광고 제거는 **비소모성 일회성 상품**이며 지급 후 consume하지 않습니다. 시작·연결 복구·복귀·명시적 복원에서 현재 INAPP 구매를 조회하고 검증합니다. 결제창 성공·닫힘·`PENDING`만으로 지급하지 않고 검증된 `PURCHASED`에서 권한을 반영합니다. 구매 토큰의 중복 처리는 같은 결과가 되도록 하되, 이미 승인된 구매도 새 기기에서는 권한을 복원합니다. 지급 후 acknowledge하며 `PENDING→PURCHASED` 후 3일 이내 처리 조건을 지킵니다. [Google Billing 구현](https://developer.android.com/google/play/billing/integrate), [결제 정책](https://support.google.com/googleplay/android-developer/answer/9858738?hl=en).

Google은 클라이언트 승인 경로도 제공하므로 모든 일회성 상품에 서버가 일률적 필수인 것은 아닙니다. 구매 검증·토큰 관리·미실행 중 승인에는 보안 백엔드가 권장됩니다. 앱이 꺼진 동안 환불·취소 알림을 처리하려면 RTDN/Developer API 등을 다룰 서버 또는 관리형 서비스가 필요합니다. 오프라인에서 최신 환불을 즉시 확인할 수는 없으므로 이전 검증 권한의 유지 범위와 재연결 갱신을 명시합니다. 단순 localStorage의 `removeAds:true`는 검증이 아니며 Play API 비밀정보를 앱/Git에 넣지 않습니다. [보안](https://developer.android.com/google/play/billing/security), [일회성 구매 수명](https://developer.android.com/google/play/billing/lifecycle/one-time), [Voided Purchases](https://developers.google.com/android-publisher/voided-purchases).

### 다음 구현과 남은 계정·기기 확인

1. 별도 이슈에서 광고 기본 off·Android 시험 빌드 한정·Google 테스트 ID 한 형식을 연결합니다. 운영 ID·디버그 지역 강제·미확정 설정 조합을 차단하고 네이티브 초기화 시점도 점검합니다.
2. 기존 `syncActivity`와 광고 표시 상태를 결합하여 보드·오디오를 멈추고, 실패·닫힘·홈 복귀·중복 콜백을 검증합니다. 보상형을 채택하면 실제 보상 콜백 한 경로에서만 한 번 지급하며 닫힘·표시 성공에는 지급하지 않습니다. [Google 보상 콜백](https://developers.google.com/admob/android/rewarded).
3. 광고 제거 한 상품의 가격 조회·구매·pending·실패·취소·승인·복원을 연결하고, 제거 대상 광고와 보상형 예외를 실제 안내에 일치시킵니다. 웹에서 가짜 구매 성공이나 가짜 광고 시청 UI를 제공하지 않습니다.
4. 자동 검사는 설정 누락 차단·실패 무보상·중복 한 번 지급·pending 미지급을 다룹니다. 이후 서명한 테스트 트랙에서 광고 형식·부모/개인정보 동의 적용 조건·구매/복원·환불·오프라인을 실기기로 확인합니다.

후속 콘솔 작업에는 최종 package ID, 실제 대상 연령대, KO/EN 상품명·설명, 변경/재사용할 수 없는 상품 ID, 가격·판매 국가·테스터, 광고 App ID(`~`)·단위 ID(`/`), 메시지·지원 연락처·개인정보처리방침·app-ads.txt가 필요합니다. 지금 계정 자격정보를 요청하거나 콘솔을 변경하지 않았습니다. [상품 등록](https://support.google.com/googleplay/android-developer/answer/1153481?hl=en), [Billing 테스트](https://developer.android.com/google/play/billing/test), [AdMob 앱 준비](https://support.google.com/admob/answer/9989980?hl=en), [app-ads.txt 검증](https://support.google.com/admob/answer/14538460?hl=en).

## 광고 제거 결제·복원 시험 연결 (이슈 #56)

### 구현한 범위와 미설정 조건

2026-10-15 [통합 문서](https://developer.android.com/google/play/billing/integrate)와 [릴리스 노트](https://developer.android.com/google/play/billing/release-notes)를 확인하고 **Billing 9.1.0**을 `debugImplementation`에 strictly 고정했습니다. 실제 AAR로 Java API를 컴파일하며, 자체 Capacitor Java 브리지는 한 비소모성 상품의 상품 조회·구매창·현재 INAPP 구매 조회·acknowledge만 연결합니다. consume·구독·다중 스토어·범용 provider는 없습니다. SDK·상품 구성 필드·브리지는 `src/debug`에만 있고 release에는 빈 등록 함수만 있습니다.

**실제 상품 ID·가격·라이선스 공개키·테스트 트랙·계정은 미설정이며 실제 Play 구매·복원은 미검증입니다.** 콘솔 변경·가입·구매 실행을 하지 않았습니다. 가짜 상품/가격/샘플 키/성공 응답을 앱에 넣지 않았습니다. 화면은 실제 Android testing 빌드에서만 “광고 제거 연동 시험 / 아직 운영 서비스가 아님”을 KO/EN으로 안내합니다. 실제 웹·production에는 시험 구매 진입/요청이 없습니다. 버전 0.1.6/code 7을 유지하며 이번에는 APK를 전달하지 않습니다.

추후 담당자가 Git 제외 `android/billing-test.properties`에 입력할 키 이름은 아래와 같습니다. 이 빈 예시로는 SDK 연결·상품 조회·구매·권한 지급을 허용하지 않습니다.

```properties
productId=
publicKey=
permanentProductConfirmed=false
```

`publicKey`는 해당 Play 앱의 완전한 Base64 X.509 RSA 공개키이며 비밀키가 아닙니다. 2048비트 이상 RSA·완전한 Base64·상품 ID 형식을 확인하고 손상/부분 구성은 차단합니다. Play Developer API 비밀정보는 앱·Git에 넣지 않습니다. `permanentProductConfirmed=true`는 이 상품 ID가 **임대·예약판매 이력이 없는 영구 buy 전용 비소모성 한 상품**임을 담당자가 확인한 뒤에만 입력합니다. Purchase 공개 API만으로 과거 구매 옵션을 판별할 수 없어 이 운영 계약을 확정하기 전에는 구매도 허용하지 않습니다.

[구매 옵션 문서](https://developer.android.com/google/play/billing/one-time-product-multi-purchase-options-offers)에 따라 정확히 한 개의 영구 오퍼만 허용하며 rental·preorder·기간 제한을 거부합니다. 가격은 해당 오퍼의 Play 지역화 문자열만 표시합니다. 구매 직전 새 ProductDetails의 상품·구매 옵션·오퍼 토큰·통화·금액·표시 가격을 비교하고, 바뀌면 새 조건을 표시한 뒤 다시 누르게 합니다. launch에는 같은 새 오퍼의 토큰을 사용합니다.

### 검증·복원·광고·활동

- [Google Codelab Security.kt](https://github.com/googlecodelabs/play-billing-scalable-kotlin/blob/master/codelab-04/app/src/main/java/com/example/playbilling/trivialdrive/kotlin/billingrepo/Security.kt)의 RSA/X.509/`SHA1withRSA` 방식과 [현재 Purchase API](https://developer.android.com/reference/com/android/billingclient/api/Purchase)를 확인했습니다. 예제 키·구현 소스는 복사하지 않았습니다. `getOriginalJson()`의 UTF-8 원문 그대로 서명을 검증하고 재직렬화하지 않습니다. 이후에도 패키지·상품 하나(productId/productIds와 두 필드의 일치)·토큰·수량 1·상태를 SDK 해석과 묶습니다.
- 실제 `billing-9.1.0.aar`의 `javap -c -p Purchase`에서 원문 4→SDK PENDING(2), 그 외→PURCHASED(1)인 느슨한 매핑을 확인했습니다. 앱은 원문 **0→PURCHASED, 4→PENDING**만 허용하며 상태 누락/미지원 값은 거부합니다. RSA 헬퍼는 Android 없는 JVM에서 시험하고, Base64·스트림 처리는 minSdk 24에 맞춥니다.
- launch OK·창 닫힘·PENDING만으로 완료 처리하지 않습니다. 검증된 PURCHASED에서만 메모리 권한을 반영하며 이미 acknowledged인 구매도 복원합니다. 성공한 전체 query에서 해당 구매가 없을 때만 권한을 해제합니다. 조회/검증 실패는 기존 검증 권한을 즉시 지우지 않고 재확인으로 안내합니다. 게임 localStorage boolean으로 구매 완료를 복원하지 않습니다.
- 권한 반영 뒤 acknowledge하며 같은 토큰의 동시 요청·중복 콜백은 attempt ID로 제어합니다. 실패/30초 timeout은 2초·6초의 제한된 backoff 뒤 전체 재조회·검증을 거쳐 재시도합니다. 이후에는 명시적 복원/다음 앱 복귀에서 재시도합니다. 승인 A timeout 뒤 B가 시작되면 A의 늦은 콜백은 B 잠금을 해제하지 않습니다. 빈 query로 해제한 토큰의 늦은 구매/대기 콜백도 재지급하지 않고 다시 조회합니다.
- 설정이 준비되면 시작·연결·앱 복귀·명시적 복원에서 구매를 조회합니다. 앱 미실행 중 승인은 다음 조회가 필요합니다. 권한은 메모리만 사용하므로 오프라인 재실행은 unknown이며 광고를 보류합니다. 조회 실패를 빈 목록으로 바꾸지 않습니다. 영구 disk cache·서버 추상화는 추가하지 않았습니다.
- owned·준비된 설정의 unknown/pending·구매/조회 중에는 기존 시험 광고 load/show를 JS와 네이티브 양쪽에서 차단하고 준비 중인 광고를 폐기합니다. 구매 구성이 아예 없는 기본 빌드는 기존 시험 광고를 계속 사용할 수 있습니다. 실제 운영 광고는 없습니다.
- 구매 모달·구매 준비(연결/상품 재조회)·실제 Play 창과 문서/Android 활동을 `syncActivity`에 통합해 보드·키보드·오디오를 멈춥니다. 자동 권한 조회만으로는 퍼즐/음악을 멈추지 않습니다. 구매 준비 중 닫기·Escape·Android back은 막고 앱 비활성화 시 준비 작업을 무효화합니다. 일반 상품 확인/복원 중에는 닫을 수 있습니다. SDK 45초·IPC 12초 timeout을 두며 실제 창은 SDK 결과/앱 복귀로 확인합니다. 창 종료만으로 구매 완료·모달 닫힘·게임 자동 재개를 만들지 않습니다.

이 로컬 검증은 [Google의 서버 검증·승인 권장사항](https://developer.android.com/google/play/billing/security)을 대체하지 않습니다. 수정된 앱·증거 재생·기기 위변조를 완전히 막지 못하며 환불을 실시간 통지받지 않습니다. 다음 성공적인 현재 구매 조회에서 권한 해제를 반영합니다. 서버 검증·RTDN·취소 구매 확인·계정 바인딩은 출시 전 별도 설계/검증 대상입니다. 한국·미국/어린이~중장년 기획을 유지하며 실제 대상 연령·부모 동의·스토어 국가/설문은 별도 미완료입니다.

### 검사와 남은 검증

자동 **179개**, JVM **8개**가 통과했습니다. JVM은 실행 시 만든 시험 RSA 키로 원문 변조·다른/부분/약한 키 거부와 필드 바인딩·pending 전환·복원·승인 timeout/늦은 콜백/backoff·빈 조회 해제를 확인합니다. 시험 키는 앱 설정에 쓰지 않으며 실제 Play 서명 시험을 대신하지 않습니다. 일반/testing 타입·웹 빌드, 격리 headless Chrome의 실제 웹 미노출과 **Android IPC 대역**을 분리합니다. 대역은 KO/EN 3비율×6상태 36개 배치·44px·구매 준비 중 닫기/뒤로가기·앱 복귀·광고 억제·저장/음량 보존을 확인합니다. 기존 키보드 12개·회차 저장 8개도 통과했습니다.

Android debug/release 빌드가 성공했고 lint는 debug 0 errors/15 warnings, release 0 errors/17 warnings입니다. release의 추가 2개는 변경하지 않은 API 26 아이콘의 MonochromeLauncherIcon 경고이며 새 NewApi 오류는 없습니다. APK v2 검증 통과·버전 유지와 release AAB unsigned 상태를 확인했습니다. 의존성/Manifest/DEX와 release guard는 [네이티브 기록](performance/billing-native-20261015.json), [출시 차단 기록](performance/billing-release-guard-20261015.json)에 기록합니다. 새 `androidTestBilling`을 엄격한 boolean으로 검사하며 CI도 두 모드를 확인합니다. 시험/누락/손상/문자열/숫자 마커 10종은 release를 차단하고, 마지막 dist와 Android 에셋은 production으로 복구합니다. [IPC](performance/billing-ipc-20261015.json), [testing 웹](performance/billing-testing-web-20261015.json), [production 웹](performance/billing-production-20261015.json), [미설정 화면](screenshots/billing-unconfigured-ko.png), [영문 IPC 상태 화면](screenshots/billing-unknown-landscape-en.png).

실기기/AVD가 없어 Play 서비스 연결·지역화 가격·구매 UI·테스트 수단·승인/복원/재설치·환불/계정 변경·보호자 승인·오프라인의 실제 동작은 미검증입니다. [공식 시험 문서](https://developer.android.com/google/play/billing/test)에 따라 정확한 패키지/상품/라이선스 테스터와 실제 기기·트랙을 준비한 뒤 확인해야 합니다. 테스트 트랙의 일반 계정은 실제 청구가 가능하며 이번에는 구매를 실행하지 않았습니다.

## Android 전면 시험 광고 구현·검증 (이슈 #54)

### 선택한 구조와 정확한 버전

`@capacitor-community/admob@8.2.1`의 [package.json](https://github.com/capacitor-community/admob/blob/v8.2.1/package.json), [Gradle](https://github.com/capacitor-community/admob/blob/v8.2.1/android/build.gradle), [AdMob.java](https://github.com/capacitor-community/admob/blob/v8.2.1/android/src/main/java/com/getcapacitor/community/admob/AdMob.java), Manifest를 직접 읽었습니다. Node 22 이상·Capacitor 8 계열 선언과 프로젝트의 core/android 8.5.3이 맞습니다. 태그의 `load()`는 네이티브 광고 배치용 WebView 메시지 리스너를 등록하고 `initialize()`는 보호 설정 후 GMA를 초기화하지만, release에서 SDK 자체를 제외하는 구조는 제공하지 않습니다. 기본 GMA는 동적 `25.4.+`입니다.

이번에는 npm 광고 래퍼를 설치하지 않고 Capacitor 공개 API로 전면 광고만 노출하는 작은 Java 브리지를 자체 작성했습니다. 외부 구현 소스를 복사하지 않았습니다. `src/debug` 브리지와 `debugImplementation`을 사용해 **GMA 25.4.0·UMP 4.0.0을 strictly 고정**하고, release에는 등록 함수의 빈 구현만 둡니다. 별도 flavor·중개 네트워크·범용 광고 계층은 추가하지 않았습니다. npm 잠금 파일을 유지하며 core/android 8.5.3·CLI 8.4.3을 사용합니다. CLI 고정은 기존 audit 대응을 유지한 결정이며 이번 `npm audit`도 0건입니다. SDK/서비스 약관을 대신하는 별도 승인을 만들거나 계정·콘솔을 설정하지 않았습니다.

### 기본 꺼짐과 네이티브 시작 경계

- 웹 빌드는 `testing` 모드일 때만 `androidTestAds:true`를 기록합니다. 실제 Android 플랫폼과 네이티브 플러그인 존재까지 확인해야 설정에 **시험 광고** 진입이 생깁니다. development·일반 production·웹 testing에서는 광고 IPC를 호출하지 않습니다.
- 진입은 상태 조회만 합니다. **테스트 광고 불러오기 → 준비됨 → 테스트 광고 표시**의 두 번의 명시적 선택이 필요합니다. 자동 요청·자동 표시·게임 보상·구매 UI는 없습니다. 활성화 선택을 기기에 저장하지 않습니다.
- 네이티브는 매 명령에서 패키지의 build-info 두 boolean true·debuggable·공식 샘플 App ID를 재확인합니다. 마커 누락·손상·타입 불일치 또는 구성 불일치면 SDK 호출 전에 거부합니다.
- Google 공식 [샘플 App ID](https://developers.google.com/admob/android/quick-start) `ca-app-pub-3940256099942544~3347511713`와 [전면 테스트 단위](https://developers.google.com/admob/android/interstitial) `ca-app-pub-3940256099942544/1033173712`만 코드에 고정했습니다. 호출자가 다른 ID·지역 강제·연령 값을 전달할 인터페이스는 없습니다.
- debug Manifest에서 `MobileAdsInitProvider`를 제거하고 `DELAY_APP_MEASUREMENT_INIT=true`를 넣었습니다. `AD_ID` 및 AdServices 광고 ID·기여·주제 권한도 제거했습니다. JS 꺼짐만으로 초기화를 제어하지 않습니다. 브리지 생성자/`load()`에는 SDK 호출이 없습니다. release 의존성과 병합 Manifest에서는 GMA·UMP·샘플 App ID·광고 브리지 자체를 제외합니다.

자동 Provider 제거는 일반 Google 통합 가이드의 기본 경로를 변경한 debug 시험 선택입니다. 다운로드한 실제 `play-services-ads-api-25.4.0.aar`의 `javap`에서 `MobileAdsInitProvider.attachInfo → zzev.attachInfo`의 Manifest 검사/설정 경로와 `MobileAds.initialize(Context, listener) → zzeu.zzc`의 별도 초기화 진입을 확인했습니다. `play-services-ads-25.4.0.aar`의 `internal.util.zzs`에도 PackageManager의 ApplicationInfo.metaData에서 `ads.APPLICATION_ID`를 읽고 형식을 확인하는 별도 함수가 있습니다. 따라서 App ID 메타데이터를 남기고 명시적 초기화 경로를 사용하는 구조로 작성했지만, **Provider 제거 상태의 실제 SDK 초기화 성공은 컴파일만으로 증명되지 않습니다.** 실기기 UMP·GMA 실행으로 확인해야 합니다. debug에는 AndroidX Startup의 WorkManager·Emoji·Lifecycle·ProfileInstaller 초기화와 SDK 전이 구성요소가 남습니다. 이 조사만으로 SDK의 모든 내부 동작이나 재시작·백그라운드 네트워크 무수집을 입증한 것은 아닙니다. 출시 release에는 이 광고 의존성이 없습니다.

### 동의·상태·복귀

명시적 불러오기마다 GMA `CHILD/G` 설정 → UMP 미성년 파라미터 → consent info 갱신 → 필요한 양식 → `canRequestAds` 및 UNKNOWN 아님 확인 → GMA 초기화 → 테스트 광고 load 순서로 실행합니다. 요청에는 추가로 `npa=1`을 사용하지만 이를 동의 대체로 삼지 않습니다. 이전 저장 동의로 오류를 우회하지 않습니다. 샘플 App ID의 UMP 갱신이 실패하거나 동의가 불명확하면 광고를 차단합니다. 필요한 개인정보 선택 진입은 양식을 다시 열며 그 뒤 광고를 자동 요청하지 않습니다. 기본 꺼짐 정책 때문에 앱 시작 시 UMP 통신도 하지 않고, 해당 실행에서 사용자가 처음 요청할 때부터 갱신합니다.

로딩·준비·표시 요청·표시·실패·닫힘·취소·개인정보 처리 상태를 KO/EN으로 안내합니다. prepare 중복, 네이티브 attempt별 늦은 응답, revision별 역순/중복 이벤트를 차단합니다. SDK initialize 대기·consent 정보/양식 load·광고 load에는 45초 제한이 있고 취소 뒤 늦은 광고를 표시하지 않습니다. 이미 표시 요청한 전면 광고나 실제 열린 개인정보 양식은 JS 시간 초과로 닫힘/승인 처리하지 않습니다. SDK 응답이 오지 않으면 앱 재실행 안내를 사용합니다.

광고/양식 진행 상태를 기존 `syncActivity`에 합쳐 보드·키보드 접근·오디오를 중지합니다. 닫힘/실패 후에도 문서·native 활성 상태, 화면과 기존 modal 조건을 모두 적용합니다. 표시 중 native stop을 광고 종료로 오인하지 않습니다. 준비된 광고는 폐기를 확인한 뒤에만 시험 창을 닫고, IPC 오류는 재조회/취소 재시도로 복구합니다. 앱 초기 상태 조회가 실패해도 돌아갈 수 있습니다. 이벤트 리스너는 한 개를 유지하고 페이지 종료에 제거합니다. 게임 저장/보상/음량 설정을 광고 경로에서 변경하지 않습니다.

시험 창에는 무보상·기본 꺼짐·운영 연령 확인/부모 동의의 대체가 아님·UMP가 앱 전체의 동의가 아님을 명시합니다. 한국·미국/어린이 포함 기획과 운영 ID·결제·콘솔·출시 대상 국가는 바꾸지 않았습니다.

### 검증 기록과 남은 범위

검증 명령은 `scripts/use-dev-tools.ps1`로 환경을 적용한 **실제** `C:\Users\user\Documents\ChatGPT\match3` 경로에서 실행했습니다. 옛 pc_17 junction을 작업 경로로 사용하면 cap 생성 경로와 Gradle 캐시가 섞일 수 있어 실제 경로로 통일했습니다. 최초 캐시 충돌/daemon 종료 뒤 해당 프로젝트의 `gradlew clean` 및 `--no-daemon --max-workers=2 -Dorg.gradle.jvmargs=-Xmx1024m`으로 빌드가 성공했습니다. 다른 프로젝트의 프로세스·공용 캐시를 지우지 않았습니다.

- 자동 테스트 **162개**(기존 142개+신규 20개), 일반·testing 타입/웹 빌드, Chrome의 회차 저장 8항목·키보드 12항목 회귀를 확인했습니다. 추가 광고 상태/활동/취소 실패 회귀는 `tests/test-ads.test.ts`, `tests/ui-flow.test.ts`에 있습니다.
- `scripts/test-ads-qa.mjs`는 격리 headless Chrome만 사용하고 종료합니다. 웹 플랫폼의 실제 진입 없음/IPC 0회와 Android **IPC 대역**의 3비율 × KO/EN × 7상태(42개) dialog 화면 안 배치·스크롤 없음·44px, 명시적 load/show·중복·취소 실패/복구·보드 복귀·저장/음량 보존을 확인합니다. 대역은 실제 광고 재생 증거가 아닙니다. [IPC 측정](performance/test-ads-ipc-20261015.json), [시험 웹 측정](performance/test-ads-testing-web-20261015.json), [production 측정](performance/test-ads-production-20261015.json), [한국어 오류 화면](screenshots/test-ad-error-ko.png), [영어 가로 오류 화면](screenshots/test-ad-error-landscape-en.png).
- `:app:assembleDebug`·`:app:lintDebug`와 정확한 debug SDK 의존성 검사를 수행했습니다. lint는 minSdk 24에 없는 `readAllBytes()` 대신 read 루프를 사용하며 새 NewApi 오류가 없습니다. 처음 나타난 기존 local.properties `C:`의 PropertyEscape 오류는 Git 제외 로컬 설정을 `C\:`로 바로잡았습니다. 최종 lint는 0 errors/15 warnings로, 기존 리소스/Manifest 순서·도구 버전 관련 경고입니다. [네이티브 산출물 측정](performance/test-ads-native-20261015.json).
- `scripts/android-test-ads-qa.ps1`로 시험·마커 누락·손상·필드 누락·문자열 boolean의 release 차단을 재현하고 원본 마커를 finally로 복구했습니다. production 에셋 재동기화 뒤 `bundleRelease`가 성공했습니다. release RuntimeClasspath와 Manifest에 GMA/UMP 광고 항목이 없고, 실제 AAB의 1개 DEX에서 광고 SDK/브리지 descriptor 부재를 확인했습니다. 최종 dist의 27개 파일은 Android production 웹 에셋과 SHA-256이 모두 같으며 두 마커는 모두 false입니다. [차단 측정](performance/test-ads-release-guard-20261015.json).

이번 Android 빌드는 검증용이며 앱 버전 증가·APK 전달·Drive 업로드는 하지 않습니다. **실제 Android 광고/UMP 실행, Provider 제거 후 초기화, 닫기 버튼의 5초 조건, 네트워크 실패·홈 복귀·백그라운드 수집, 아동/부모 동의·Families/한국·미국 운영 적합성은 미검증입니다.** 기기·에뮬레이터가 연결되어 있지 않습니다. 이 상태는 출시 준비 완료가 아니며 release에서 광고는 계속 제외됩니다.

## APK 빌드 이력

### v0.1.6 낙엽 표시 간소화·핍 결과 반응 (이슈 #32·#34)

낙엽 겹 감소의 2→1 팝업을 제거하고 남은 숫자·겹별 그림·날림을 유지했습니다. 기존 핍 그림의 성공/재도전 반응, 결과 dialog 포커스, 테스트 결과→다른 스테이지 선택→취소/확정 전환을 추가했습니다. 자동 검사 81개·Chrome 성공/실패 × 3비율·한국어/영어·움직임 줄이기·보상/저장 분리·테스트/일반 웹 빌드·APK/AAB를 통과했습니다. 단말의 결과·뒤로가기·복귀 검수는 남아 있습니다.

APK는 테스트 도구 포함 빌드, AAB는 테스트 도구 제외 unsigned 빌드입니다. APK v2와 이전 인증서 일치, versionName 0.1.6/code 7, 내부 JS/CSS와 테스트 dist 일치를 확인했습니다. APK 크기 8,928,012바이트, SHA256 `1fe585a3635dcf428a0f74e034806b269023b6c1898755f5f3c2be431095d818`입니다. 이번부터 별도 테스트 안내 파일은 만들지 않고 대화에서 전달합니다.

### v0.1.5 낙엽·퍼즐 연출 보강 (이슈 #30)

겹별 그림·크기·숫자 2/1과 2→1/✓ 피드백, 낙엽 날림·매치 반짝임·줄 쓸기·확산 원을 추가했습니다. 자동 테스트 78개·웹 테스트/일반 빌드·Capacitor 동기화·테스트 APK·테스트 도구를 제외한 AAB가 성공했습니다. APK v2 서명과 이전 인증서 일치, versionName 0.1.5/code 6, APK 내부 JS·CSS·새 낙엽 SVG와 테스트 dist 일치를 확인했습니다. APK는 `testTools:true`, AAB는 `false`이며 AAB는 unsigned입니다. 기본 production 웹에서는 테스트 선택 UI가 없는 것을 실행 확인했습니다. [연출 검증 기록](mobile-play-feedback.ko.md)을 참고합니다.

테스트 APK는 8,926,608바이트이며 SHA256은 `55fbe0ea8940cf2b1b41f5cdf574def93f8d12bfa5ac5465dad1d3ee14c0c83f`입니다. 기존 앱 위 업데이트와 실기기 가독성·연쇄 중첩·홈 복귀는 새 APK 재시험 대상입니다. 사운드 기본 믹스와 퍼즐 판정·목표·보상은 바꾸지 않았습니다.

### v0.1.4 테스트 선택 기능 (이슈 #28)

개발 서버와 `build:test`에서만 스테이지 제목 옆 **테스트** 버튼을 표시합니다. **현재 기준은 1~30스테이지 초안**이며 도입 당시 v0.1.4는 1~10이었습니다([현재 levels](../src/levels.ts), `LEVEL_COUNT`). 잠금과 관계없이 바로 선택하며 시험 완료·실패·재시작·다음 스테이지는 시험 상태를 유지합니다. 시험 결과는 완료 기록·별·코인·잠금 해제를 바꾸지 않습니다. 선택 창에서 **일반 플레이로 돌아가기**를 누르면 일반 저장 회차 또는 진행 스테이지로 돌아가 정상 보상을 적용합니다. 선택 취소는 보드·이동을 유지하며, 연쇄·결과 대기·튜토리얼 중에는 창을 열지 않습니다. 앱 재실행에는 시험 상태를 저장하지 않습니다. 아래 빌드·73개 검사·산출물은 v0.1.4 당시 이력이며 현재 단말/APK 보류 지시가 우선합니다.

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
3. #54 시험 광고의 실제 기기 표시·동의·실패·취소를 검증하고, 이후 별도 결제 연결과 구매 복원을 확인합니다.
4. 최종 앱 ID, 업로드 키와 키 보관, 서명 AAB, 스토어 소재·개인정보 문서·연령 및 데이터 설문을 준비합니다.
5. Play Console 테스트 요구사항을 해당 계정에서 확인하고 테스트 트랙부터 진행합니다.

현재 광고·Billing SDK는 debug 전용 시험 경로에만 있고 release에서 제외됩니다. 실제 상품·검증 설정은 미완료이며 게임 진행은 기기에 저장합니다. 저장소만으로 스토어 공개나 수익화가 완료되지는 않습니다. [Capacitor Android 공식 문서](https://capacitorjs.com/docs/android)를 환경 설정 기준으로 사용합니다.
