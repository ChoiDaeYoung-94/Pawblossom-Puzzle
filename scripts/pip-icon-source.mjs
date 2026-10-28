import {createHash} from 'node:crypto';

export const pipSpecPath='assets/branding/pip-icon-v2.json';
export const pipSourcePath='assets/branding/pip-icon-source-v2.png';
export const pipLayerPaths=Object.fromEntries(['foreground','background','legacy','round'].map(kind=>[kind,`android/app/src/main/res/drawable-nodpi/pip_icon_${kind}_v2.png`]));
export const hash=data=>createHash('sha256').update(data).digest('hex');
const requireThat=(condition,message)=>{if(!condition)throw Error(message);};

export function validatePipSpec(spec){
  requireThat(spec.schemaVersion===2&&spec.status==='draft','pip spec version/status');
  requireThat(spec.source?.path===pipSourcePath&&spec.source.width===1254&&spec.source.height===1254&&spec.source.bytes===1261319&&/^[a-f0-9]{64}$/.test(spec.source.sha256),'pip source specification');
  requireThat(['light','middle','outer'].every(k=>/^#[a-f0-9]{6}$/i.test(spec.palette?.[k])),'pip palette');
  requireThat(spec.native?.canvas===432&&spec.native.viewportDp===108&&spec.native.targetRadiusDp===32&&spec.native.maximumRadiusDp===33&&spec.native.removeExactAlpha===1&&spec.native.removedPixels===12549,'pip native layout');
  requireThat(spec.store?.canvas===512&&spec.store.inset===16,'pip store layout');
}

/** native 파생에만 적용합니다. 입력/색/RGBA>=2와 원본 PNG는 보존합니다. */
export function normalizeNative(image){
  requireThat(image.channels===4&&image.pixels.length===image.width*image.height*4,'pip source RGBA');
  const pixels=Buffer.from(image.pixels);let removedPixels=0;
  for(let i=3;i<pixels.length;i+=4)if(pixels[i]===1){pixels[i]=0;removedPixels++;}
  return {...image,pixels,removedPixels};
}

/** 중심점이 아니라 alpha>0 픽셀의 네 셀 모서리까지 포함합니다. */
export function maximumAlphaRadius(image){
  requireThat(image.channels===4&&image.pixels.length===image.width*image.height*4,'pip RGBA dimensions');
  let radius=0,count=0;const cx=image.width/2,cy=image.height/2;
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)if(image.pixels[(y*image.width+x)*4+3]){
    count++;radius=Math.max(radius,Math.hypot(Math.max(Math.abs(x-cx),Math.abs(x+1-cx)),Math.max(Math.abs(y-cy),Math.abs(y+1-cy))));
  }
  requireThat(count>0,'pip empty foreground');return radius;
}

export function nativeLayout(spec,image){
  const radius=maximumAlphaRadius(image),side=Math.floor(image.width*(spec.native.canvas/spec.native.viewportDp)*spec.native.targetRadiusDp/radius);
  requireThat(side>0&&side<=spec.native.canvas,'pip packing size');
  return {side,left:Math.floor((spec.native.canvas-side)/2),top:Math.floor((spec.native.canvas-side)/2)};
}

export function backgroundSvg(spec,size=512){
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512"><defs><radialGradient id="light" cx="50%" cy="42%" r="60%"><stop stop-color="${spec.palette.light}"/><stop offset=".55" stop-color="${spec.palette.middle}"/><stop offset="1" stop-color="${spec.palette.outer}"/></radialGradient></defs><rect width="512" height="512" fill="url(#light)"/></svg>\n`;
}

export function pipStoreSvg(spec,source){
  const bg=Buffer.from(backgroundSvg(spec)).toString('base64'),inset=spec.store.inset;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><image width="512" height="512" href="data:image/svg+xml;base64,${bg}"/><image x="${inset}" y="${inset}" width="${512-2*inset}" height="${512-2*inset}" href="data:image/png;base64,${source.toString('base64')}"/></svg>\n`;
}

export function pipLauncherXml(){
  const bitmap=name=>`<bitmap xmlns:android="http://schemas.android.com/apk/res/android" android:src="@drawable/pip_icon_${name}_v2" android:gravity="fill" android:filter="true"/>`;
  const files={'drawable/pawblossom_foreground.xml':bitmap('foreground'),'drawable/pawblossom_icon.xml':bitmap('legacy'),'mipmap-anydpi/ic_launcher.xml':bitmap('legacy'),'mipmap-anydpi/ic_launcher_round.xml':bitmap('round')};
  for(const [qualifier,mono] of [['v26',false],['v33',true]])for(const name of ['ic_launcher','ic_launcher_round'])files[`mipmap-anydpi-${qualifier}/${name}.xml`]=`<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@drawable/pip_icon_background_v2"/>\n    <foreground android:drawable="@drawable/pawblossom_foreground"/>${mono?'\n    <monochrome android:drawable="@drawable/pawblossom_monochrome"/>':''}\n</adaptive-icon>`;
  return files;
}

export function pipPreviewSvg(store,native){
  const picture=(id,data)=>`<image id="${id}" width="512" height="512" href="data:image/png;base64,${data.toString('base64')}"/>`;
  const use=(id,x,y,size,mask='')=>`<g transform="translate(${x} ${y}) scale(${size/512})"${mask?` clip-path="url(#${mask})"`:''}><use href="#${id}"/></g>`;
  let rows='';for(const [y,dark]of[[550,false],[670,true]])for(const [x,size]of[[20,48],[420,32]])rows+=`<rect x="${x-8}" y="${y-8}" width="210" height="${size+16}" fill="${dark?'#222832':'#FFF'}"/>`+use('store',x,y,size)+use('native',x+70,y,size,'circle')+use('native',x+140,y,size,'round');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="832" height="744"><rect width="832" height="744" fill="#FFF"/><defs>${picture('store',store)}${picture('native',native)}<clipPath id="circle"><circle cx="256" cy="256" r="256"/></clipPath><clipPath id="round"><rect width="512" height="512" rx="154"/></clipPath></defs><g font-family="sans-serif" fill="#342d3b" font-size="18"><text x="20" y="28">Store square / Android circle</text><text x="20" y="526">48px store / circle / rounded square</text><text x="420" y="526">32px store / circle / rounded square</text></g>${use('store',20,44,384)}${use('native',430,44,384,'circle')}${rows}</svg>\n`;
}
