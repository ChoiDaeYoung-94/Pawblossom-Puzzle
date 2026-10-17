/** 중복 JSON 키(escape 등가 포함)와 과도한 중첩을 거절하는 인증 응답 전용 검사입니다. */
export function strictSessionJson(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  let at = 0;
  const space = () => {while (at < text.length && /\s/.test(text[at])) at++;};
  const string = (): string => {
    const start = at++;
    while (at < text.length) {
      const c = text[at++];
      if (c === '\\') at++;
      else if (c === '"') return JSON.parse(text.slice(start, at)) as string;
    }
    throw new Error();
  };
  // JSON.parse가 문법을 먼저 검사했으므로 이 순회는 키/깊이만 검사합니다.
  const value = (depth: number): void => {
    if (depth > 32) throw new Error();
    space();
    if (text[at] === '{') {
      at++; space(); const seen = new Set<string>();
      if (text[at] === '}') {at++; return;}
      while (true) {
        space(); const key = string();
        if (seen.has(key)) throw new Error();
        seen.add(key); space(); at++; value(depth + 1); space();
        if (text[at++] === '}') return;
      }
    }
    if (text[at] === '[') {
      at++; space(); if (text[at] === ']') {at++; return;}
      while (true) {value(depth + 1); space(); if (text[at++] === ']') return;}
    }
    if (text[at] === '"') {string(); return;}
    while (at < text.length && !/[\s,\]}]/.test(text[at])) at++;
  };
  value(0); return parsed;
}
