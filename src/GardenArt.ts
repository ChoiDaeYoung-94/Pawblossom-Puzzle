/** 저장된 꽃밭 수만큼만 꽃을 그리는 자체 제작 정원 그림입니다. */
export function gardenArt(value:number,celebrate=false):string {
  const stage=Number.isFinite(value)?Math.max(0,Math.min(5,Math.floor(value))):0;
  const plots=[[103,153],[242,141],[377,153],[171,222],[313,222]];
  const colors=['#e9a9b1','#efcd79','#b9add8','#e7afa0','#d7b1d1'];
  const plant=(x:number,y:number,color:string)=>`<g transform="translate(${x} ${y})"><path d="M0 1Q-2-11 0-27" fill="none" stroke="#668c5f" stroke-width="2.5"/><path d="M0-11Q-14-23-13-10Q-5-6 0-11M0-17Q13-27 12-15Q5-12 0-17" fill="#87ad74"/><g transform="translate(0 -28)">${[0,1,2,3,4].map(i=>`<ellipse cx="0" cy="-6" rx="4.4" ry="5.6" fill="${color}" transform="rotate(${i*72})"/>`).join('')}<circle r="3.5" fill="#fae8a1"/></g></g>`;
  const beds=plots.map(([x,y],i)=>{
    const planted=i<stage;
    return `<g class="garden-plot" data-planted="${planted}" transform="translate(${x} ${y})">
      <ellipse cy="20" rx="59" ry="13" fill="#486b44" opacity=".12"/>
      <path d="M-52-10Q0-32 52-10L58 12Q0 40-58 12Z" fill="#d1b387" stroke="#a6845e" stroke-width="2"/>
      <path d="M-49-8Q0-27 49-8L50 7Q0 29-50 7Z" fill="#967553"/>
      ${[-4,3,10].map(row=>`<path d="M-40 ${row}Q0 ${row+16} 40 ${row}" fill="none" stroke="#be9a70" stroke-width="2" opacity=".75"/>`).join('')}
      ${planted?`<g class="plant-cluster ${celebrate&&i===stage-1?'new-patch':''}">${[[-29,-6],[-7,-12],[16,-10],[35,-1],[-17,8],[13,11]].map(([px,py],j)=>plant(px,py,colors[(i+j%2)%5])).join('')}</g><circle cx="44" cy="13" r="8" fill="#ecf0d7"/><path d="m40 13 3 3 5-6" fill="none" stroke="#64865a" stroke-width="2" stroke-linecap="round"/>`:''}
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
    ${beds}
  </svg>`;
}
