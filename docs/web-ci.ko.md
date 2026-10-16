# 웹 자동 검증

연결 이슈: [#12](https://github.com/ChoiDaeYoung-94/Pawblossom-Puzzle/issues/12)

`.github/workflows/web-ci.yml`은 PR 생성·갱신, main 푸시, 수동 실행에서 Node 22와 24의 Linux 환경으로 `npm ci` → `npm test` → `npm run build`를 수행합니다. 타입 검사는 build에 포함됩니다. 저장소 코드 읽기 권한만 사용하고 checkout 자격증명 저장은 끕니다. 공식 액션은 확인한 릴리스의 커밋 SHA로 고정합니다.

참고: [actions/checkout](https://github.com/actions/checkout), [actions/setup-node](https://github.com/actions/setup-node).

같은 PR의 새 실행이 생기면 이전 실행을 취소합니다. 제한 시간은 각 작업 10분이며 두 Node 버전 중 하나가 실패해도 다른 버전의 결과를 확인합니다. Android 빌드·실기기·광고·결제·스토어 배포는 이 워크플로에 포함하지 않습니다.

CI 성공은 PR 자동 병합이나 필수 검사 설정을 뜻하지 않습니다. 필수 검사로 지정하려면 선행 PR 병합과 main의 통합 검증 후 저장소 설정을 별도로 확인해야 합니다.

2026-10-13 [첫 실제 GitHub 실행](https://github.com/ChoiDaeYoung-94/Pawblossom-Puzzle/actions/runs/38359304738)에서 Node 22·24 두 작업 모두 성공했습니다. 각 작업에서 테스트 43개와 타입 검사·Vite 빌드를 수행했습니다. 기존 Phaser 번들 크기 경고는 남아 있습니다.
