# 에셋 제작 기록

제작일: 2026-10-08. 현재 에셋은 첫 시제품용입니다. 스토어용 최종 아트 검수는 남아 있습니다.

| 파일 | 제작 방식 | 용도 |
| --- | --- | --- |
| `public/assets/meadow.png` | Codex 내장 imagegen 생성 | 꽃잎 초원 배경 |
| `public/assets/pip.png` | Codex 내장 imagegen 생성, 투명 배경 | 정원사 토끼 핍 |
| `public/assets/tiles/*.svg` | 프로젝트에서 직접 작성한 벡터 | 딸기·당근·블루베리·도토리·잎·꽃 |
| `src/icons.ts` | 프로젝트에서 직접 작성한 SVG | UI 아이콘 |
| `android/app/src/main/res/drawable/pawblossom_icon.xml` | 프로젝트에서 직접 작성한 Android 벡터 | 시제품 앱 아이콘·시작 화면 |
| `src/audio/AudioManager.ts` | 프로젝트에서 직접 작성한 음형과 Web Audio 합성 | BGM 1곡·효과음 8종 |
| Nunito, Fraunces | `@fontsource` 로컬 패키지, SIL Open Font License | 영문 본문·제목 |

폰트 라이선스 원문은 `public/licenses/Nunito-OFL.txt`, `public/licenses/Fraunces-OFL.txt`에 포함되어 배포 빌드에 함께 들어갑니다. 한국어는 기기 기본 글꼴을 사용합니다. 기존 게임의 그림·음악을 추출하거나 사용하지 않았습니다. 라이브러리 코드는 각 패키지 라이선스가 적용되며 프로젝트 전체에 별도 오픈소스 라이선스를 지정하지 않았습니다.

## 배경 생성 프롬프트

Original polished hand-painted 2D storybook woodland village environment, landscape 3:2 composition. Mint green rolling hills, ivory sunlight, rounded trees, sandy path, a small cozy cottage with a strawberry-red rounded roof, carrot garden and pink flowers, a winding river. Cozy afternoon, sage green, cream, peach and muted coral palette. Keep the central third readable for a cottage and future overlays. No characters, typography, logos, watermarks, or imitation of any existing game. Rich gouache texture with clean forms suitable for a friendly casual puzzle game.

## 핍 생성 프롬프트

One original adorable cream rabbit gardener, full body, front three-quarter view. Dark brown eyes, peach cheeks and inner ears, sage green overalls with a tiny leaf detail, holding one carrot. Warm hand-painted gouache shading with crisp readable edges and rounded proportions. Friendly casual game character. Transparent background, no scenery, no text, no logo, no watermark, no imitation of an existing character.

원본 생성 결과를 프로젝트 PNG로 복사했습니다. 그림은 실제 브라우저에서 확인했고, 블록 SVG는 Phaser SVG 로더로 래스터화하여 표시합니다. 배경에는 나중에 추가할 수 있는 요소가 그려져 있으므로 그림 속 소품 전체가 현재 상호작용 가능한 기능을 뜻하지 않습니다.

## 출시 전 보강

- 핍의 표정·동작 세트와 정원 변화 단계 전용 아트 제작
- 작은 화면에서 블록 형태, 특수블록 표시, 목표 아이콘 가독성 확인
- 저사양 기기 텍스처 메모리·로딩 측정 후 해상도와 압축 최적화
- 앱 적응형 아이콘·스토어 아이콘·스크린샷·피처 그래픽 제작
- 최종 음색과 음량을 휴대폰 스피커·이어폰으로 청취하여 보강
