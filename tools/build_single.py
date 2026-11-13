#!/usr/bin/env python3
"""Construit une version « fichier unique » de l'appli : un seul .html qui
contient tout (code, bibliothèques, justificatif vierge, lecture des tickets).

Usage : python3 tools/build_single.py [sortie.html] [--justificatif chemin.pdf] [--convention chemin.pdf]

--justificatif : embarque le justificatif vierge dans le fichier (à ne faire
que pour une diffusion privée ; il n'est pas dans le dépôt).
"""
import base64, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
args = sys.argv[1:]
TEMPLATE = None
if '--justificatif' in args:
    i = args.index('--justificatif')
    TEMPLATE = Path(args[i + 1]).resolve()
    del args[i:i + 2]
CONVENTION = None
if '--convention' in args:
    i = args.index('--convention')
    CONVENTION = Path(args[i + 1]).resolve()
    del args[i:i + 2]
OUT = Path(args[0]) if args else ROOT / 'dist' / 'covoiturage.html'

MODULES = ['layout', 'format', 'store', 'imaging', 'segment', 'zones', 'cartegrise', 'ocr', 'pdf', 'convention', 'app']

def bundle():
    parts = []
    for name in MODULES:
        src = (ROOT / 'js' / f'{name}.js').read_text(encoding='utf-8')
        src = re.sub(r"^import \* as (\w+) from '\./(\w+)\.js';", r"const \1 = __m_\2;", src, flags=re.M)
        src = re.sub(r"^import \{([^}]*)\} from '\./(\w+)\.js';", r"const {\1} = __m_\2;", src, flags=re.M)
        if re.search(r"^import ", src, flags=re.M):
            raise SystemExit(f'import non géré dans {name}.js')
        names = re.findall(r"^export (?:async )?(?:function|const|let|class) (\w+)", src, flags=re.M)
        src = re.sub(r"^export ", "", src, flags=re.M)
        parts.append(f"const __m_{name} = (() => {{\n{src}\nreturn {{ {', '.join(names)} }};\n}})();\n")
    return '\n'.join(parts)

def b64(path):
    data = (ROOT / path).read_bytes() if not isinstance(path, Path) else path.read_bytes()
    if str(path).endswith('worker.min.js'):
        # Correctif Tesseract.js 5.1.1 : avec une langue fournie en mémoire
        # ({code, data}), l'initialisation utilise « data » au lieu de « code ».
        bug = b'return"string"==typeof t?t:t.data}'
        if bug not in data:
            raise SystemExit('correctif worker Tesseract introuvable')
        data = data.replace(bug, b'return"string"==typeof t?t:t.code}')
    return base64.b64encode(data).decode('ascii')

def check(text, what):
    if re.search(r'</script', text, re.I):
        raise SystemExit(f'</script> présent dans {what}')
    return text

html = (ROOT / 'index.html').read_text(encoding='utf-8')
css = (ROOT / 'styles.css').read_text(encoding='utf-8')
code = check(bundle(), 'le code')

blobs = {
    'worker': ('vendor/tesseract/worker.min.js', 'text/javascript'),
    'core': ('vendor/tesseract/tesseract-core-simd-lstm.wasm.js', 'text/javascript'),
    'lang': ('vendor/tesseract/lang/fra.traineddata.gz', 'application/gzip'),
}
if TEMPLATE:
    blobs['template'] = (TEMPLATE, 'application/pdf')
if CONVENTION:
    blobs['convention'] = (CONVENTION, 'application/pdf')
data_tags = '\n'.join(
    f'<script type="application/octet-stream" id="inline-{k}" data-type="{t}">{b64(p)}</script>'
    for k, (p, t) in blobs.items())

loader = """
<script>
// Ressources embarquées (décodées à la demande)
window.__INLINE__ = (() => {
  const cache = {};
  const bytes = (k) => {
    if (!cache[k]) {
      const bin = atob(document.getElementById('inline-' + k).textContent.trim());
      const a = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
      cache[k] = a;
    }
    return cache[k];
  };
  const urls = {};
  const url = (k) => urls[k] || (urls[k] = URL.createObjectURL(new Blob([bytes(k)], { type: document.getElementById('inline-' + k).dataset.type })));
  let worker = null;
  const workerUrl = () => worker || (worker = URL.createObjectURL(new Blob(
    ['self.importScripts = function () {};\\n', bytes('core'), '\\n', bytes('worker')], { type: 'text/javascript' })));
  const has = (k) => !!document.getElementById('inline-' + k);
  return { has, bytes: (k) => bytes(k).slice().buffer, lang: () => bytes('lang').slice(), url, workerUrl };
})();
</script>
"""

icon = 'data:image/png;base64,' + b64('icons/apple-touch-icon.png')
html = html.replace('<link rel="manifest" href="manifest.webmanifest">\n', '')
html = html.replace('<link rel="icon" href="icons/icon-192.png">', f'<link rel="icon" href="{icon}">')
html = html.replace('<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">', f'<link rel="apple-touch-icon" href="{icon}">')
html = html.replace('<link rel="stylesheet" href="styles.css">', f'<style>\n{css}\n</style>')
html = html.replace('<script src="vendor/pdf-lib.min.js"></script>',
                    f'<script>{check((ROOT / "vendor/pdf-lib.min.js").read_text(encoding="utf-8"), "pdf-lib")}</script>')
html = html.replace('<script src="vendor/tesseract/tesseract.min.js"></script>',
                    f'<script>{check((ROOT / "vendor/tesseract/tesseract.min.js").read_text(encoding="utf-8"), "tesseract")}</script>')
html = html.replace('<script type="module" src="js/app.js"></script>',
                    f'{data_tags}\n{loader}\n<script type="module">\n{code}\n</script>')
if 'src="js/' in html or 'href="styles' in html:
    raise SystemExit('référence externe restante')
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(html, encoding='utf-8')
print(f'{OUT} : {OUT.stat().st_size / 1e6:.1f} Mo')
