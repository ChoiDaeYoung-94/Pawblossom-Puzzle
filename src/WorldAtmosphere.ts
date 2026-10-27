/** 신규 풍경의 작은 부분 연출입니다. 번호·입력·난수·게임 판정에는 관여하지 않습니다. */
const WEATHER=['petal','bee','ripple','bird','leaf','snow','aurora','bamboo','steam','spore','bubble','heat','spark','cloud','firefly','petal','gear','spray','star','confetti'] as const;
export function worldAtmosphere(index:number,placement?:(part:number,delay:number)=>string){
  const weather=WEATHER[index-5];if(!weather)return '';
  const petal='<g class="motif-fall"><path d="M20 12C3 4 6 27 20 31C34 24 37 4 20 12Z" fill="#efb7ce" stroke="#c887a7"/><path d="M20 14V28" stroke="#ffe5ee"/></g>';
  const drawings:Record<typeof WEATHER[number],string>={
    petal,
    bee:'<g class="motif-fly"><g class="motif-wings"><ellipse cx="15" cy="13" rx="8" ry="5" fill="#f4fbff" stroke="#a6b9c6"/><ellipse cx="29" cy="13" rx="8" ry="5" fill="#f4fbff" stroke="#a6b9c6"/></g><ellipse cx="22" cy="23" rx="12" ry="8" fill="#f4c65b" stroke="#a77a36"/><path d="M18 17V29M25 17V29" stroke="#79563c" stroke-width="3"/><circle cx="33" cy="22" r="2" fill="#79563c"/></g>',
    ripple:'<g class="motif-rings" fill="none" stroke="#f5ffff" stroke-width="1.6"><ellipse cx="22" cy="23" rx="10" ry="4"/><ellipse cx="22" cy="23" rx="19" ry="8"/></g><path d="M8 18Q2 6 12 11Q19 1 22 13Q33 12 23 21Z" fill="#f5cddd"/>',
    bird:'<g class="motif-fly" fill="none" stroke="#fffaf5" stroke-width="3" stroke-linecap="round"><path class="motif-wings" d="M4 20Q14 9 22 20Q30 9 40 20"/><path d="M21 20L24 25"/></g>',
    leaf:'<g class="motif-fall"><path d="M22 4L26 13L36 8L32 20L41 24L28 28L25 38L20 29L8 30L13 21L5 14L18 14Z" fill="#e9a258" stroke="#b97c45"/><path d="M22 14L21 33M21 23L14 20M22 25L30 20" fill="none" stroke="#f6cf86"/></g>',
    snow:'<g class="motif-fall" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M22 7V37M9 14L35 30M9 30L35 14M17 10L22 15L27 10M17 34L22 29L27 34M10 20L16 20L16 14M28 30L28 24L34 24"/></g>',
    aurora:'<g class="motif-ribbon" fill="none" stroke-linecap="round"><path d="M4 10Q12 36 22 14T40 22" stroke="#9edfd8" stroke-width="8" opacity=".55"/><path d="M4 7Q12 30 22 11T40 18" stroke="#d1b7ed" stroke-width="4" opacity=".75"/></g>',
    bamboo:'<g class="motif-branch"><path d="M9 39Q20 18 31 6" fill="none" stroke="#7c9e70" stroke-width="2"/><path d="M14 29Q0 25 6 14Q17 17 14 29M21 21Q25 7 37 10Q35 21 21 21M26 13Q18 6 22 0Q31 3 26 13" fill="#b2c995" stroke="#86a478"/></g>',
    steam:'<path class="motif-steam" d="M12 35Q25 28 14 20T18 4M27 37Q40 29 29 22T32 8" fill="none" stroke="#fff8e9" stroke-width="3" stroke-linecap="round"/>',
    spore:'<g class="motif-rise" fill="#ffe9d5"><circle cx="8" cy="25" r="2"/><circle cx="27" cy="10" r="3"/><circle cx="36" cy="31" r="2"/><circle cx="18" cy="37" r="1.5"/></g>',
    bubble:'<g class="motif-rise" fill="#c9f6f642" stroke="#efffff" stroke-width="1.4"><circle cx="10" cy="30" r="6"/><circle cx="29" cy="20" r="8"/><circle cx="20" cy="6" r="3"/><path d="M25 15Q31 12 34 18"/></g>',
    heat:'<g class="motif-ribbon" fill="none" stroke="#fff5dc" stroke-width="2" opacity=".7"><path d="M6 34Q15 20 9 7M20 38Q29 22 23 5M35 33Q43 17 37 3"/></g>',
    spark:'<g class="motif-twinkle" fill="#fff4d5"><path d="M22 3L26 16L39 20L26 24L22 37L18 24L5 20L18 16Z"/><path d="M37 2L39 7L44 9L39 11L37 16L35 11L30 9L35 7Z"/></g>',
    cloud:'<g class="motif-fly"><path d="M6 31C-4 21 5 14 13 16C11 1 34 2 33 18C48 13 50 32 37 33Z" fill="#fffaf7" stroke="#e2e5f1"/><path d="M8 30H36" stroke="#eef0f6" stroke-width="3" stroke-linecap="round"/></g>',
    firefly:'<g class="motif-twinkle" fill="#fff3b4"><ellipse cx="11" cy="13" rx="4" ry="2" fill="#e5f0d5"/><circle cx="12" cy="17" r="3"/><ellipse cx="31" cy="27" rx="4" ry="2" fill="#e5f0d5"/><circle cx="32" cy="31" r="3"/></g>',
    gear:'<g class="motif-gear" fill="#e8c382" stroke="#ac8e62" stroke-width="1.5"><path d="M18 5H26L27 11L33 9L39 15L35 20L40 24L37 32L31 31L29 38H21L19 32L12 35L6 29L10 23L5 19L9 11L15 12Z"/><circle cx="23" cy="22" r="8" fill="#fff0d0"/><circle cx="23" cy="22" r="3" fill="#cfaa70"/></g>',
    spray:'<g class="motif-rise" fill="#efffff"><path d="M12 5Q3 20 12 21Q21 20 12 5M30 14Q23 26 30 27Q37 26 30 14"/><circle cx="7" cy="32" r="2"/><circle cx="37" cy="8" r="2"/></g>',
    star:'<g class="motif-twinkle" fill="#f6dfaa" stroke="#c6b7e8"><path d="M21 5L26 16L38 18L29 26L31 38L21 32L10 38L12 26L3 18L16 16Z"/><path d="M21 12L24 21L31 22L25 27" fill="none" stroke="#fff5d9"/></g>',
    confetti:'<g class="motif-fall"><path d="M4 6L11 4L15 13L8 15Z" fill="#f4b2c1"/><path d="M30 13L37 18L31 25L25 20Z" fill="#c7b6e7"/><path d="M13 28L20 26L25 35L18 38Z" fill="#efd08d"/></g>',
  };
  return `<div class="map-world-atmosphere" data-world-weather="${weather}" aria-hidden="true">${[0,1,2].map(part=>`<svg class="map-world-motif map-world-motif-${part}" viewBox="0 0 46 46"${placement?.(part,part*1.3)??` style="--motif-delay:${part*1.3}s"`}>${drawings[weather]}</svg>`).join('')}</div>`;
}
