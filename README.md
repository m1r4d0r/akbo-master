# 악보 읽기 · 가락 듣기

악보 사진을 넣으면 음표를 읽어 글자 악보로 바꾸고, 계이름을 보여 주고, 소리로 들려주는 웹 페이지입니다.
서버 없이 브라우저 안에서만 돌아갑니다. 사진은 어디로도 보내지 않습니다.

- 읽기: 오선·음자리표·조표·박자표, 음표와 쉼표의 길이, 점, 임시표, 붙임줄·이음줄, 마디줄·도돌이·1번 2번 괄호, 한 오선의 두 성부와 겹음, 묶인 여러 오선(높은음자리표 + 낮은음자리표)
- 듣기: 계이름(이동도) 표시, 빠르기·옥타브·조옮김, 고른 음부터 재생, 되풀이, 성부별 끄기
- 고치기: 음을 끌어 높이 바꾸기, 길이·점·임시표·쉼표·줄·겹음, 마디줄·도돌이·괄호·박자·조표
- 내보내기: MusicXML, MIDI, 인쇄, 글자 악보

## 바로 쓰기

`index.html`을 브라우저로 엽니다. GitHub Pages를 켜면 저장소 주소로도 열립니다(맨 위 폴더가 그대로 사이트입니다).

## 파일

| 파일 | 하는 일 |
|---|---|
| `index.html` `style.css` `app.js` | 페이지(악보 그리기, 재생, 고치기) |
| `export.js` | MusicXML·MIDI 내보내기 |
| `omr.js` | 악보 인식 엔진. `engine/src`를 이어 붙여 만든 파일이므로 직접 고치지 않습니다 |
| `engine/src/` | 엔진 소스 네 토막(전처리 → 기호 찾기 → 악보 엮기 → 내보내는 이름) |
| `engine/build.mjs` | 소스를 `omr.js`로 합치는 스크립트 |
| `dev/` | 시험 도구(시험 악보 만들기, 채점, 페이지 시험) |

## 엔진만 가져다 쓰기

`omr.js` 한 파일이면 됩니다. 다른 파일에 기대지 않습니다.

브라우저에서는 전역 `OMR`이 생깁니다.

```html
<script src="omr.js"></script>
<script>
  // img: 다 불러온 <img>, 또는 캔버스에 그릴 수 있는 어떤 그림이든
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth; cv.height = img.naturalHeight;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const res = OMR.recognize(ctx.getImageData(0, 0, cv.width, cv.height));
  if (res.error) console.log(res.error);
  else console.log(OMR.toText(res, { title: '제목' }));
</script>
```

Node에서는 `require`로 부릅니다. 넘기는 것은 `{ width, height, data }`이고 `data`는 RGBA 바이트 배열입니다.

```js
const OMR = require('./omr.js');
const { PNG } = require('pngjs');
const png = PNG.sync.read(require('fs').readFileSync('score.png'));
const res = OMR.recognize({ width: png.width, height: png.height, data: png.data });
```

`recognize`가 돌려주는 것:

| 이름 | 내용 |
|---|---|
| `error` | 오선을 못 찾았을 때만 있음. 이때 다른 값은 없음 |
| `meter` | 박자 `[6, 8]` |
| `fifths` | 조표. 올림표 수는 양수, 내림표 수는 음수 |
| `spacing` | 원본 사진의 오선 간격(픽셀). 10 아래면 틀린 곳이 늘어남 |
| `parts[]` | 성부. `clef`(`'G'` 또는 `'F'`)와 `bars[]` |
| `bars[].ev[]` | 음표 `{ s, alt, d, tie }`, 겹음 `{ chord: [{ s, alt }], d, tie }`, 쉼표 `{ rest: true, d }` |
| `bars[]`의 나머지 | `repStart` `repEnd` `ending`(1·2번 괄호) `final`, `fixed`(박자에 맞추려고 엔진이 고친 내용) |

`s`는 가온 다(C4)를 0으로 한 온음계 자리(레 = 1, 한 옥타브 위 다 = 7), `alt`는 조표까지 넣은 실제 반음 올림(+1)·내림(−1), `d`는 4분음표를 1로 한 길이입니다.

`OMR.toText(res, { title })`는 아래 글자 악보를 돌려줍니다.

## 글자 악보

```
제목 시험
박자 3/4
조표 #1
빠르기 100
성부 1
|: 솔 라/ 시/ 도' | [1 레'2. :| [2 레'2 쉼 ||
성부 2
음자리표 낮은
도,2 솔,, | ...
```

- 계이름은 조표 기준 이동도. `'`는 한 옥타브 위, `,`는 아래
- 길이: 숫자는 박 수(`도2` `도1.5`), `/`는 8분, `//`는 16분, 아무것도 없으면 4분
- `#` `b`는 임시표, `+`는 겹음(`도+미`), `~`는 다음 음과 잇기(높이가 같으면 붙임줄, 다르면 이음줄), `쉼`은 쉼표
- `|` 마디줄, `|:` `:|` 도돌이, `[1` `[2` 괄호, `||` 끝

## 엔진 고치기

`engine/src`의 파일을 고친 뒤 합칩니다.

```
node engine/build.mjs
```

## 시험

`dev` 폴더에서 합니다. Node와, 사진처럼 망가뜨리는 묶음을 만들 때는 Python(opencv-python, pillow)이 필요합니다.

```
cd dev
npm install
npx playwright install chromium
sh mkall.sh        # 정답 있는 시험 악보 만들기 (cases/ 아래, 저장소에는 넣지 않음)
sh all.sh          # 묶음별 정확도
node score.cjs cases/A -v     # 한 묶음을 악보별로
node viz.cjs 그림.png 결과.png  # 검출 결과를 그림 위에 겹쳐 보기
node pagetest/smoke.mjs       # 페이지 시험
```

크롬을 따로 지정하려면 `CHROME` 환경 변수에 실행 파일 경로를 넣습니다.

정답 있는 시험 악보로 잰 토큰 정확도(2026-11-20):

| 묶음 | 정확도 |
|---|---|
| 한 줄 가락 | 98.1% |
| 두 오선 | 99.4% |
| 한 오선 두 성부 | 98.9% |
| 가사·코드 이름이 있는 노래 악보 | 99.3% |
| 합창 악보(두 성부 + 낮은음자리표) | 97.8% |
| 머리가 큰 악보체 | 96.1% |
| 같은 악보체를 오선 간격 6~7픽셀로 줄인 것 | 92.6% |
| 사진처럼 망가뜨린 것: 가볍게 / 보통 / 심하게 | 97.7% / 88.7% / 40.5% |

## 한계

- 오선 간격이 10픽셀 아래인 작은 그림, 심하게 구겨지거나 어두운 사진은 많이 틀립니다.
- 셋잇단음표, 꾸밈음, 겹점, 한 곡 안에서 바뀌는 박자·조표·음자리표는 읽지 않습니다.
- 가사와 코드 이름은 읽지 않고 걸러 냅니다.

## 만든 것과 빌린 것

- 페이지와 엔진은 모두 새로 쓴 코드이고, 배포 파일에 다른 라이브러리가 들어 있지 않습니다.
- `dev`의 시험 도구만 Verovio(LGPL), Playwright, pngjs, OpenCV, Pillow를 씁니다.
- 글꼴 고운바탕(OFL)은 Google Fonts에서 불러옵니다.
- 페이지를 처음 열 때 나오는 예시 가락은 「아름다운 것들」입니다. 저장소를 공개로 둘 때는 다른 가락으로 바꾸는 편이 안전합니다.
