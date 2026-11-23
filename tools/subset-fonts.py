"""페이지에서 쓰는 글자만 남긴 웹폰트(woff2)와 css/fonts.css를 만든다.

사용법: python3 tools/subset-fonts.py <폰트 TTF가 있는 폴더>
필요한 TTF(google/fonts 저장소, SIL OFL 1.1):
  BlackHanSans-Regular.ttf, GothicA1-Regular.ttf, GothicA1-SemiBold.ttf
문구를 바꾸면 다시 실행한다. 빠진 글자는 시스템 글꼴로 보인다.
"""
import glob
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else '.'

chars = set()
for path in glob.glob(os.path.join(ROOT, '*.html')) + glob.glob(os.path.join(ROOT, 'js', '*.js')):
    chars |= set(open(path, encoding='utf-8').read())
chars |= {chr(c) for c in range(0x20, 0x7F)}
chars |= set('ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ0123456789%·')
chars = sorted(c for c in chars if c.isprintable() and ord(c) >= 0x20)
text = ''.join(chars)

FONTS = [
    ('BlackHanSans-Regular.ttf', 'black-han-sans.woff2', 'Black Han Sans', 400),
    ('GothicA1-Regular.ttf', 'gothic-a1-400.woff2', 'Gothic A1', 400),
    ('GothicA1-SemiBold.ttf', 'gothic-a1-600.woff2', 'Gothic A1', 600),
]
os.makedirs(os.path.join(ROOT, 'fonts'), exist_ok=True)
css = ['/* 페이지에서 쓰는 글자만 남긴 글꼴(tools/subset-fonts.py로 생성). 원본: google/fonts, SIL OFL 1.1 (fonts/OFL-*.txt) */']
for src, out, family, weight in FONTS:
    dst = os.path.join(ROOT, 'fonts', out)
    subprocess.run([
        sys.executable, '-m', 'fontTools.subset', os.path.join(SRC, src),
        f'--text={text}', '--flavor=woff2', f'--output-file={dst}',
        '--layout-features=*', '--no-hinting', '--desubroutinize',
    ], check=True)
    css.append(
        "@font-face {\n"
        f"  font-family: '{family}';\n  font-style: normal;\n  font-weight: {weight};\n  font-display: swap;\n"
        f"  src: url(../fonts/{out}) format('woff2');\n}}"
    )
    print(out, os.path.getsize(dst))
open(os.path.join(ROOT, 'css', 'fonts.css'), 'w', encoding='utf-8').write('\n'.join(css) + '\n')
print('glyphs', len(chars))
