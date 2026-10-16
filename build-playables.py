#!/usr/bin/env python3
"""Builds the YouTube Playables bundle for Calm Road.

    python build-playables.py

Output:
    dist/playables/                      the unpacked bundle (serve it to test)
    dist/calm-road-playables.zip         the file to upload (index.html at the zip root)

The bundle only contains what the game needs. The Playables rules this script checks:
  - the YouTube SDK script is the first script and is the only external URL
  - no other external network requests (three.js is bundled, not loaded from a CDN)
  - relative paths only, file names use letters, digits, _ - .
  - every file < 30 MiB (hard limit), total < 250 MiB, fewer than 8000 files
  - no service worker, no web workers, no eval in our own code
"""
import os, re, shutil, sys, zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'dist', 'playables')
ZIP = os.path.join(ROOT, 'dist', 'calm-road-playables.zip')
SDK = 'https://www.youtube.com/game_api/v1'

INCLUDE = ['index.html', 'css/style.css', 'img/logo.png',
           'js/vendor/three.min.js', 'js/platform.js', 'js/util.js', 'js/scenes.js', 'js/cars.js',
           'js/world.js', 'js/airport.js', 'js/audio.js', 'js/game.js']

def read(p):
    with open(os.path.join(ROOT, p), encoding='utf-8') as f:
        return f.read()

# ---------------------------------------------------------------- transform index.html for Playables
html = read('index.html')
html = re.sub(r'\?v=\d+', '', html)                                         # plain file names, no query strings
html = re.sub(r'<link rel="manifest"[^>]*>\n?', '', html)                  # no web-app manifest / home-screen tags
html = re.sub(r'<link rel="apple-touch-icon"[^>]*>\n?', '', html)
html = re.sub(r'<meta name="(mobile-web-app-capable|apple-mobile-web-app-[a-z-]+)"[^>]*>\n?', '', html)
html = re.sub(r'<script>\s*// offline-capable repeat visits.*?</script>\n?', '', html, flags=re.S)   # no service worker
assert html.index(SDK) < html.index('js/platform.js') < html.index('js/game.js'), 'SDK must load before any game code'

# ---------------------------------------------------------------- assemble
if os.path.isdir(os.path.join(ROOT, 'dist')):
    shutil.rmtree(os.path.join(ROOT, 'dist'))
for rel in INCLUDE:
    dst = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if rel == 'index.html':
        with open(dst, 'w', encoding='utf-8', newline='\n') as f:
            f.write(html)
    else:
        shutil.copyfile(os.path.join(ROOT, rel), dst)

# ---------------------------------------------------------------- checks
problems, notes = [], []
files = []
for base, _, names in os.walk(OUT):
    for n in names:
        p = os.path.join(base, n)
        files.append((os.path.relpath(p, OUT).replace('\\', '/'), os.path.getsize(p)))
total = sum(s for _, s in files)
for rel, size in files:
    if not all(re.fullmatch(r'[A-Za-z0-9_\-.]+', part) for part in rel.split('/')):
        problems.append('bad file name: ' + rel)
    if size >= 30 * 1024 * 1024:
        problems.append('file over 30 MiB: ' + rel)
    if size > 512 * 1024:
        notes.append('%s is %d KiB (recommended under 512 KiB; hard limit is 30 MiB)' % (rel, size // 1024))
if total >= 30 * 1024 * 1024:
    problems.append('initial bundle over 30 MiB')
if len(files) > 8000:
    problems.append('too many files')

url_re = re.compile(r'https?://[^\s"\'`)<>]+')
for rel, _ in files:
    if not rel.endswith(('.html', '.js', '.css')) or rel.startswith('js/vendor/'):
        continue
    text = open(os.path.join(OUT, rel), encoding='utf-8', errors='ignore').read()
    for m in url_re.finditer(text):
        u = m.group(0).rstrip('.,;')
        if u.startswith(SDK) or u.startswith('http://www.w3.org/2000/svg'):
            continue                      # the SDK itself, and an xmlns inside an inline SVG data URI (not a request)
        problems.append('external URL in %s: %s' % (rel, u))
    for pat, what in ((r'\beval\s*\(', 'eval'), (r'new\s+Worker\s*\(', 'web worker'), (r'serviceWorker', 'service worker')):
        if re.search(pat, text):
            problems.append('%s uses %s' % (rel, what))
for m in re.finditer(r'(?:src|href)="([^"]+)"', html):
    u = m.group(1)
    if u.startswith(('data:', '#', SDK)):
        continue
    if u.startswith(('/', 'http')) or '?' in u:
        problems.append('index.html reference not a plain relative path: ' + u)
    elif not os.path.exists(os.path.join(OUT, u)):
        problems.append('index.html points to a missing file: ' + u)

# ---------------------------------------------------------------- zip (forward slashes, index.html first)
os.makedirs(os.path.dirname(ZIP), exist_ok=True)
order = ['index.html'] + sorted(r for r, _ in files if r != 'index.html')
with zipfile.ZipFile(ZIP, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for rel in order:
        z.write(os.path.join(OUT, rel), rel)

print('Files in the bundle:')
for rel in order:
    print('  %-28s %8.1f KiB' % (rel, dict(files)[rel] / 1024))
print('Unpacked total: %.2f MiB   zip: %.2f MiB  (%d files)' % (total / 1048576, os.path.getsize(ZIP) / 1048576, len(files)))
for n in notes:
    print('note:', n)
if problems:
    print('\nPROBLEMS:')
    for p in problems:
        print('  -', p)
    sys.exit(1)
print('\nAll checks passed. Upload:', ZIP)
