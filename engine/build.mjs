// 엔진 소스 네 토막을 차례로 이어 저장소 맨 위의 omr.js 한 파일로 만든다: node engine/build.mjs
import fs from 'fs';
import { execFileSync } from 'child_process';
const here = new URL('.', import.meta.url);
const parts = ['a_pre.js', 'b_core.js', 'c_score.js', 'z_end.js'];
const out = new URL('../omr.js', here);
fs.writeFileSync(out, parts.map(f => fs.readFileSync(new URL('src/' + f, here), 'utf8')).join(''));
execFileSync(process.execPath, ['--check', decodeURIComponent(out.pathname).replace(/^\/([A-Za-z]:)/, '$1')], { stdio: 'inherit' });
console.log('omr.js', fs.statSync(out).size + '바이트');
