# 웹 자동 검증

## 2026-10-28 · #422 Quad D 시작 인트로

기존 게임 진입 앞에 사용자 소유3.4초 회사 영상을 연결합니다. 한국어/영어 건너뛰기·Escape·모션 감소 포스터·음소거·autoplay 거부 시 무음 재시도와 영상 오류/최대6.5초 종료를 제공하며, 인트로가 정리된 뒤에만 기존 main/게임 오디오를 불러옵니다. 초기 네이티브 inactive 상태의 이벤트 유실 가능성은 독립 검수에서 P2로 발견해, 자체 리스너 등록→현재 상태 조회→이벤트 revision 비교 후 재생하도록 수정했습니다. 등록/조회 실패 또는1.5초 대기는 인트로를 생략하고 게임에 진입하며 기존 게임 리스너 전체를 제거하지 않습니다. 저장·엔진·500레벨·재화·최종 믹스를 변경하지 않습니다.

최초 타입 검사에서 테스트 fixture의 Record 타입 불일치1개가 실패했고 fixture 타입을 명시해 수정했습니다. 이후 관련6파일722개가 성공했고, 네이티브 상태 경합을 보강한 최종 인트로33개·타입3설정·production/testing 빌드가 성공했습니다. 722개는 상태 보강 이전의 관련 묶음이며 최종33개와 중복 합산하지 않습니다. production은 기본 dist에 유지하고 testing은 Git 밖 별도 outDir로 빌드했습니다. 두 산출물의 기능 플래그와 원본 브랜드 파일 SHA를 별도 확인합니다. 기존500KB chunk 안내는 남아 있으며 새 오류로 합산하지 않습니다.

양측 프로젝트 승인 아래 기존 창/프로필·LD/ADB를 건드리지 않고 신선한 headless Chrome context에서 실제 production을 실행했습니다. 최초6사례 성공 뒤 작은 로고를 확대하는 CSS 변경을 반영해 최종6사례를 다시 검증했습니다. 390×844 자연 ended,844×390 영어 Enter,320×568 Escape,모션 감소 무재생,영상 요청 실패,main chunk 실패→실제 재로드 복구가 성공했고 진입 전 저장 쓰기·pageerror는0입니다. 영상 중간 프레임과 포스터의 세로/가로 로고·건너뛰기 배치를 실제 PNG로 확인했습니다. 최초/최종 원문·PNG·report는 Git 밖 integration-20261028/422-* 및422-browser-v2에 분리합니다. 브라우저·5208 preview는 실제 종료했습니다. GPU/가청 출력은 꺼져 있었으므로 성능·청취·Android HOME/Back 복귀·실서비스 검증으로 확대하지 않습니다. 네이티브 연결은 소스와 합성 회귀이며 실제 단말은 후속입니다.

## 2026-10-27 · #396 수신함 최초 선점 BEGIN의 검사 전용 관측

main b06e53f의 첫 CI40447990481 Node22는 동일 수신함8worker에서 completed1·idle3/기대7·process/storage/sqlite busy4로 실패했습니다(개별3,843ms, 5초 timeout 아님). 여기의 busy는 기본코드5/6 묶음이며 원래 실패에서는 SQL 위치·잠금 소유자·최종 DB행수/실제 자식 종료·닫힘을 확인하지 못했습니다. 기존 #122 원문·comment6433606512/6433625894를 보존하며 이후 main의 녹색을 원인 해결로 합산하지 않습니다.

검사 worker의 생성자·제한된 open 재시도가 끝난 뒤 process 직전에만 새 probe를 arm합니다. 현재 processNext의 첫 literal BEGIN IMMEDIATE 한 번에 대해 반환/예외·단조 시계 소요시간·숫자 SQLite 기본/확장 코드만 관측합니다. 생성자·receive·reward/finalize 후속 BEGIN은 이 행에 섞지 않고 SQL/인수/경로/반환값/원문 오류는 출력하지 않습니다. 시계·오류 getter가 실패해도 원래 함수 호출1회·동일 반환/예외를 보존하며 diagnostics=false에는 관측을 추가하지 않습니다. 제품 server/src/public/Android·500ms/5초/8worker·업무 기대·재시도 정책은 유지합니다. 관측 비용 자체가 경합 시점을 바꿀 수 있고 owner·오래 걸린 원인·실제 close 성공을 알려주지는 않습니다.

최초 관련 검사는104성공1실패였습니다. 기존 생성자 BUSY 회귀의 정확 DTO 기대에 새 claimBegin 필드가 빠진 실패로, 업무 결과·openAttempts2·busy 알림1회·원장 신규1개 기대를 보존하면서 진단 필드만 명시 검증했습니다. 수정 후 관련2파일105개와 TypeScript 검사가 성공했고 독립 읽기에서 식별 위치·비노출·원래 호출 보존의 추가 P1/P2는 없었습니다. 실패/성공 로그는 Git 밖 integration-20261027/396-related-first.log와396-related-final.log로 분리합니다. 제품 코드가 같아 이 검사 전용 묶음의 로컬 웹 빌드는 반복하지 않으며 최초 PR/정확main CI·실제 새 실패의 관측은 제출 후 별도로 판단합니다.

## 2026-10-26 · #368 시작·보상소비의 업무 전 진입 정책

main361의 redeem BEGIN BUSY5(첫 기대 실패:7개 voucher-redeemed/1개 storage-unavailable)와 PR367의 start BEGIN BUSY5(7개 round-started/1개 storage-unavailable)를 별도 보존했습니다. 모두 생성 성공 뒤 업무 본문에 들어가기 전 경계입니다. 기존 command helper의 알고리즘을 공통 저장소 모듈로 옮기고 기존 export는 호환하며, 기존명령과 새 start/redeem 두 호출에만 선택 적용합니다. 생성자·SSV callback·조회·applyReward와 다른 기본 경로는 그대로입니다.

이는 단순 검사 재실행이 아닌 제품의 제한된 진입 정책 변경입니다. 열려 있고 transaction이 없는 동일 연결에서 own data의 정확ERR_SQLITE_ERROR/errcode5만25ms 뒤 BEGIN을 추가1회 시도합니다. 호출당native500ms는 유지하지만 두 업무의 명목상 총BEGIN예산은500+25+500=1,025ms가 될 수 있습니다. 스케줄 지연을 포함한 실제 wall시간의 엄격한 상한은 아닙니다. 두 번째 오류는 기존 service-error이며 업무·시계·난수/쓰기·COMMIT/ROLLBACK을 반복하지 않고 capability는 COMMIT 성공 뒤에만 발급합니다.

원본새회귀4실패/4성공을 보존했습니다. 소스수정후 새8개는 성공했고 기존 명령단위의 「시작 never-retry」 1개가 새선택정책과 달라 실패한 원문도 보존했습니다. 해당 단위는 조회1회·시작2회·생성자1회의 정확한 누적으로 갱신했으며, 실제8worker·동일ID/행수/소비1회·500ms·5초·seed 기대는 바꾸지 않았습니다. 관련4파일341개와 타입3설정이 성공했고 공통helper의 native잠금→해제는 기존 worker 회귀를 그대로 통과했습니다. 웹/src/public/Android/설정은 기준main32ab63c와 같아 로컬 두웹빌드를 반복하지 않았습니다. 이전366의 dist는 다른 UI후보이므로 현재backend source의 산출물로 사용하지 않습니다. 최초필수PR/정확main/최종APK는 별도 확인합니다.

이 정책이나 이후 녹색을 #122의 긴COMMIT·OS잠금 owner/스케줄/디스크 근본원인 해결로 표현하지 않습니다. 361의 verified span/닫힘과367의 legacy호출이벤트·종료상태미관측도 서로 합산하지 않습니다. 이미 존재하는 opt-in Linux thread-self schedstat/probe를 새로 구현했다고 세지 않으며, 실서버/실광고·결제·배포를 활성화하지 않습니다.

## 2026-10-25 · #265 보상 worker 구간 관측의 현행 helper 통합

기존 Draft269의 보상 worker opt-in 구간/역할/부모-Worker 시간 기준을 현재 helper에 통합했습니다. #284 trusted prepare 실패/연결 닫힘, #287 Async 활성·소유 hook 조건부 복원, #317 고정8단계/family를 보존하고 구간 finish는 반환한 Sync cleanup에만 연결합니다. SQL/인수/오류 원문·receiver는 DTO에 추가하지 않습니다. 제품/src/server/public/Android·업무 기대·8이벤트/5hook·재시도·500ms/5초/8worker는 유지합니다.

원래00d6ef9 최초CI40045510648 Node22 3051성공1실패/Node24 3052성공과 round-worker command BEGIN BUSY5/conflict6기대7은 그대로 보존합니다. 새 span 옵션을 사용하지 않는 경로이며 원인/owner 미확정입니다. 실제1Worker clock 회귀는 원래 양Node span52개에 포함돼 실행됐고 성공8worker 전체DTO 별도수집과 구분합니다. 현재 통합은 source2ba55bd에서 관련4파일177개·타입3종·최초동결62파일3,331개와 독립 읽기 검수를 통과했습니다. 실제 BEGIN→prepare BUSY5 회귀를 opt-in 끔/켬에 확장해 생성2회·대기25ms1회·동일 native 오류/close/5hook·비노출 기대를 유지했습니다. 이후 문서만 정리했으며 제품/src/server/public/Android/package/scripts/config는 mainc1/제품06과 같아 로컬 두웹빌드는06 근거를 재사용합니다. 새 head의 최초필수CI/정확main은 별도 확인하고 성공8worker 전체DTO 별도수집·원인/owner는 미확정입니다. 녹색을 원인 해결로 주장하지 않습니다.

## 2026-10-24 · #296 Native 여백 설정과 도구 버전

웹 규칙/그림/저장/경제와 vendor를 바꾸지 않고 SystemBars `native` 설정 및 공식 CLI8.5.3 pin/lock을 적용했습니다. 구 CLI8.4.3 타입의 최초TS2322와 수정 후 타입3설정 성공을 구분합니다. Native 후보e285f97은 검증된300의86웹을 재사용했고 비웹은 설정JSON1개만 다릅니다. Native16개는 같은 Java의 UP-TO-DATE/기능15개 재사용이며 새 검사로 합산하지 않습니다. 기존78 production bundle을 검증/보존·복원해 세 flag false와 전수SHA를 확인했으며 웹 재빌드를 추가하지 않았습니다. 독립 소스 읽기의 차단사항은 없었고 API34/WebView124의 실제 화면/입력/표적 SDK 로그 관측은 Android 기록에 분리했습니다. 로컬 전체JS 검사는 설정만 바뀐 이 후보에서 반복하지 않았으며 필수 PR의 양Node 전체·타입/두 빌드와 정확main CI는 제출 뒤 확인합니다. 원장 #122와 별도 Chromium 캐시 원인을 해결로 합산하지 않습니다.

## 2026-10-24 · #293 아트 준비·해제와 빌드 동일성

현재 owner의 세 부품 해독·일부 실패·늦은 완료·반복 해제·같은 owner 교체·다른 부모로 이동한 이미지 정리·실제 크기0을8개로 검사했습니다. 초기 관련3파일52개는 성공했으나 직접 WebP import의 ambient 타입 누락(TS2307)이 있었고, 정적 `new URL(...,import.meta.url)`로 고친 뒤 최종8개/타입3설정과 최초 전체53파일3,210개가 성공했습니다. 이후 결과를 실패한 타입 검사와 합산하지 않습니다. 원장 #122의 이전 원인/잠금 소유자는 여전히 미확정입니다.

최종 생산/시험 두 빌드와 checker가 성공했습니다. 생산78파일의 이름·크기·SHA는 #291 생산 결과와 모두 같고 시험86파일의 자체 WebP3개는 각 하나만 존재하며 metadata의 크기/SHA와 일치합니다. CI의 기존 생산 제외/시험 포함 검사에서 같은 경계를 확인합니다. 독립 읽기 검수의 추가 차단사항은 없었으며 PR/정확main CI·새 APK는 후속입니다. 기준 #291 PR292 최초CI40070083567과 정확main de330e4/CI40070388452는 양Node 각52파일3,202개·store12·타입/두 빌드 성공으로 보존합니다.

## 2026-10-24 · #291 운반 목표의 격리와 원자적 회귀

별도 `experimental-carrier-v1` 엔진38개와 페이지 수명6개를 포함한 최초 전체 검사는 Node24에서52파일3,202개 모두 성공했습니다. 기존 `BoardEngine.ts`·`levels.ts`·`state.ts`의 기준 SHA와100판/golden/RNG 기대를 유지합니다. 잘못된 입력·무효 교환·연쇄 한도 초과의 전체 rollback, 안정 carrier ID·일반 타일과 공동 중력·구멍별 연속 구간·출구 배송·보충·같은 시드 재시작과 조회의 RNG 무소비를 검사합니다. 성공→이동 소진→막힘의 종료 우선순위와 교환 후 막힘도 포함합니다.

페이지 수명은 BFCache 재진입의 새 세대·이전 비동기 Native handle 폐기·새 상태 우선·등록 실패 중 비활성 보존을 검사합니다. 실제 persisted BFCache/Native HOME 관측으로 표현하지 않습니다. 최종 생산/시험 빌드와 각 타입3설정, store12개가 성공했습니다. 생산78파일에는 시험 HTML/entry/chunk/규칙/링크가 없고 시험83파일에는 별도 HTML과 내부 script가 있습니다. 동일 확인을 CI의 기존 세 flag 검사와 함께 수행합니다. 검사 시간·worker·기대는 완화하지 않았으며 원장 #122의 이전 간헐 실패는 미해결로 보존합니다. Node22·PR/정확main CI와 새 APK는 후속 확인입니다.

## 2026-10-24 · #285 callback await·close의 관측 수명

검사 소스a49dbc8은 기존 Sync의 즉시·무조건 복원/Promise 참조를 유지하고 별도 Async scope에서 생성→서명 await→adapter-call→close 완료까지5개 hook을 유지합니다. Async만 설치 descriptor 전체 속성이 같은 항목을 복원하며 foreign 변경·삭제를 보존/실패 표시하고, scope 뒤 남은 wrapper는 원래 호출만 실행합니다. 설치·clock·기록·복원 실패가 업무 반환/오류 참조를 덮지 않습니다. #282 trusted prepare 대응과 기존 exec/Statement·retry 함수는 보존합니다.

동일callback8worker의 diagnostics+sqliteDiagnostics+action undefined에만 연결하고, own-data/배열 length·index/최대8행/허용목록·유한 수치의 선택 DTO로 missing·invalid·유효 empty를 구분합니다. 원래 nativeObservation literal·3worker/default/action/child 출력과 신규1/중복7/DB행수 기대는 유지합니다. 원문 SQL/인수/claim/경로/stack/receiver/rawError는 출력하지 않습니다. 실제 worker의 await 뒤 adapter transaction과 close 후 복원을 확인했습니다.

관련 첫4파일118개·기존 Sync 좁은58성공263skip·타입3설정·최종 최초 전체49파일3,117개가 성공했고 독립 읽기 검수에서 차단사항은 없었습니다. 최종 생산 빌드/타입3설정 성공과78웹파일 전수SHA가 기존 게임4dbd754와 같음을 확인했습니다. testing은 같은 제품 소스의4db 근거 재사용이며 Node22/신규 PR·정확main CI는 제출 뒤 별도 확인합니다. 검사 전용 폴더는 절대 부모와 전용 prefix 확인 뒤 정리합니다.

기준main3139e41 정확최초CI40060368749는 양Node48파일3,083개·store12·타입/두빌드 성공입니다. 옛b316의3callback/4constructor 오류와maina2 round BUSY·864 callback·과거redeem/timeout은 각각 원인 미확정으로 보존합니다. 이번 전체 녹색은 해결 근거가 아니며 관측 hook/clock/복제 비용도 경합 타이밍에 영향을 줄 수 있습니다. 새 실패를 만들기 위한 반복·동일head full/CI 재실행·500ms/5초/8worker/기대·seed 완화·추가DB/SQL/RPC/scheduler는 하지 않았습니다.

## 2026-10-24 · #282 prepare 실패 연결의 닫힘 관측

게임 코드를 바꾸지 않은 검사 소스d7a6bb2/최신main977b48a 정상 병합b316fcc는 같은 tree입니다. 모듈 초기 Node prepare 함수 참조와 오류의 own-data SQL code를 확인한 경우만 receiver를 대응합니다. Node24의 isOpen은 own getter/prototype 없음이라는 별도 관측을 반영해 임의 getter를 브랜드 근거로 쓰지 않습니다. foreign/mock·잘못된 this·위조 prototype/Proxy는 미관측을 유지하며 기존 exec/Statement·DTO·worker·재시도 함수는 바꾸지 않습니다. 이는 receiver 식별이며 options getter 등이 던진 SQL 코드 오류까지 엔진 발생 증명으로 취급하지 않습니다. 악성 preload 이전까지 보증하는 계약은 아닙니다.

실제 임시 DB reserved→exclusive 잠금 계획의 BEGIN/prepare BUSY5 두 개·닫힘2개/isOpen false·생성2회/대기25ms1회/두 번째 비재시도·오류 참조/descriptor 복원을 확인했습니다. 수정 전 표적9개 중2개 예상 실패와 수정 후9개 성공을 분리 보존합니다. 기존 좁은 관련54성공267skip·타입3설정도 성공했습니다. 최종 소스의 생산 빌드/타입3설정은 성공했고,78개 전체 웹 파일 SHA는4dbd754 생산 빌드와 같습니다. testing은 같은 제품 소스의4db 근거를 재사용하며 신규 PR CI는 별도 확인합니다. 검사 임시 폴더는 해석한 절대 경로의 부모·전용 prefix를 확인한 뒤 정리합니다.

첫 전체는48파일3,082성공1실패입니다. reward-ledger:102:222 동일callback8worker의 신규1개는 통과/중복 기대7·실제0으로 실패했습니다. index4 신규true,2·5·6 callback storage-unavailable,0·1·3·7 constructor worker-error이며8개 보고 수신/잘림·관측실패 없음입니다. 뒤 DB행수 assertion은 미실행이고 native SQL·실제 연결 close·owner/원인은 미관측입니다. wrapper의 not-opened/returned는 native 연결 상태와 구분합니다. 원문282-full-first.log/안전요약을 #122에 보존하며 main864·276로컬redeem/정확maina2 round 실패와 같은 원인으로 합치지 않습니다. callback await 이후 native scope는 아직 미구현입니다. 같은head 재실행·500ms/5초/8worker/기대 완화는 하지 않았습니다.

기준 main977b48a 정확최초CI40059657083은 양Node47파일3,074개·store12·타입/두빌드가 성공했습니다. 이 성공과 prepare 관측 성공을 이번 callback 실패의 해결로 표현하지 않습니다. 신규 PR/main 최초 검증은 제출 뒤 따로 확인합니다.

## 2026-10-24 · #272 장애물 재질·상자 사분면 파손

최종 게임 소스4dbd754는 자체256픽셀 WebP3개67,516바이트를 보드·목표·미리보기·제거 피드백에 연결하고 기존 SVG·texture key·상자51/낙엽31·24/숫자·규칙/RNG를 유지합니다. 상자가 실제로 타격된 칸만 동일 중심·51픽셀·회전0의128² 사분면4개로 갈라집니다. 정상 texture·5개 예산·전부 생성/등록 성공 때만 원본을 숨기며 모션 감소·예산 부족·텍스처 불량·부분 실패에는 원본을 유지합니다. 기존120객체 상한·250–295ms·해소 대기·종료 정리를 유지하고, 투명도만 SineIn으로 늦게 줄입니다. 출처/프롬프트/해시는 art/obstacles-v4.json에 보존합니다.

최종 소스의 최초 관련2파일275개·타입3설정·최초 전체47파일3,074개·testing/production 두 빌드/플래그·독립 읽기 검수가 성공했습니다. 중간7324와720의 전체3,057개·빌드는 별도 근거이며 최종 성공 수에 합산하지 않습니다. store12개는 동일 store 입력의7324 검사이며 신규 PR/main CI는 제출 뒤 별도로 확인합니다.

실제 일반 게임과 분리된 고정 Phaser판에서 최종 소스의3상자/12사분면과 원본 중복 없는 파손을 확인했고, 사진 검수용 루프 정지 뒤 재생해1회90점/상자0 정산을 확인했습니다. 모션 감소는 파편0/원본3개 alpha1 뒤 동일 정산입니다. 정상 모드의 특정 샘플 alpha0.5776–0.6900은 해당 해소 단계의 관측일 뿐 이전 샘플과 같은 경과시간/FPS 비교가 아닙니다. 임시 HTML은 해시 보존 뒤 제거하고 탭11·12를 닫았습니다. 중간7324의 실제100번에서 인접 클릭33회30점/상자4→3와7행6열 낙엽1겹,EN320의232정사각/넘침 없음/같은 진행을 확인했습니다. 최종4db에서도 KO390·정상2번19회270점/1별40코인 복귀를 확인했습니다. 초기 좌표 시도·옛 화면/숨겨진 점수 선택기의 대기 실패는 입력 결함으로 확정하지 않습니다. 최종 Android·사용자 감각 검수는 아직입니다.

기준 maina2e1cb3의 정확최초CI40057347323은 Node24 round-ledger:505:179의8worker command에서 적용1회 통과/충돌 기대7·실제6,worker5 BEGIN BUSY5/501.567980ms로3,044성공1실패·후속단계 skipped,Node22검증은 성공입니다. 506행 최종 DB revision은 미검증이며 owner/원인은 미확정입니다. 원문·안전요약과 #122comment6379297368을 보존합니다. PR281 headf63 최초 양Node3,045개 성공 및 이번3,074개 성공을 해결로 표현하지 않으며 같은head 재실행·500ms/5초/8worker/기대 완화는 하지 않습니다. 마지막 정확 녹색main156000e/CI40055884414와 구분합니다.

## 2026-10-24 · #276 정원·돌봄 핍과 자체 소품

게임 소스3d7184c와 최신 main156000e를 정상 병합한07b801b는 같은 tree입니다. 활성 정원 또는 핍 화면의 한 개체에만 기존 분리된 귀·호흡·눈깜박임을 연결하고, 먹이·놀이·인사·돌봄·꽃 교감·성장은 기존 반응이 먼저 표시됩니다. 정원만 하단 정렬하며 header/map의 중앙 정렬과 반응2400ms·성장450ms·가격·소유·저장을 유지합니다. 자체 리본/물뿌리개 WebP35,756바이트의 프롬프트·원본/결과 해시·기계적 가공은 art/pip-accessories-v1.json에 보존했습니다. 해독 성공 뒤 SVG를 대체하고 실패·교체·dispose의 소유권을 보호합니다.

관련5파일462개·타입3종·store12개·testing/production 두 웹 빌드와 flags가 성공했습니다. 실제 공식 체험에서 먹이6회/60성장24친밀·소품 구매/재착용·돌봄 후 리본 복귀·별100→98 심기·무료 꽃 교감·모달·KO390/EN320·640/모션 감소를 확인했습니다. 놀이 별도 체험의10코인/4성장10친밀도 기존대로이며, 체험 종료 뒤 정상1별40코인/핍0·0/2번19회270점과 header 중앙정렬이 복원됐습니다. 언어 전환은 pip-play 초점과 내부 스크롤304→302를 유지했으며 픽셀 동일로 표현하지 않습니다. 이 변경의 Android·사용자 감각 검수는 아직입니다.

첫 로컬 전체는47파일3,044성공1실패입니다. reward-redemption:146:429의8worker 영구소비 첫 voucher 종류 검증에서 worker0만 redeemed/나머지7은 reward-open worker-error이며, 첫 BEGIN의BUSY5·실패연결 close 뒤25ms 재시도·두 번째 prepare의BUSY5(site unknown)가 관측됐습니다. 성공 worker의 redeem COMMIT 호출1,205.022ms는 반환 관측이며 실제 잠금 소유자·지연 원인이 아닙니다. 해당 테스트의 후속 소비1회·같은grant·런타임 권한 검증은 실행되지 않았고 직접 DB행수 검사는 없습니다. 원문276-full-first.log와 별도 안전 요약을 #122에 보존하며 옛main864 callback8worker 실패와 합치지 않습니다. 재실행·500ms/5초/8worker/기대 완화는 하지 않았습니다. 기준main156000e의 정확최초CI40055884414는 양Node46파일3,027개·store12·타입/두빌드 성공이며 이번 로컬 실패의 해결 근거가 아닙니다. 신규 PR/main 검증은 제출 뒤 별도 확인합니다.

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
