import { gardenDesignFor,type GardenDesign,type FlowerStyle } from './gardenDesign';
const blossom=(style:FlowerStyle,meadowColor='#e9a9b1')=>style==='violet'?'<path d="M-9-5Q-8-17 0-15Q8-17 9-5L12 1Q6 7 0 2Q-6 7-12 1Z" fill="#a18ac9" stroke="#76629d" stroke-width="1.3"/><path d="M-4 1v5m8-5v5" stroke="#edc76d" stroke-width="2"/>':`${Array.from({length:style==='daisy'?10:5},(_,i)=>`<ellipse cx="0" cy="-6" rx="${style==='daisy'?2.6:4.4}" ry="${style==='daisy'?7:5.6}" fill="${style==='daisy'?'#fffdf2':meadowColor}" stroke="${style==='daisy'?'#cbbf93':'#ca8795'}" stroke-width=".6" transform="rotate(${i*(style==='daisy'?36:72)})"/>`).join('')}<circle r="3.5" fill="#efc75e"/>`;
export const flowerArt=(style:FlowerStyle)=>`<svg viewBox="-17 -18 34 36" aria-hidden="true">${blossom(style)}</svg>`;
/** 꽃 선택과 소유 장식만 그리며 저장 객체를 변경하지 않습니다. */
export function gardenArt(value:number,celebrate=false,selection?:GardenDesign):string {
  const stage=Number.isFinite(value)?Math.max(0,Math.min(5,Math.floor(value))):0;
  const design=gardenDesignFor(selection);
  // 핍의 왼쪽 전경을 피해 꽃밭의 오른쪽 아래에 놓습니다. 미선택 구 저장은 원래 위치입니다.
  const lanternPositions=[[211,173],[338,161],[454,178],[270,244],[405,244]];
  const [lanternX,lanternY]=lanternPositions[design.lanternPlot??-1]??[419,217];
  // 왼쪽 전경에 핍이 설 자리를 두고 다섯 꽃밭을 오른쪽에 모읍니다.
  const plots=[[158,153],[285,141],[413,153],[218,222],[351,222]];
  const colors=['#e9a9b1','#efcd79','#b9add8','#e7afa0','#d7b1d1'];
  const plant=(x:number,y:number,style:FlowerStyle,color:string)=>`<g transform="translate(${x} ${y})"><path d="M0 1Q-2-11 0-27" fill="none" stroke="#668c5f" stroke-width="2.5"/><path d="M0-11Q-14-23-13-10Q-5-6 0-11M0-17Q13-27 12-15Q5-12 0-17" fill="#87ad74"/><g transform="translate(0 -28)">${blossom(style,color)}</g></g>`;
  const beds=plots.map(([x,y],i)=>{
    const planted=i<stage;
    return `<g class="garden-plot" data-plot="${i}" data-flower="${design.flowers[i]}" data-planted="${planted}" transform="translate(${x} ${y})">
      <ellipse cy="20" rx="59" ry="13" fill="#486b44" opacity=".12"/>
      <path d="M-52-10Q0-32 52-10L58 12Q0 40-58 12Z" fill="#d1b387" stroke="#a6845e" stroke-width="2"/>
      <path d="M-49-8Q0-27 49-8L50 7Q0 29-50 7Z" fill="#967553"/>
      ${[-4,3,10].map(row=>`<path d="M-40 ${row}Q0 ${row+16} 40 ${row}" fill="none" stroke="#be9a70" stroke-width="2" opacity=".75"/>`).join('')}
      ${planted?`<g class="plant-cluster ${celebrate&&i===stage-1?'new-patch':''}">${[[-29,-6],[-7,-12],[16,-10],[35,-1],[-17,8],[13,11]].map(([px,py],j)=>plant(px,py,design.flowers[i],colors[(i+j%2)%5])).join('')}</g><circle cx="44" cy="13" r="8" fill="#ecf0d7"/><path d="m40 13 3 3 5-6" fill="none" stroke="#64865a" stroke-width="2" stroke-linecap="round"/>`:''}
    </g>`;
  }).join('');
  return `<svg class="garden-art" data-stage="${stage}" viewBox="0 0 480 280" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs><linearGradient id="garden-sky" x2="0" y2="1"><stop stop-color="#faf2d9"/><stop offset="1" stop-color="#e4ecd6"/></linearGradient><linearGradient id="garden-grass" x2="0" y2="1"><stop stop-color="#bdd1a4"/><stop offset="1" stop-color="#e2e7bd"/></linearGradient></defs>
    <rect width="480" height="280" fill="url(#garden-sky)"/>
    <circle cx="380" cy="43" r="24" fill="#fff8dd" opacity=".8"/>
    <path d="M0 97Q83 40 166 92T344 77T480 89V280H0Z" fill="#d0dfb9"/>
    <path d="M0 119Q96 73 194 111T480 101V280H0Z" fill="url(#garden-grass)"/>
    ${[[38,70,1],[445,63,1.2],[87,46,.7]].map(([x,y,s])=>`<g transform="translate(${x} ${y}) scale(${s})"><path d="M-3 14H4L7 54H-6Z" fill="#ad9170"/><ellipse cy="1" rx="31" ry="37" fill="#9dbf8c"/><ellipse cx="-10" cy="-8" rx="23" ry="28" fill="#b1ca97"/><path d="M0 9V32M0 23l-10-8M0 15l9-7" fill="none" stroke="#85a774" stroke-width="2"/></g>`).join('')}
    <path d="M215 96Q271 127 246 165T267 280H236Q220 221 229 179T204 96Z" fill="#e8d8b2" opacity=".8"/>
    <g stroke="#b1a481" stroke-width="4" stroke-linecap="round"><path d="M115 95H357M115 106H357"/>${[124,166,208,250,292,334].map(x=>`<path d="M${x} 87V114"/>`).join('')}</g>
    <g fill="#8eac7c" opacity=".6">${[[25,185],[444,215],[52,256],[400,261]].map(([x,y])=>`<path d="M${x} ${y}q-7-12-11-5q3 8 11 5q6-13 11-7q-2 7-11 7"/>`).join('')}</g>
    ${design.placed.includes('bench')?'<g data-decoration="bench" transform="translate(124 91)" stroke="#775d43" stroke-width="3" stroke-linecap="round"><path d="M-29-13H29V0H-29Z" fill="#d5ac76"/><path d="M-32 4H32V11H-32Z" fill="#d5ac76"/><path d="M-25 11v10m50-10v10M-25 0v4m50-4v4"/></g>':''}
    ${beds}
    ${design.placed.includes('butterflies')?`<g data-decoration="butterflies">${[[189,107],[282,191],[351,101]].map(([x,y],i)=>`<g transform="translate(${x} ${y}) rotate(${i*20-15})"><path d="M0 0Q-19-18-18-1Q-19 12 0 3Q19 12 18-1Q19-18 0 0" fill="#edbf76" stroke="#b88961" stroke-width="1.4"/><path d="M0-4V7" stroke="#6e5d59" stroke-width="2.5"/></g>`).join('')}</g>`:''}
    ${design.placed.includes('lantern')?`<g data-decoration="lantern" transform="translate(${lanternX} ${lanternY})"><circle cy="-18" r="25" fill="#fff1b5" opacity=".45"/><path d="M-2-39V16M-10 16H10M-10-35H10" stroke="#736851" stroke-width="4" stroke-linecap="round"/><rect x="-12" y="-32" width="24" height="25" rx="5" fill="#f3d68a" stroke="#8f7650" stroke-width="2"/><path d="M0-27v15" stroke="#fff6d2" stroke-width="5" stroke-linecap="round"/></g>`:''}
  </svg>`;
}
