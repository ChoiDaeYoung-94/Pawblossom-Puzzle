import {describe,it,expect} from 'vitest';
import {pipTendingArt} from '../src/PipTending';
describe('핍의 유한한 꽃 돌보기 표시',()=>{
  it('포인터·접근성 조작을 추가하지 않고 물방울 세개와 한 꽃만 그립니다',()=>{
    const html=pipTendingArt();expect(html.match(/class="pip-tending-drop"/g)).toHaveLength(3);expect(html.match(/class="pip-tending-flower"/g)).toHaveLength(1);
    expect(html).toContain('aria-hidden="true"');expect(html).not.toMatch(/<button|<image|\bid=|tabindex|onclick/);
  });
  it('다시 그릴 때 현재 반응의 경과만 사용하고 범위 밖/비정상 입력은 제한합니다',()=>{
    expect(pipTendingArt(913.8)).toContain('--tend-elapsed:913ms');expect(pipTendingArt(-2)).toContain('--tend-elapsed:0ms');expect(pipTendingArt(Infinity)).toContain('--tend-elapsed:0ms');expect(pipTendingArt(9000)).toContain('--tend-elapsed:2400ms');
  });
});
