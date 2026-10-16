import fs from 'node:fs';
import path from 'node:path';

// 기존 자체 발바닥·꽃 도형의 단일 원본에서 Android XML과 검수용 SVG를 만듭니다.
const mark=JSON.parse(fs.readFileSync('assets/branding/pawblossom-mark.json','utf8'));
const res='android/app/src/main/res',preview='assets/branding';
const checking=process.argv.includes('--check');
const write=(file,content)=>{
  if(file.endsWith('.xml')){
    const note='<!-- scripts/generate-launcher-assets.mjs에서 생성합니다. -->';
    content=content.startsWith('<?xml')?content.replace('?>','?>\n'+note):note+'\n'+content;
  }
  const output=content+'\n';
  if(checking){
    if(!fs.existsSync(file)||fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n')!==output)throw Error(`원본과 생성 파일이 다릅니다: ${file}`);
  }else{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,output);}
};
if(mark.viewport!==108||mark.paths.some(p=>!/^#[0-9A-F]{6}$/i.test(p.fill)||!/^[\d.,\sA-Za-z+-]+$/.test(p.path)))throw Error('지원하지 않는 도형 원본입니다.');
const xmlPaths=monochrome=>mark.paths.map(p=>`    <path android:fillColor="${monochrome?'#FFFFFF':p.fill}" android:pathData="${p.path}"/>`).join('\n');
const rect=`    <path android:fillColor="${mark.background}" android:pathData="M0,0H108V108H0Z"/>`;
const circle=`    <path android:fillColor="${mark.background}" android:pathData="M0,54A54,54 0,1 0,108 54A54,54 0,1 0,0 54Z"/>`;
function vector(background='',scale=mark.adaptiveScale,monochrome=false){
  return `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">
${background}
    <group android:pivotX="54" android:pivotY="54" android:scaleX="${scale}" android:scaleY="${scale}">
${xmlPaths(monochrome)}
    </group>
</vector>`;
}
write(`${res}/drawable/pawblossom_foreground.xml`,vector());
write(`${res}/drawable/pawblossom_monochrome.xml`,vector('',mark.adaptiveScale,true));
write(`${res}/drawable/pawblossom_icon.xml`,vector(rect,mark.legacyScale));
write(`${res}/mipmap-anydpi/ic_launcher.xml`,vector(rect,mark.legacyScale));
write(`${res}/mipmap-anydpi/ic_launcher_round.xml`,vector(circle,mark.legacyScale));
for(const [qualifier,mono] of [['v26',false],['v33',true]]){
  const adaptive=`<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@drawable/pawblossom_foreground"/>${mono?'\n    <monochrome android:drawable="@drawable/pawblossom_monochrome"/>':''}
</adaptive-icon>`;
  for(const name of ['ic_launcher','ic_launcher_round'])write(`${res}/mipmap-anydpi-${qualifier}/${name}.xml`,adaptive);
}
write(`${res}/values/ic_launcher_background.xml`,`<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="ic_launcher_background">${mark.background}</color></resources>`);
function svg(background,monochrome=false){
  return `<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108" viewBox="0 0 108 108">${background?`<rect width="108" height="108" fill="${mark.background}"/>`:''}<g transform="translate(54 54) scale(${mark.adaptiveScale}) translate(-54 -54)">${mark.paths.map(p=>`<path fill="${monochrome?'#FFFFFF':p.fill}" d="${p.path}"/>`).join('')}</g></svg>`;
}
write(`${preview}/pawblossom-color.svg`,svg(true));
write(`${preview}/pawblossom-foreground.svg`,svg(false));
write(`${preview}/pawblossom-monochrome.svg`,svg(false,true));
console.log(checking?'아이콘 생성 파일이 원본과 일치합니다.':'Android 적응형·단색·기존 아이콘과 검수용 SVG를 재생성했습니다.');
