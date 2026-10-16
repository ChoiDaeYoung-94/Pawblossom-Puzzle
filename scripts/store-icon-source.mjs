// 기존 브랜드 원본을 바꾸지 않고 스토어용 정사각형 SVG만 파생합니다.
export function storeIconSvg(mark) {
  const v = mark.viewport;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 ${v} ${v}"><rect width="${v}" height="${v}" fill="${mark.background}"/><g transform="translate(${v/2} ${v/2}) scale(${mark.legacyScale}) translate(${-v/2} ${-v/2})">${mark.paths.map(p=>`<path fill="${p.fill}" d="${p.path}"/>`).join('')}</g></svg>\n`;
}
