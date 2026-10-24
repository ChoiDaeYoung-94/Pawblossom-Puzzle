# 웹 자동 검증

## 2026-10-24 · #279 퍼즐 밖 객체 그리기

게임 소스814e599는 등록된 Board의 public Systems.setVisible을 현재 route에 맞춥니다. 퍼즐 모달 뒤는 표시하고 나머지 경로만 객체 그리기를 끄며 루프·기존 pause/resume·CREATE·POST_RENDER 교체·타이머·좌표·규칙은 유지합니다. 관련 UI412개·타입3종·첫 로컬 전체46파일3,027개·testing/production 두 웹 빌드/플래그·독립 읽기 검수가 성공했습니다. 실제 지도→퍼즐의344정사각/즉시 키보드·포인터3행3열 선택, 새 테스트100의34회0점/비정형·3목표·입력과 정상2번19회270점/1별40코인 복귀,640가로241정사각/넘침 없음을 확인했습니다.

별도 실제 BoardScene 관측에서 pause는42 Scene render/1,036.5ms, CSS 숨김+pause도37/1,015.7ms였습니다. sys.visible false의 대안 관측은0 Scene render와144 POST_RENDER/1,000.8ms, 재표시는39/1,047ms였습니다. 이는 독립 시제품의 호출 수이며 실제 기기 FPS/배터리 개선률·OS 배경 성능 보장이 아닙니다. 임시 HTML은 해시 보존 후 저장소에서 제거하고 탭/5188 서버를 정리했습니다. 루프를 sleep하지 않아 교체용 프레임은 유지합니다.

기준 main8648468의 정확최초CI40054328452는 Node24 reward-ledger:102:222의 동일callback8worker에서 중복0/기대7로3,024성공1실패/후속단계 skipped, Node22검증은 성공입니다. 응답 index3 신규true/나머지7 storage-unavailable·모두close반환이며 native는 not-observed입니다. DB행수 assert·BUSY/실제 SQL·owner/원인은 미관측입니다. 첫 PR head3390/CI40054034171의 성공·동일tree 및 마지막 녹색 main9a0a8f0/CI40053819175와 구분하며 #122comment6378800050에 보존합니다. 이번 UI 로컬 녹색으로 해결 처리하거나 같은head 재실행·제한 완화를 하지 않습니다.

## 2026-10-24 · #277 서로 다른 claim 3worker의 반환 관측

PR275 head88803d69의 첫CI40053027243은 Node22 reward-ledger:106:166에서 실패했습니다. 서로 다른 claim/transaction·동일 round의3worker 중 신규1개 확인은 통과했지만 round-closed 수는 기대2/실제0이며, 다른2종류·BUSY·DB행수·잠금 owner/원인은 미관측입니다. Node22 전체3,024성공1실패/후속store·type·build skipped와 Node24 성공을 구분하며 원문과 Draft275를 #122comment6378622242에 보존합니다. 현재 main25aad48의 정확CI40051625911 양Node3,016개·store12·타입/두빌드 성공은 이 새 실패의 해결 근거가 아닙니다.

해당3worker 사례에 기존 trace3/task.meta/diagnostics/context만 연결했습니다. helper·제품 코드·입력·worker3개·기대1+2·500ms·5초·RNG·추가 DB 연결은 바꾸지 않았습니다. 신규 head의 관련2파일75개·타입3종과 독립 읽기 검수가 성공했으며 필수CI는 별도 확인합니다. 얻는 것은 반환 종류/코드·결과 또는 오류 단계·close 결과이며 nativeObservation은 not-observed입니다. SQL/BUSY·DB행수·owner·timeout 중단 위치를 추가로 관측하지 않습니다. envelope 복제·trace 투영 비용이 경쟁 타이밍을 바꿀 수 있어 녹색을 원인 해결로 취급하지 않으며 같은head 검사 재실행도 하지 않습니다.

## 2026-10-24 · #267 고밀도 표시 검증과 로컬 timeout 분리

제품 코드06b500a는480월드/56칸/16여백을 유지하고960버퍼·zoom2·중심240·CREATE 전 preRender와 down/up 월드 역변환을 사용합니다. SVG는200픽셀로 읽고 두 Text는 최초 생성 style의resolution2로 설정합니다. 실제 별도 Phaser WebGL/Canvas에서 첫 렌더0프레임의44/436/밖488좌표·합성 첫 선택6,6, 실클릭3,3·여백 드래그·새Scene·320리사이즈·비정형 키보드, 숫자14×23→28×46/체크29×34→58×68과style/source해상도2/2를 확인했습니다. 대역과 실제 렌더를 구분하며 일반 게임 저장/RNG를 주입하지 않았습니다.

관련654개·타입3설정·testing/production 빌드/플래그는 성공했지만 최초 로컬 전체는46파일3,015성공1실패입니다. callback-inbox:80의8worker테스트가5초timeout(표시5,400ms)이며 receive/process 단계·assert실행·worker종료/DB행수·원인/소유자는 로그상 미확인입니다. #122comment6377987115와 Git밖267-full-first.log/독립 읽기 분석에 보존했습니다. 같은head 전체/CI 재실행·기대/시간/8worker 완화 없이 최초 PR 필수검사로 진행하며 이번 표시 성공을 원장 해결로 표현하지 않습니다. 기준main8fd9b69의 정확최초CI40047466775 양Node3,003개·store12·타입/두빌드 성공과도 구분합니다.

동일 소스의 내부APK는 LD5554에서 기존23회140점/목표9·6을 업데이트 복원했고, 실제 보드 밖 아래/오른쪽 종료·회전·정상완료1별40코인·다음판키보드·시험100의비정형/상자4→3/낙엽2→1·일반2복귀/백그라운드·cold재시작을 확인했습니다. Native16개(기능15+scaffold1)는 새 실행/오류0, appLint오류0·기존경고15입니다. 예비 IAB 루프값과 Android HWUI/SurfaceFlinger는 실제 폰/JS·GPU FPS 보장이 아니며 상세 범위는 Android 기록과 Git밖QA에 보존합니다.

## 최신 통합 근거 · 2026-10-18 · #139

구현·검사 기준 main `ca57341fbd269d82cfac63d1be9f173384ad68cc`의 [CI39111374076](https://github.com/ChoiDaeYoung-94/Pawblossom-Puzzle/actions/runs/39111374076)에서 Node22·24 각각35파일2,349/2,349·스토어12/12·타입·production/testing 빌드/구분 검사가 성공했습니다. PR#140 head91f74cff와 실제 squash의 전체 tree가 같고 총괄 독립 관련136개·타입·LF SHA/production 동일 확인도 보존했습니다. [최신 전체 통합·실패 구분](android-release.ko.md)을 우선하며 이번 #139는 문서5개만 변경합니다. 새 문서 PR/head와 실제 main CI는 제출 뒤 별도로 확인합니다.

main136 CI39109768855 Node22의 기존 reward-redemption:163 기본5000ms timeout과 과거 #122 실패는 원문을 보존합니다. 최신 성공과 이전 버전의 성공을 합산해 원인이 해결됐다고 표현하지 않으며 #122는 미해결입니다. 검사5초/file worker2/내부8worker·업무 assertion·제품 SQLite·CI·retry 조건을 완화하거나 CI rerun하지 않았습니다. Chrome37개/AX20개는 #129의 실행 근거와 이후 동일 앱 bundle 확인이며 이번에 재실행하지 않았습니다. Android/실서비스/출시 검증을 대신하지 않습니다.

## 최신 작업 근거 · 2026-10-18 · #122 callback parallel 수명

기준 main `aa7e3ca0e437080536a9d8e5916f7a0d51c11bb7`·`codex/122-callback-parallel-lifecycle`, **최종 관련136/136·최신 전체35파일2,349/2,349 한 번·타입/스토어12/에셋/두 빌드·최종 flags3false/마커0·diff/7파일 SHA 확인**입니다. [검증 단계/소스 SHA·과거 실패](android-release.ko.md#현재-작업-상태--2026-10-18--122-callback-parallel-수명)를 우선합니다. ready 뒤 error/무결과 exit의 검사 harness 공백만 보강하며 정상 결과의 exit 무대기·실제 종료 뒤 부모 정리·기존8worker/go/업무 assertion·SQLite500ms/기본5초/file2/CI는 유지합니다. go 이후 회귀 추가 전 전체2,347개 성공과 최종 소스 전체1회는 별도 기록합니다. #122와 이전 main136 Node22 reward-redemption timeout 원인 미확정 상태를 유지하고 CI rerun은 하지 않았습니다. 총괄 독립 관련136/136·전체/앱/서버 타입·승인 전7파일 SHA·production3개 bundle 동일·무변경 범위 확인을 마쳐 한국어 test 커밋·푸시·Ready PR 제출을 승인받았습니다. 최신 PR/main Node22·24 CI와 병합/정리는 제출 후 총괄이 확인합니다. 아래 선행 CI/통합 성공은 이번 미커밋 결과와 구분합니다.

## 최신 통합 근거 · 2026-10-18 · #129

검증 기준 main은 `dc210437bc3ec02b07cc2e86cd4ebb430ac891bc`입니다. [PR#133 CI39108385256](https://github.com/ChoiDaeYoung-94/Pawblossom-Puzzle/actions/runs/39108385256)와 [정확한 main CI39108513692](https://github.com/ChoiDaeYoung-94/Pawblossom-Puzzle/actions/runs/39108513692)의 Node22·24가 모두 성공했고 main 로그의32파일2,267 passed를 각각 확인했습니다. 스토어12개·타입·production/testing 두 빌드와 각 플래그 검사도 성공했습니다. 서버 모듈과 검사 helper는 앱 번들에 포함되지 않으며 로컬 최종 production 세 flags는false입니다.

같은 코드의 로컬 전체2,265통과/2실패(game-service 잠금 복구 timeout·reward cancel/callback worker-error)는 실패로 보존합니다. 이전 PR#127 main Node24 실패/PR#128 main Node22 실패도 이력으로 유지합니다. 최신 원격 성공을 모든 과거 원인 해결로 해석하지 않습니다. #122의 원인 미확정 항목과 실제 기기/서비스/스토어 #73은 계속 열려 있습니다. 기본5초·file2·내부8worker·제품500ms·assertion/CI를 완화하거나 rerun하지 않았습니다.

[누적 브라우저 확인](browser-qa.ko.md#2026-10-18--누적-통합-확인-이슈-129)은 실제 production dist의37개 확인/목표 AX20개/pageerror0입니다. 격리 context·fixture와 실제 입력/자연 시간의 범위를 나눴으며 Android/TalkBack 성공으로 합산하지 않습니다. #129는 이 근거를 기존 문서 상단에 정리하는 변경으로, 코드가 같은 전체 로컬 검사를 불필요하게 반복하지 않습니다. 문서 PR의 최신 head/base·필수 CI·실제 squash tree와 그 main CI는 제출/병합 뒤 별도로 확인하고 연결 이슈에 기록합니다. 아래 현재/미커밋 표현은 당시 기록입니다.

2026-10-18 #122 callback 자식 정리 현재: 기준 main `4938d3ff515f06369fa793279497e2cd86d591f3`·`codex/122-callback-child-cleanup`입니다. **최종 관련113/113·최신 전체32파일2,265통과/기존 game-service·reward-ledger2실패, 타입/스토어12/에셋/testing→production·최종 flags3false/마커0·diff 확인, 커밋 전 총괄 독립검수 대기**입니다. fork 즉시 등록·result/실제 close·멱등 취소/정리 순서만 보강했고 제품/worker run·재시도·SQLite500ms·기본5초·file worker2/내부8worker·CI는 그대로입니다. 전체를 한 번 실행하고 실패 원문을 보존했으며 전체/CI rerun은 하지 않았습니다. [실패2개·과거 EPERM/timeout·단계별 검증과 SHA](android-release.ko.md#현재-작업-상태--2026-10-18--122-callback-자식-정리)를 우선합니다. #122는 열린 상태이며 새 커밋/PR과 최신 PR/main CI는 없습니다. 총괄 확인 기준 PR#132/위 main의 Node22·24 성공 및 아래 선행 성공을 이번 미커밋 전체 성공으로 합산하지 않습니다.

2026-10-18 #126 현재: 기준 main `c995a001db98ef1219a71dff6fe53c10c83a9872`·`codex/126-ssv-node-listener`에서 SSV 동기 adapter 전용 Node listener를 구현했습니다. **최종 관련392/392·Node22.20 listener103/103·전체31파일2,246/2,246·전체/앱/서버 타입·스토어12개·에셋·testing→production·flags3false/서버 마커0·whitespace 확인을 마쳤으며 커밋 전 총괄 독립검수 대기**입니다. 정리 보강 전 전체2,246개 성공과 최종 소스 검증은 별도 기록합니다. 최초 타입 오류와 하위 npm PATH/정적 도우미 CRLF 오판은 실패 근거를 보존했고 제품 정책을 바꾸지 않고 바로잡았습니다. #121 PR#131은 위 main에 반영되었으며 아래 선행 작업의 대기 표현은 당시 이력입니다. [#126 계약·실패/단계별 검증·소스 SHA](android-release.ko.md#현재-작업-상태--2026-10-18--126)를 우선합니다. 기본5초/file worker2/내부8worker·운영 SQLite500ms·재시도/assertion·CI를 변경하거나 rerun하지 않았습니다. Node22 일부 성공을 Node22 전체나 최신 PR/main CI 성공으로 확대하지 않습니다.

2026-10-18 #122 원장 후속 현재: 기준 main `75773eb9b94c865e90bfc44831ca94e57bc26cc0`·`codex/122-reward-open-busy`, 보상/Round 두 phase의 검사 전용 생성자 exact5 gate를 명시 opt-in 호출에만 적용했습니다. **최종 관련521/521·전체2,064통과/기존 callback timeout1·타입/스토어/빌드 통과, 총괄 독립검수 완료·Draft 제출 승인**입니다. 총괄 관련521개·타입/diff·6개 LF SHA/metadata·production 기준 동일 검수를 마쳤고 최신 PR/main Node22·24는 제출 후 별도 확인 대상입니다. 최신 전체는 한 번 실행했고 callback timeout의 결과/원인은 미관측으로 보존했습니다. CI rerun·기본5초/worker·운영 정책 변경은 없습니다. [두 phase 검증과 제약](android-release.ko.md#현재-작업-상태--2026-10-18--122-원장-후속)을 우선합니다. Node22 새 getter/close의 실제 동작은 후속 CI 전 미확인이며 아래 보상 한정 단계의 성공을 최신 전체 성공으로 합산하지 않습니다.

2026-10-18 #122 후속 현재: 기준 main `75773eb9b94c865e90bfc44831ca94e57bc26cc0`, `codex/122-reward-open-busy`입니다. PR#128 Node22·24 성공 뒤 같은 tree의 main CI39103936163에서 Node22가2실패했고 Node24는 성공했습니다. 실제 reward-open/database-exec/native5와 정리/트랜잭션 상태를 확인한 경우에만 보상 테스트 helper 생성자를 opt-in 총3회/25ms로 재개방합니다. Round에는 재시도 없이 concurrent5개 진단을 명시했습니다. **최종 관련505/505·전체2,049/2,049·타입/스토어/빌드 통과, 커밋 전 검수 대기**이며 [단계별 실패·후속 계약](android-release.ko.md#현재-작업-상태--2026-10-18--122-후속)을 보존합니다.

새 metadata는 native receiver를 WeakMap에만 두고 transactionActive/connectionClosed를 Boolean/null로, 생성 시도를 최대3개 고정 레코드로 투영합니다. 실제 로컬 Node24.21.0의 own getter·close 정상 반환과 실제 닫힘의 구분·관측 null 차단을 검사했으며 Node22 새 속성의 실제 실행은 후속 CI 전 미확인입니다. 기존5초/worker 수/CI 워크플로·운영 원장은 그대로이고 CI rerun은 하지 않았습니다. 아래 #122 최초 설명의 검증/제출 상태는 첫 진단 PR 당시 기록입니다.

2026-10-18 현재 [#122 원장 검사 진단](https://github.com/ChoiDaeYoung-94/Pawblossom-Puzzle/issues/122)은 기준 main `b9782b6c36b8abba88511cb937e80a2e07daff32`의 Node22 성공/Node24 Round 동시 생성 실패를 보존합니다. 최종 로컬 관련475개는 통과했지만 전체1회는2,018통과/기존 Round 특수 탭1실패입니다. 총괄 관련475개·타입/diff・SHA/metadata 독립검수를 마쳐 Draft 제출을 승인받았으며 최신 PR/main Node22·24는 제출 후 별도 확인 대상입니다. 이전 PR/main·다른 코드 단계·부분/단독 성공을 최신 전체 성공으로 합산하지 않습니다. 상세 근거는 [개발 기록](android-release.ko.md#현재-작업-상태--2026-10-18--122)에 있습니다.

지정11개 검사는 준비 전에 `task.meta.ledgerDiagnostic`를 연결합니다. JSON이 필요하면 기존 CLI에 `--reporter=json --outputFile=<Git 밖 결과 경로>`를 지정합니다. 고정 phase·단조 상대시간·허용 kind/code/errorName 및 진단 단발 worker의 SQLite5메서드 오류 코드/설치·복원 상태만 남깁니다. 원문 SQL/인자/오류/본문/계정/키/result/snapshot/grant는 추가 출력하지 않습니다. 최종 worker 결과 미수신이면 내부 단계는 미관측이며 native 오류 없음도 저장 정상 증거가 아닙니다. Node24.21.0 실제 동작·부분 설치/복원 실패와 원래 return/throw 참조 유지를 확인했지만 Node22 실제 실행은 아직 없습니다. 원장 정책·기본5초·worker 수·CI 설정을 바꾸거나 CI를 rerun하지 않았습니다.

연결 이슈: [#12](https://github.com/ChoiDaeYoung-94/Pawblossom-Puzzle/issues/12)

`.github/workflows/web-ci.yml`은 PR 생성·갱신, main 푸시, 수동 실행에서 Node 22와 24의 Linux 환경으로 `npm ci` → `npm test` → `npm run build`를 수행합니다. 타입 검사는 build에 포함됩니다. 저장소 코드 읽기 권한만 사용하고 checkout 자격증명 저장은 끕니다. 공식 액션은 확인한 릴리스의 커밋 SHA로 고정합니다.

참고: [actions/checkout](https://github.com/actions/checkout), [actions/setup-node](https://github.com/actions/setup-node).

같은 PR의 새 실행이 생기면 이전 실행을 취소합니다. 제한 시간은 각 작업 10분이며 두 Node 버전 중 하나가 실패해도 다른 버전의 결과를 확인합니다. Android 빌드·실기기·광고·결제·스토어 배포는 이 워크플로에 포함하지 않습니다.

2026-10-16 승인된 운영 규칙에 따라 필요한 검증과 최신 PR head의 Node 22·24 검사가 모두 통과하면 별도 승인 없이 main에 Squash merge합니다. 현재 main 보호 규칙·ruleset·필수 검사 설정은 없습니다. CI 성공과 보호 규칙 설정, 단말·서비스·출시 검증은 각각 구분하며 저장소 보호 설정을 변경하거나 검사를 우회하지 않았습니다. 과거 선행 PR은 통합 완료했고 PR별 새 검사 근거는 [통합 기록](performance/main-integration-20261016.json)에 보존했습니다.

2026-10-13 [첫 실제 GitHub 실행](https://github.com/ChoiDaeYoung-94/Pawblossom-Puzzle/actions/runs/38359304738)에서 Node 22·24 두 작업 모두 성공했습니다. 각 작업에서 테스트 43개와 타입 검사·Vite 빌드를 수행했습니다. 기존 Phaser 번들 크기 경고는 남아 있습니다.
