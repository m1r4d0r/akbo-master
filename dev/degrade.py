# 깨끗한 시험 악보를 스캔·폰 사진처럼 망가뜨려 cases/P1(가벼움), P2(보통), P3(심함)에 넣는다
import cv2, numpy as np, glob, os, shutil, sys
rng = np.random.default_rng(7)
src = []
for d, pat in [('A', '*s55x1*'), ('A', '*s80x1*'), ('A', '*s50x2*'), ('B', '*s60x1*'), ('B', '*s50x2*'), ('F', '*s70x1*'), ('F', '*s50x2*'), ('E', '*s70x1*'), ('D', '*s55*')]:
    src += [f for f in sorted(glob.glob(f'cases/{d}/{pat}.png')) if 'Petaluma' not in f]
def photo(img, level, seed):
    r = np.random.default_rng(seed)
    h, w = img.shape[:2]
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    # 종이: 약간 어두운 흰색
    paper = [245, 232, 218][level]; g = g / 255 * paper
    # 기울기와 원근
    ang = r.uniform(-1, 1) * [0.4, 1.2, 2.5][level]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), ang, 1.0)
    pad = int(0.06 * max(w, h))
    g = cv2.copyMakeBorder(g, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=paper)
    h2, w2 = g.shape
    M = cv2.getRotationMatrix2D((w2 / 2, h2 / 2), ang, 1.0)
    g = cv2.warpAffine(g, M, (w2, h2), flags=cv2.INTER_CUBIC, borderValue=paper)
    if level >= 1:
        k = [0, 0.012, 0.03][level]
        srcp = np.float32([[0, 0], [w2, 0], [w2, h2], [0, h2]])
        dstp = srcp + r.uniform(-1, 1, (4, 2)).astype(np.float32) * np.float32([w2 * k, h2 * k])
        g = cv2.warpPerspective(g, cv2.getPerspectiveTransform(srcp, dstp), (w2, h2), flags=cv2.INTER_CUBIC, borderValue=paper)
    # 고르지 않은 조명(한쪽이 어둡다)
    yy, xx = np.mgrid[0:h2, 0:w2].astype(np.float32)
    a = r.uniform(0, 2 * np.pi)
    grad = ((xx / w2 - 0.5) * np.cos(a) + (yy / h2 - 0.5) * np.sin(a))
    g = g * (1 - [0.05, 0.22, 0.42][level] * (grad + 0.5))
    # 흐림, 잡음, 압축
    s = [0.5, 0.9, 1.4][level]
    g = cv2.GaussianBlur(g, (0, 0), s)
    g = g + r.normal(0, [2, 5, 9][level], g.shape)
    g = np.clip(g, 0, 255).astype(np.uint8)
    q = [80, 55, 35][level]
    ok, enc = cv2.imencode('.jpg', g, [cv2.IMWRITE_JPEG_QUALITY, q])
    return cv2.imdecode(enc, cv2.IMREAD_GRAYSCALE)
pre = 'P'
if len(sys.argv) > 1 and sys.argv[1] in ('H', 'S'):
    k = sys.argv[1]
    pre = 'P' + k; src = [f for f in sorted(glob.glob(f'cases/{k}/*.png')) if 's50x1' not in f]
for level in range(3):
    out = f'cases/{pre}{level + 1}'; shutil.rmtree(out, ignore_errors=True); os.makedirs(out)
    for i, f in enumerate(src):
        img = cv2.imread(f)
        name = os.path.basename(f)[:-4]
        tag = f.split('/')[1]
        cv2.imwrite(f'{out}/{tag}_{name}.png', photo(img, level, 1000 * level + i))
        shutil.copy(f[:-4] + '.json', f'{out}/{tag}_{name}.json')
    print(out, len(src))
