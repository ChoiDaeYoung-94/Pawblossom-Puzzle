import {describe,expect,it} from 'vitest';
import {outputCurve} from '../src/audio/AudioManager';

describe('큰 믹스의 최종 출력 제한',()=>{
  it('작은 신호는 그대로 통과하고 큰 신호는 연속·대칭·단조롭게 제한합니다',()=>{
    const curve=outputCurve();
    expect(curve[2048]).toBe(0);
    for(let i=1;i<curve.length;i++){
      expect(curve[i]).toBeGreaterThanOrEqual(curve[i-1]);
      expect(Math.abs(curve[i]-curve[i-1])).toBeLessThan(0.001);
      expect(Math.abs(curve[i])).toBeLessThan(0.9);
      expect(curve[i]).toBeCloseTo(-curve[curve.length-1-i],6);
      const input=i/4096*2-1;
      if(Math.abs(input)<0.65)expect(curve[i]).toBeCloseTo(input,6);
    }
  });
});
