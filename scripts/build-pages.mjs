// Monta o site estático para o GitHub Pages em _site/ (ou na pasta passada como argumento):
//   _site/index.html      página inicial  (templates/index.html)
//   _site/simulador.html  simulador       (templates/simulador.html; o Pages serve /simulador)
//   _site/static/         CSS, JS e imagens
// Os templates não usam Jinja e todos os caminhos são relativos, então o mesmo HTML serve
// pelo Flask (na raiz) e pelo Pages (numa subpasta, /3d-physics-complexity/).
import { cpSync, mkdirSync, rmSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? '_site';

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
copyFileSync('templates/index.html', join(out, 'index.html'));
copyFileSync('templates/simulador.html', join(out, 'simulador.html'));
cpSync('static', join(out, 'static'), {
  recursive: true,
  // fora do site: a sequência da versão scroll-craft (não usada) e caches de editor
  filter: src => !/[\\/](hero-seq|\.impeccable)([\\/]|$)/.test(src),
});
writeFileSync(join(out, '.nojekyll'), '');

// Confere que nenhum caminho absoluto (/static, /simulador) sobrou nos HTML
for (const page of ['index.html', 'simulador.html']) {
  const html = readFileSync(join(out, page), 'utf8');
  const bad = html.match(/(href|src|content)="\/(?!\/)[^"]*"/g);
  if (bad) {
    console.error(`${page}: caminhos absolutos não funcionam no Pages:`, bad);
    process.exit(1);
  }
}
console.log(`site montado em ${out}/`);
