// --- main.js — Orquestrador da aplicação (ES Modules) ---
// Importa os módulos especializados. A ordem de importação importa:
//  1. three-setup.js  → cena, câmera, renderer, pós-processamento
//  2. physics.js      → estado, física, deteção de colisão (importa de three-setup.js)
//  3. ui.js           → UI, eventos, animação, landing page (importa de physics.js e three-setup.js)

import './three-setup.js';
import './physics.js';
import './ui.js';

// O ponto de entrada da aplicação (startApp) é disparado automaticamente por ui.js
// ao ser carregado como módulo. Não é necessário chamar nada aqui.
