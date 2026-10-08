// Original Allworld app artwork. Render once to a WebP atlas, never at game startup.
// Pass an installed sharp package path, or use a locally available sharp package.
import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url);
const sharp=require(process.argv[2] || 'sharp');
/** @type {(x:number,y:number,w:number,h:number,fill:string,r?:number)=>string} */
const rect=(x,y,w,h,fill,r=5)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;
/** @type {(x:number,y:number,r:number,fill:string)=>string} */
const circle=(x,y,r,fill)=>`<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;
/** @type {(d:string,fill:string)=>string} */
const path=(d,fill)=>`<path d="${d}" fill="${fill}"/>`;
/** @type {(d:string,color?:string,width?:number)=>string} */
const line=(d,color='#fff',width=5)=>`<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const paper=()=>rect(27,17,50,66,'#ffffff',6)+rect(23,21,50,66,'#eff4fa',6);
/** @type {(fill:string)=>string} */
const heart=(fill)=>path('M50 76C38 66 23 56 23 41C23 23 45 22 50 35C55 22 77 23 77 41C77 56 62 66 50 76Z',fill);
const home=(x=23,y=27,color='#fff')=>path(`M${x} ${y+25}L${x+27} ${y}L${x+54} ${y+25}V${y+52}H${x}Z`,color)+rect(x+22,y+31,13,21,'#eaae50',2)+rect(x+8,y+30,9,10,'#89ccdd',2);
const brief=(color='#f7f5ed')=>line('M38 30V24Q38 18 44 18H57Q63 18 63 24V30',color,7)+rect(18,29,64,47,color,8)+path('M18 46Q50 63 82 46V56Q50 69 18 56Z','#b0bfd2')+rect(45,46,11,15,'#dba84d',3);
/** @type {(colors?: [string,string,string])=>string} */
const people=(colors=['#f8d28c','#fff','#edb29e'])=>circle(32,37,12,colors[0])+circle(66,38,12,colors[2])+path('M12 75V66Q12 48 32 48Q49 49 49 67V75Z',colors[0])+path('M51 75V66Q51 48 68 49Q87 50 87 67V75Z',colors[2])+circle(50,33,13,colors[1])+path('M29 79V65Q29 47 50 47Q71 47 71 65V79Z',colors[1]);
const gear=()=>path('M42 16H58L61 26L70 31L80 29L88 43L81 51L80 60L86 69L76 82L65 79L57 83L53 93H37L34 83L25 78L15 80L7 66L14 58L15 49L9 40L19 27L30 30L38 26Z','#d3dce5')+circle(47,55,25,'#718093')+circle(47,55,18,'#e3eaf1')+circle(47,55,10,'#47576d');
/** @type {Array<[string,string,string,string]>} */
const icons=[
 ['messages','#65df6c','#12a849',path('M21 25Q15 25 15 35V61Q15 72 27 72H35L29 83L51 72H74Q86 72 86 61V35Q86 25 74 25Z','#fff')+circle(34,48,4,'#29b75a')+circle(50,48,4,'#29b75a')+circle(66,48,4,'#29b75a')],
 ['jobs','#50a4fa','#235edb',brief()],
 ['bank','#53cbbc','#087973',path('M17 36L50 16L83 36Z','#fff')+rect(17,76,66,8,'#fff',2)+rect(22,40,11,33,'#d5f4e9',2)+rect(44,40,11,33,'#fff',2)+rect(67,40,11,33,'#d5f4e9',2)+circle(50,29,4,'#c2a25d')],
 ['ride','#ffe275','#ecab25',rect(23,16,55,66,'#ffd14a',10)+rect(28,25,45,24,'#193b4b',5)+line('M51 26V47','#8ccfd5',2)+rect(22,54,57,6,'#283c49',0)+rect(29,65,12,6,'#fff4bd',2)+rect(60,65,12,6,'#fff4bd',2)+rect(28,80,9,7,'#253039',2)+rect(64,80,9,7,'#253039',2)],
 ['missions','#a4e89e','#3b9767',paper()+rect(39,15,27,12,'#2d6e50',5)+line('M34 43l5 5 9-10','#32a56d',5)+line('M54 43h10M34 61h29M34 71h18','#99b4a7',4)],
 ['groceries','#b3da53','#4f9b30',circle(39,36,12,'#ee624e')+path('M60 49Q52 14 72 15Q85 19 67 50Z','#f1cb83')+path('M31 42L36 81H72L80 42Z','#fff8df')+line('M39 46Q41 30 55 29Q68 28 73 44','#35653c',5)+line('M45 56v15M57 56v15M69 56v15','#c5bc90',4)],
 ['health','#fff8f5','#e8eef5',heart('#f2556b')+line('M30 52h10l7-14 8 26 7-13h10','#fff',4)],
 ['houses','#ffc778','#e38242',home()+path('M17 51L50 20L84 51L77 58L50 33L24 59Z','#a94734')],
 ['land','#dceec5','#95c693',path('M16 51L51 32L86 51L50 74Z','#487d51')+path('M16 51V62L50 86V74Z','#c99555')+path('M50 74L86 51V63L50 86Z','#947342')+line('M35 61l33-18M36 40l32 21','#d9efd2',2)+line('M53 49V20','#fff',4)+path('M54 20H76L68 29H54Z','#ed6547')],
 ['neighbourhood','#8cd7f2','#338fae',rect(17,45,22,35,'#f8e4b8',3)+path('M13 45l15-14 16 14Z','#dc8260')+rect(42,22,24,58,'#f1f4ee',3)+rect(68,39,18,41,'#bedcd6',3)+rect(48,30,5,8,'#70a9c2',1)+rect(57,30,5,8,'#70a9c2',1)+rect(48,44,5,8,'#70a9c2',1)+rect(57,44,5,8,'#70a9c2',1)+path('M17 86L90 77L90 84L17 94Z','#255f7c')],
 ['goals','#ffa87a','#ec6749',circle(50,51,31,'#fff0db')+circle(50,51,23,'#eb7158')+circle(50,51,15,'#fff0db')+circle(50,51,7,'#df5945')+line('M51 50L76 24','#4b4557',5)+path('M72 22L86 16L81 31L75 28Z','#fff')],
 ['boutique','#f9a1c2','#d7558d',path('M31 26L16 38L25 53L34 47L31 82H72L67 47L78 53L86 37L68 26Q60 41 50 41Q39 41 31 26Z','#ffedf2')+path('M34 51Q48 59 69 51L72 82H31Z','#f6c4d8')+line('M34 26Q51 43 68 26','#c55188',3)],
 ['cars','#bed2e8','#687d99',path('M21 53L31 32Q50 22 71 32L81 53L87 58V75H15V59Z','#f1f5fb')+path('M33 36H67L74 51H26Z','#244559')+rect(17,62,17,7,'#b6dff3',3)+rect(68,62,17,7,'#b6dff3',3)+rect(19,73,11,11,'#263443',3)+rect(71,73,11,11,'#263443',3)+rect(41,64,19,6,'#6c8197',3)],
 ['stories','#b9a0eb','#7561b3',rect(20,23,61,58,'#f7eed5',5)+path('M24 26H48V80H24Q38 57 24 26Z','#ce5269')+path('M53 26H78Q62 58 78 80H53Z','#aa405b')+path('M51 34L55 45L67 45L57 52L61 64L51 57L41 64L45 52L35 45L47 45Z','#ffe09b')],
 ['capture','#e0e8ee','#9daebd',rect(15,29,70,48,'#3c4753',10)+path('M29 29L35 20H55L62 29Z','#657582')+circle(50,54,22,'#aab9c4')+circle(50,54,17,'#17283e')+circle(50,54,12,'#316394')+circle(46,50,6,'#72c5dd')+circle(56,60,4,'#15283d')+rect(70,36,8,5,'#fbf1ce',2)],
 ['settings','#dce4ea','#91a0b3',`<g transform="translate(6 -4) scale(.94)">${gear()}</g>`],
 ['touch','#cbb4ef','#8064b4',path('M28 66V43Q28 25 48 23V17H55V24Q75 28 75 45V66L83 74H20Z','#fff6df')+path('M39 80Q52 93 64 80Z','#ffcb69')+circle(75,25,10,'#ff846e')],
 ['help','#72d5f3','#2b99d0',circle(50,50,31,'#f5fcff')+path('M39 39Q40 25 53 28Q70 32 61 46L53 54V60H46V51Q64 38 54 35Q45 32 45 40Z','#318ec0')+circle(50,70,4,'#318ec0')],
 ['business','#f6c48e','#bd8151',rect(24,42,54,39,'#f6e9d6',3)+rect(54,56,17,25,'#3d6672',2)+rect(31,55,15,12,'#82bdd0',2)+path('M20 27H81L87 45H14Z','#f7f0df')+path('M22 27H33L30 45H17ZM45 27H57V45H43ZM70 27H80L86 45H72Z','#db654f')+path('M14 45H87V49Q80 59 73 49Q65 59 58 49Q50 59 43 49Q35 59 28 49Q20 59 14 49Z','#d35b47')],
 ['commerce','#e9c6f6','#b983cb',rect(23,32,55,51,'#fff3d8',8)+line('M37 37V27Q50 10 65 27V37','#82609c',6)+path('M42 57L51 47L61 57L51 71Z','#b57eb8')],
 ['statement','#edf0f5','#acbfd3',paper()+rect(31,31,33,7,'#61a9b8',2)+line('M33 47h25M33 59h21M33 71h13','#98aabc',4)+circle(70,73,14,'#eac16b')+line('M65 73l4 4 8-9','#fff',3)],
 ['richlist','#ffe6a0','#d8ac42',path('M35 23H67V42Q67 63 51 66Q35 64 35 42Z','#fff1a8')+line('M34 28H21V36Q21 52 36 52M68 28H81V36Q81 52 66 52','#ca9035',6)+rect(47,63,9,13,'#f9d775',2)+rect(32,77,40,8,'#fff0b0',3)+path('M51 29L55 38L65 38L57 44L60 54L51 48L43 54L46 44L38 38L48 38Z','#d29938')],
 ['invest','#90dcc4','#3ba17f',rect(19,58,15,25,'#dbf3df',3)+rect(42,45,15,38,'#ecf6de',3)+rect(65,29,15,54,'#faffed',3)+line('M21 45L41 30L53 36L78 16','#fff3b8',5)+path('M64 16H80V31Z','#fff3b8')],
 ['career','#83c6fa','#3f7dcc',path('M18 81H36V63H54V46H72V27H84V84H18Z','#dceafb')+line('M24 57L68 15M52 15h17v17','#fff2c3',6)],
 ['contacts','#f3c7a5','#c98f66',rect(23,17,58,68,'#fff1d7',7)+rect(23,17,10,68,'#ba8564',3)+circle(55,42,12,'#d19c77')+path('M38 73V67Q40 54 55 55Q69 55 73 68V73Z','#d19c77')+rect(78,27,8,13,'#e89076',2)+rect(78,44,8,13,'#f4ca79',2)+rect(78,61,8,13,'#83baba',2)],
 ['family','#f1b8c6','#ca718b',people()],
 ['invite','#ffd58f','#e79c4b',rect(17,29,66,47,'#fff4dc',7)+path('M17 32L50 57L83 32Z','#efc795')+line('M18 75L40 55M82 75L61 55','#d29c6d',2)+circle(76,24,13,'#e66d56')+line('M76 17v14M69 24h14','#fff',4)],
 ['refer','#b7dbfb','#609bcf',people(['#b7d6f6','#fff','#a8c5e2'])+circle(77,75,14,'#3a9669')+line('M77 68v14M70 75h14','#fff',4)],
 ['people','#c9baff','#7c70c5',people(['#e1c2fb','#fff','#d1d6f8'])],
 ['governor','#a9d5bb','#3a8566',path('M16 34L50 16L84 34Z','#f7edd6')+rect(20,36,60,6,'#e1d0aa',2)+rect(23,44,10,32,'#fff4da',1)+rect(45,44,10,32,'#fff4da',1)+rect(67,44,10,32,'#fff4da',1)+rect(16,78,68,8,'#eee0bc',2)],
 ['events','#ffb4a2','#e37365',rect(21,23,60,62,'#fff8ee',8)+path('M21 31Q21 23 29 23H73Q81 23 81 31V42H21Z','#d95354')+line('M34 18v14M68 18v14','#f6ddd2',5)+rect(32,52,12,11,'#eadbca',2)+rect(50,52,12,11,'#eadbca',2)+rect(32,69,12,9,'#eadbca',2)+circle(68,73,12,'#e48255')],
 ['politics','#b7d8d4','#508681',rect(20,44,64,37,'#e7ece2',6)+path('M19 44L31 34H72L84 44Z','#bdd3c9')+rect(36,40,33,5,'#345f5b',2)+`<g transform="rotate(-15 49 32)">${rect(36,14,28,31,'#fff5d9',3)+line('M42 29l5 5 10-12','#d28649',4)}</g>`],
 ['neighbours','#a9dfd1','#57a48c',`<g transform="translate(-6 5) scale(.78)">${home(23,27,'#fff2d6')}</g><g transform="translate(32 13) scale(.62)">${home(23,27,'#def1e7')}</g>`],
 ['tables','#89d0cb','#318c85',rect(19,25,53,62,'#eee8d9',7)+`<g transform="rotate(14 59 48)">${rect(34,16,51,65,'#fff9ed',7)+heart('#dc695d')}</g>`],
 ['games','#bca4e8','#8065ba',path('M28 35Q50 28 74 35L84 69Q84 83 70 75L61 65H41L30 77Q16 86 17 70Z','#f8f1ff')+line('M34 43v17M26 51h17','#827493',5)+circle(65,48,4,'#e87891')+circle(73,57,4,'#b399d1')],
 ['ads','#b8a9e2','#756799',rect(14,22,73,47,'#f0dfaf',6)+rect(21,30,59,31,'#9bc8bf',3)+path('M24 59L41 38L51 48L61 34L79 59Z','#4f907f')+circle(66,38,6,'#ffdf85')+rect(28,69,7,16,'#e6d6b7',1)+rect(66,69,7,16,'#e6d6b7',1)],
 ['hunt-sheet','#8fe0ee','#35a2b8',path('M20 37L35 21H68L83 38L50 82Z','#c9f7f1')+path('M20 37H83L50 82Z','#64cbd2')+path('M35 21L40 37H63L68 21Z','#effff1')+path('M40 37L50 82L63 37Z','#a6eeed')+line('M77 17v12M71 23h12','#fff4bf',3)],
 ['radio','#9fb5c4','#516678',rect(16,33,69,46,'#e7e1d4',9)+line('M29 32L70 15','#e2e7ed',4)+circle(37,56,15,'#465869')+circle(37,56,10,'#6e8492')+rect(58,44,19,6,'#bcc9bd',2)+circle(66,63,7,'#b69159')],
 ['campus','#bd7792','#7b3c65',path('M10 40L50 20L90 40L50 60Z','#fff2db')+path('M26 52V70Q51 85 74 70V52L50 64Z','#dfceb6')+line('M84 42v24','#ffd66f',4)+circle(84,70,5,'#ffd66f')],
 ['support','#ffbb8d','#db7659',circle(50,51,32,'#fff5e4')+circle(50,51,16,'#b86e58')+path('M22 34L31 25L41 38L30 47ZM61 26L77 37L66 47L57 36ZM21 68L34 80L43 65L33 57ZM66 58L78 68L65 80L56 67Z','#e98465')],
 ['community','#99dfe1','#48a9b1',path('M14 24H67V63H34L19 74V63H14Z','#d2f4ed')+path('M40 43H87V77H79V85L66 77H40Z','#fff9dc')+circle(50,60,3,'#66aaa7')+circle(63,60,3,'#66aaa7')+circle(76,60,3,'#66aaa7')],
 ['admin','#a3b7c9','#52687e',path('M50 16L80 29V49Q78 73 50 87Q22 73 20 49V29Z','#e6eced')+path('M50 24L72 33V49Q70 65 50 77Z','#bacbd2')+line('M36 49l10 10 20-23','#516f86',7)],
];
if(icons.length!==42)throw Error('Expected 42 distinct phone apps, got '+icons.length);
const ids=icons.map(i=>i[0]);if(new Set(ids).size!==ids.length)throw Error('Duplicate app artwork');
let defs='<filter id="shadow" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="3" stdDeviation="2" flood-color="#172c3d" flood-opacity=".18"/></filter>';
let tiles='';
for(const [i,[,top,bottom,drawing]] of icons.entries()){
 defs+=`<linearGradient id="b${i}" x2=".25" y2="1"><stop stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient><clipPath id="c${i}"><rect width="100" height="100" rx="23"/></clipPath>`;
 tiles+=`<g transform="translate(${i%7*128} ${Math.floor(i/7)*128}) scale(1.28)"><g clip-path="url(#c${i})">${rect(0,0,100,100,`url(#b${i})`,23)}<path d="M0 0H100V33Q48 16 0 36Z" fill="#fff" opacity=".09"/><g filter="url(#shadow)">${drawing}</g><rect x=".7" y=".7" width="98.6" height="98.6" rx="22.3" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="1.4"/></g></g>`;
}
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="896" height="768" viewBox="0 0 896 768"><defs>${defs}</defs>${tiles}</svg>`;
await sharp(Buffer.from(svg)).webp({quality:92,alphaQuality:100,effort:6}).toFile(resolve('src/ui/phone/app-icons.webp'));
writeFileSync(resolve('src/ui/phone/appArtwork.ts'),`// Generated by scripts/phone/build-icons.mjs. Original Allworld artwork.\nexport const PHONE_ART: readonly string[] = ${JSON.stringify(ids)}\nexport const PHONE_ART_COLUMNS = 7\nexport const PHONE_ART_ROWS = 6\n`);
console.log('Rendered 42 original phone app icons to one lazy WebP atlas.');
