// --- main.js — Orquestrador da aplicação (ES Modules) ---
// Importa os módulos especializados. A ordem de importação importa:
//  1. three-setup.js  → cena, câmera, renderer, pós-processamento
//  2. physics.js      → estado, física, deteção de colisão (importa de three-setup.js)
//  3. ui.js           → UI, eventos, animação, landing page (importa de physics.js e three-setup.js)
//
// Antes de carregar a cena, confere se o navegador consegue criar um contexto WebGL.
// Sem isso o THREE.WebGLRenderer lança "Error creating WebGL context" e a página fica
// em branco; aqui mostramos o motivo provável e como resolver.

function webglAvailable() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext(); // libera o contexto de teste
    return true;
  } catch {
    return false;
  }
}

function showWebglError(detail) {
  const box = document.createElement('div');
  box.setAttribute('role', 'alert');
  box.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:9999', 'display:grid', 'place-items:center', 'padding:16px',
    'background:#1b1b1f', 'color:#e4e4e7', 'font:15px/1.6 "IBM Plex Sans",system-ui,sans-serif',
  ].join(';');
  box.innerHTML = `
    <div style="max-width:560px">
      <h1 style="font-size:22px;font-weight:500;margin:0 0 12px;color:#ff7139">O navegador não conseguiu iniciar o WebGL</h1>
      <p style="margin:0 0 12px">O simulador desenha a cena 3D com WebGL, e o navegador recusou criar o contexto gráfico. Normalmente é uma destas causas:</p>
      <ul style="margin:0 0 12px;padding-left:20px">
        <li>Aceleração por hardware desligada nas configurações do navegador.</li>
        <li>No Firefox: <code>webgl.disabled</code> ativado ou <code>privacy.resistFingerprinting</code> ligado em <code>about:config</code>.</li>
        <li>Driver da placa de vídeo bloqueado ou desatualizado (veja <code>about:support</code> no Firefox ou <code>chrome://gpu</code> no Chrome).</li>
        <li>Muitas abas com 3D abertas: feche algumas ou reinicie o navegador.</li>
      </ul>
      <p style="margin:0;color:#a1a1aa">Depois de ajustar, recarregue a página.${detail ? ` Detalhe: ${detail}` : ''}</p>
    </div>`;
  document.body.appendChild(box);
}

if (!webglAvailable()) {
  showWebglError();
} else {
  try {
    await import('./three-setup.js');
    await import('./physics.js');
    await import('./ui.js');
  } catch (err) {
    console.error(err);
    if (/WebGL/i.test(String(err?.message))) showWebglError(String(err.message));
    else throw err;
  }
}

// O ponto de entrada da aplicação é o próprio ui.js: ele arranca a cena
// ao ser carregado como módulo. Não é necessário chamar nada aqui.
