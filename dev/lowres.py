# 큰 머리 묶음(KH)의 큰 그림을 오선 간격 6~7픽셀로 줄여 KL 묶음을 만든다(작게 저장된 악보 그림 흉내)
import glob, os, shutil, json
from PIL import Image
os.makedirs('cases/KL', exist_ok=True)
n = 0
for f in sorted(glob.glob('cases/KH/*.png')):
    name = os.path.basename(f)[:-4]
    j = json.load(open(f[:-4] + '.json'))
    scale, dsf = j['opt']['scale'], j['opt'].get('dsf', 1)
    if scale * dsf < 70: continue
    sp = 0.18 * scale * dsf
    target = 6.1 if n % 2 == 0 else 7.0
    im = Image.open(f).convert('L')
    k = target / sp
    im2 = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS if n % 4 < 2 else Image.BOX)
    im2.save('cases/KL/' + name + '.png')
    shutil.copy(f[:-4] + '.json', 'cases/KL/' + name + '.json')
    n += 1
print('KL', n)
