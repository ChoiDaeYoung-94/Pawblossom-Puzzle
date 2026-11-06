import type {FlowerStyle,GardenDesign,GardenTheme} from './gardenDesign';

// 직접 작도한 SVG 원화입니다. 꽃밭의 기존480×280 좌표와 핍의 왼쪽 전경을 유지합니다.
const palettes:Record<GardenTheme,{sky:string;skyLight:string;hill:string;grass:string;grassLight:string;tree:string;treeLight:string;path:string}>={
  meadow:{sky:'#bfe9f4',skyLight:'#edf9f2',hill:'#b7d783',grass:'#a8cf75',grassLight:'#cee49a',tree:'#79b977',treeLight:'#a4d28b',path:'#f8dea5'},
  sunset:{sky:'#f8c3b3',skyLight:'#ffe8bf',hill:'#c9c183',grass:'#b9c879',grassLight:'#e0d89a',tree:'#94ad73',treeLight:'#bdc887',path:'#f7d19b'},
  starlight:{sky:'#4e507d',skyLight:'#8584ad',hill:'#7e9b8c',grass:'#819e83',grassLight:'#a6b99a',tree:'#6e8c83',treeLight:'#91aa94',path:'#ddd1b2'},
};
const ink='#6e5146';
const plots=[[158,153],[285,141],[413,153],[218,222],[351,222]] as const;
const lanternPositions=[[211,173],[338,161],[454,178],[270,244],[405,244]] as const;

function flower(style:FlowerStyle,color:string){
  const petals=style==='violet'
    ?`<path d="M0-3C-15 4-17-11-7-12C-14-24 1-28 5-17C15-25 24-11 12-7C25 3 9 13 4 3Z" fill="#b49ad8" stroke="${ink}" stroke-width="2"/><path d="M-3-5Q3 1 8-5" fill="none" stroke="#f9e3a1" stroke-width="2.8" stroke-linecap="round"/>`
    :`${Array.from({length:style==='daisy'?8:6},(_,i)=>`<ellipse cy="-6" rx="${style==='daisy'?3.4:5}" ry="${style==='daisy'?7.4:6.6}" fill="${style==='daisy'?'#fffdf0':color}" stroke="${ink}" stroke-width="1.6" transform="rotate(${i*(style==='daisy'?45:60)})"/>`).join('')}<circle r="4.8" fill="#f5c45e" stroke="${ink}" stroke-width="1.7"/>`;
  return `<path d="M0 11Q-3-4 0-22" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/><path d="M0 4Q-17-10-16 1Q-11 8 0 4M0-5Q16-18 15-6Q10 1 0-5" fill="#79b974" stroke="${ink}" stroke-width="1.8" stroke-linejoin="round"/><g transform="translate(0 -23)">${petals}</g>`;
}
function bed(){return `<g data-garden-layer="bed"><ellipse cy="24" rx="55" ry="9" fill="#506b43" opacity=".18"/><path d="M-56-5Q0-30 56-5L52 14Q0 35-52 14Z" fill="#dba765" stroke="${ink}" stroke-width="3.2" stroke-linejoin="round"/><ellipse cy="-3" rx="56" ry="17" fill="#f6ce87" stroke="${ink}" stroke-width="3.2"/><ellipse cy="-2" rx="47" ry="11" fill="#956749" stroke="${ink}" stroke-width="2.5"/><path d="M-35-1Q0-11 35-1M-31 5Q0-2 31 5" fill="none" stroke="#b98559" stroke-width="2.8" stroke-linecap="round"/></g>`;}
function backdrop(theme:GardenTheme){
  const p=palettes[theme];
  const sky=theme==='starlight'
    ?`<g data-sky="starlight"><path d="M389 19A22 22 0 1 0 407 53A23 23 0 0 1 389 19Z" fill="#fff0bc" stroke="${ink}" stroke-width="2.4"/>${[[124,32],[229,55],[300,23],[434,83],[348,62]].map(([x,y])=>`<path d="M${x} ${y-4}l2 3 4 1-4 2-2 4-1-4-4-2 4-1Z" fill="#fff2ca"/>`).join('')}</g>`
    :`<g${theme==='sunset'?' data-sky="sunset"':''}><circle cx="385" cy="44" r="23" fill="${theme==='sunset'?'#ffdd8c':'#fff1a6'}" stroke="${ink}" stroke-width="2.4"/><path d="M134 38h44m-33-8h17M270 60h47m-34-8h17" stroke="#fff7e8" stroke-width="8" stroke-linecap="round" opacity=".85"/></g>`;
  return `<defs><linearGradient id="garden-cartoon-sky" x2="0" y2="1"><stop stop-color="${p.sky}"/><stop offset="1" stop-color="${p.skyLight}"/></linearGradient><linearGradient id="garden-cartoon-grass" x2="0" y2="1"><stop stop-color="${p.grassLight}"/><stop offset="1" stop-color="${p.grass}"/></linearGradient></defs>
    <g data-garden-layer="backdrop"><rect width="480" height="280" fill="url(#garden-cartoon-sky)"/>${sky}<path d="M0 107Q65 53 153 99Q222 54 303 97Q399 56 480 98V280H0Z" fill="${p.hill}"/><path d="M0 131Q127 99 244 132Q366 105 480 125V280H0Z" fill="url(#garden-cartoon-grass)"/>
    <path d="M235 109Q280 139 257 176T287 280H228Q225 231 235 187T213 109Z" fill="${p.path}"/><path d="M243 121Q264 145 250 173" fill="none" stroke="#fff2d2" stroke-width="4" stroke-linecap="round"/>
    <g fill="#f8dfb1" stroke="${ink}" stroke-width="2.7" stroke-linejoin="round"><path d="M90 91H399V99H90ZM90 109H399V116H90Z"/>${[101,145,189,233,277,321,365,391].map(x=>`<path d="M${x} 123V84l6-7 6 7v39Z"/>`).join('')}</g>
    ${[[32,61,1],[452,59,1.1],[77,44,.7]].map(([x,y,s])=>`<g transform="translate(${x} ${y}) scale(${s})"><path d="M-6 20H7L10 69H-9Z" fill="#b98963" stroke="${ink}" stroke-width="2.8"/><path d="M-4 45l-13-9M4 32l11-8" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/><path d="M-31 12C-47-8-25-28-11-21C-4-47 27-37 28-18C50-13 44 18 28 21C15 38-14 33-24 23C-38 28-43 15-31 12Z" fill="${p.tree}" stroke="${ink}" stroke-width="2.8"/><path d="M-26 2Q-32-15-13-15Q-4-34 15-20" fill="none" stroke="${p.treeLight}" stroke-width="9" stroke-linecap="round"/></g>`).join('')}
    ${[[23,183],[453,213],[43,258],[419,266]].map(([x,y])=>`<path d="M${x-8} ${y+3}q-5-15 3-11l5 7q5-19 9-9q0 8-5 13Z" fill="${p.tree}" stroke="${ink}" stroke-width="1.6" stroke-linejoin="round"/>`).join('')}</g>`;
}
function bench(){return `<g data-decoration="bench" transform="translate(124 91)" fill="#dfab72" stroke="${ink}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M-30-15H30V0H-30Z"/><path d="M-34 5H34V13H-34Z"/><path d="M-26 13v11m52-11v11M-26 0v5m52-5v5M-22-9H22" fill="none"/></g>`;}
function butterflies(){return `<g data-decoration="butterflies">${[[189,107],[282,191],[351,101]].map(([x,y],i)=>`<g data-garden-vector-butterfly="true" transform="translate(${x} ${y}) rotate(${i*20-15})"><g class="garden-cartoon-wings" style="--garden-flutter-delay:${i*-.23}s"><path d="M0 0C-5-16-21-17-18-4C-28 4-13 13 0 3C12 13 28 4 18-4C21-17 5-16 0 0Z" fill="${i===1?'#c5a8e2':'#f7cb79'}" stroke="${ink}" stroke-width="2.3"/><path d="M-9-7l4 5m14-5-4 5" stroke="#fff0cc" stroke-width="2.6" stroke-linecap="round"/></g><path d="M0-4V7m0-10-4-4m4 4 4-4" fill="none" stroke="${ink}" stroke-width="2.8" stroke-linecap="round"/></g>`).join('')}</g>`;}
function lantern(plot:number|undefined){const [x,y]=lanternPositions[plot??-1]??[419,217];return `<g data-decoration="lantern" transform="translate(${x} ${y})"><circle cy="-19" r="25" fill="#ffedb2" opacity=".5"/><g stroke="${ink}" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round"><path d="M-2-40V17M-11 17H11" fill="none"/><path d="M-15-31-10-38H10l5 7Z" fill="#a7aaa1"/><rect x="-12" y="-31" width="24" height="25" rx="4" fill="#f9d681"/><path d="M0-27v16" stroke="#fff8da" stroke-width="5"/></g></g>`;}

/** 표시만 만들며 성장·소유·가격·저장 객체에는 관여하지 않습니다. */
export function cartoonGardenArt(stage:number,celebrate:boolean,design:GardenDesign):string {
  const colors=['#f5a6ad','#ffd68a','#d6b1e3','#f5b295','#e7add0'];
  const beds=plots.map(([x,y],i)=>`<g class="garden-plot" data-plot="${i}" data-flower="${design.flowers[i]}" data-planted="${i<stage}" transform="translate(${x} ${y})">${bed()}${i<stage?`<g class="plant-cluster ${celebrate&&i===stage-1?'new-patch':''}">${[[-28,-4],[-9,-14],[13,-12],[32,-2],[0,8]].map(([px,py],j)=>`<g data-garden-cartoon-flower="${design.flowers[i]}" transform="translate(${px} ${py}) scale(.82)">${flower(design.flowers[i],colors[(i+j%2)%5])}</g>`).join('')}</g><circle cx="44" cy="13" r="8" fill="#fff1b7" stroke="${ink}" stroke-width="1.7"/><path d="m40 13 3 3 5-6" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`:''}</g>`).join('');
  return `<svg class="garden-art" data-renderer="cartoon-v1" data-stage="${stage}" viewBox="0 0 480 280" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${backdrop(design.theme??'meadow')}${design.placed.includes('bench')?bench():''}${beds}${design.placed.includes('butterflies')?butterflies():''}${design.placed.includes('lantern')?lantern(design.lanternPlot):''}</svg>`;
}
