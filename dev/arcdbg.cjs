// 찾은 호와 붙은 음 차례를 적는다: node arcdbg.cjs 이미지
const { load } = require('./dbg.cjs'); const OMR = require('../omr.js');
const r = OMR.recognize(load(process.argv[2]));
for (const a of r._A.arcs) console.log(`x ${a.xa}~${a.xb} (${((a.xb - a.xa) / 16).toFixed(1)}칸) y ${a.ya.toFixed(0)}→${a.yb.toFixed(0)} 휨 ${a.bow.toFixed(1)}  음 ${a.from}→${a.to}`);
