import fs from 'node:fs';
import { createRequire } from 'node:module';
import { storeIconSvg } from './store-icon-source.mjs';

// sharp는 내보내기에만 필요합니다. 검증/게임/CI에는 새 의존성이 필요 없습니다.
// 별도 설치한 sharp 경로를 첫 인자로 지정할 수 있고 저장소에 외부 경로를 저장하지 않습니다.
const sharp = createRequire(import.meta.url)(process.argv[2] || 'sharp');
const svg = storeIconSvg(JSON.parse(fs.readFileSync('assets/branding/pawblossom-mark.json','utf8')));
const source = 'assets/store/play-icon-source-v1.svg';
const output = 'assets/store/play-icon-v1.png';
fs.writeFileSync(source, svg);
await sharp(Buffer.from(svg)).toColourspace('srgb').ensureAlpha().withIccProfile('srgb')
  .png({compressionLevel:9,palette:false}).toFile(output);
// 검수 전용이며 제출용 PNG와 분리합니다. 실제 픽셀 크기로 좌우 나란히 표시합니다.
const image = fs.readFileSync(output).toString('base64');
fs.writeFileSync('assets/store/play-icon-preview-v1.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="832" height="660" viewBox="0 0 832 660">
<rect width="832" height="660" fill="#fff"/>
<defs><clipPath id="mask"><rect width="256" height="256" rx="76.8"/></clipPath></defs>
<g font-family="sans-serif" font-size="18" fill="#333"><text x="24" y="28">512px square (submission)</text><text x="560" y="28">30% radius (preview only)</text><text x="24" y="586">48px square / mask</text><text x="280" y="586">32px square / mask</text></g>
<image x="24" y="44" width="512" height="512" href="data:image/png;base64,${image}"/>
<g transform="translate(560 44)" clip-path="url(#mask)"><image width="256" height="256" href="data:image/png;base64,${image}"/></g>
<image x="24" y="600" width="48" height="48" href="data:image/png;base64,${image}"/>
<g transform="translate(92 600) scale(.1875)" clip-path="url(#mask)"><image width="256" height="256" href="data:image/png;base64,${image}"/></g>
<image x="280" y="600" width="32" height="32" href="data:image/png;base64,${image}"/>
<g transform="translate(332 600) scale(.125)" clip-path="url(#mask)"><image width="256" height="256" href="data:image/png;base64,${image}"/></g></svg>\n`);
console.log(JSON.stringify({sharp:sharp.versions,metadata:await sharp(output).metadata(),stats:await sharp(output).stats()},null,2));
