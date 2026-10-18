# 웹 자동 검증

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
