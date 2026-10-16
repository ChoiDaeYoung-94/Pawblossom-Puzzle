# Android 빌드와 출시 준비

## 현재 설정과 검증

앱 이름은 Pawblossom Puzzle이며 개발용 applicationId는 `com.choidaeyoung.pawblossompuzzle`입니다. Play 등록 전에 최종 확정합니다. 현재 개발 브랜치의 versionName은 `0.1.6`, versionCode는 `7`입니다. Capacitor 8, minSdk 24, compileSdk/targetSdk 36, Android Gradle Plugin 8.13.0, Gradle 8.14.3, Build Tools 36.0.0을 사용합니다.

## 광고·광고 제거 결제 도입 판단 (이슈 #51)

2026-10-15 공식 자료와 배포 태그를 조사했습니다. 사용자님이 **첫 출시 준비 국가를 한국·미국**으로 선택했고, 어린이부터 중장년까지의 기획은 유지합니다. 아래는 구현 기준과 미완료 조건이며, SDK 설치·콘솔 설정·광고 표시·구매 검증을 완료한 기록이 아닙니다. 현재 앱에는 광고·결제 SDK나 작동하는 상품 UI가 없습니다.

### 광고와 연령·동의

어린이·연령 불명 이용자에게는 Families에 맞는 SDK·비맞춤형 광고·형식 제한을 함께 적용해야 합니다. mixed audience 운영에는 중립 연령 확인이 필요합니다. 실제 앱·그림·표현과 맞는 연령대를 선언하고, 광고 편의를 위해 성인 전용으로 바꾸지 않습니다. 게임을 방해하는 광고는 선택형·보상형도 5초 후 닫을 수 있어야 하며 앱 시작 직후 전면 광고·시청/구매를 압박하는 표현을 피합니다. 승인 SDK 목록은 래퍼나 앱 전체의 승인을 의미하지 않습니다. [Families 정책](https://support.google.com/googleplay/android-developer/answer/9893335?hl=en), [대상 연령·중립 연령 화면](https://support.google.com/googleplay/android-developer/answer/9867159?hl=en), [SDK 목록](https://support.google.com/googleplay/android-developer/answer/12955712?hl=en).

다음 개발 단계는 **전체 요청에 아동 보호 설정을 적용한 Android 테스트 광고 한 형식**입니다. Google 테스트 ID만 사용하고 중개 네트워크를 추가하지 않습니다. 이는 시험 전략이며 운영 연령 확인이나 부모 동의의 면제 근거가 아닙니다. SDK 자동 초기화와 요청 전 보호 신호 적용, 병합 Manifest의 식별자 권한·실제 수집도 확인합니다. 설정·연령·동의·구매 상태가 불명확하면 자동 광고를 보류합니다.

선정 후보 플러그인의 `initialize`에는 `tagForChildDirectedTreatment:true`, `tagForUnderAgeOfConsent:true`, `maxAdContentRating:General`(네이티브 `G`)을 검토합니다. UMP의 `requestConsentInfo({tagForUnderAgeOfConsent:true})`는 별도입니다. UMP 신호가 광고 요청에 자동 전달된다고 가정하지 않습니다. Google은 새 연령 제한 API도 제공하므로 실제 고정 GMA 버전과 기존 플래그의 지원을 다시 대조합니다. [플러그인 타입](https://github.com/capacitor-community/admob/blob/v8.2.1/src/definitions.ts), [AdMob 요청 설정](https://developers.google.com/admob/android/targeting), [UMP 미성년 처리](https://developers.google.com/admob/android/privacy/gdpr).

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

## APK 빌드 이력

### v0.1.6 낙엽 표시 간소화·핍 결과 반응 (이슈 #32·#34)

낙엽 겹 감소의 2→1 팝업을 제거하고 남은 숫자·겹별 그림·날림을 유지했습니다. 기존 핍 그림의 성공/재도전 반응, 결과 dialog 포커스, 테스트 결과→다른 스테이지 선택→취소/확정 전환을 추가했습니다. 자동 검사 81개·Chrome 성공/실패 × 3비율·한국어/영어·움직임 줄이기·보상/저장 분리·테스트/일반 웹 빌드·APK/AAB를 통과했습니다. 단말의 결과·뒤로가기·복귀 검수는 남아 있습니다.

APK는 테스트 도구 포함 빌드, AAB는 테스트 도구 제외 unsigned 빌드입니다. APK v2와 이전 인증서 일치, versionName 0.1.6/code 7, 내부 JS/CSS와 테스트 dist 일치를 확인했습니다. APK 크기 8,928,012바이트, SHA256 `1fe585a3635dcf428a0f74e034806b269023b6c1898755f5f3c2be431095d818`입니다. 이번부터 별도 테스트 안내 파일은 만들지 않고 대화에서 전달합니다.

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
