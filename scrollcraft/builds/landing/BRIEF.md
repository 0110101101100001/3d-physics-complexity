# BRIEF: PHYSICS_SIM, página inicial

Self-authored under explicit creative delegation. O autor respondeu "Pode decidir" à pergunta sobre a entrevista, e escolheu: animar a LP atual (manter conteúdo e seções), assets gravados do simulador real, intensidade "intensa, cinematográfica".

## As oito perguntas (decisões autorais, por delegação)

1. **Clima em poucas palavras:** laboratório à noite, instrumento de medição, pixel quente. Referências: a tela de um osciloscópio, os gráficos de "Powers of Ten" (Eames), o HUD de um jogo de estratégia dos anos 90.
2. **Jornada:** a cena 3D primeiro, girando; depois a ferramenta real; depois a prova (as três estratégias sobre os mesmos 150 cubos); depois como se mede; dúvidas; abrir o simulador.
3. **Curva de energia:** abre forte (a cena), acalma no painel, explode no pico, baixa para confiança e calma, fecha firme.
4. **Sensação por etapa e o momento:** ver "Feeling curve" e "Peak" abaixo.
5. **O que nenhum site faz:** a tela se enche com as 11.175 linhas de pares da força bruta e, rolando, elas desaparecem até sobrarem as 442 da grade espacial. As linhas são os pares que o algoritmo real testou.
6. **Distância do premium-minimal:** mantém a base técnica e sóbria da LP atual (IBM Plex, fundo matte, laranja do projeto). A intensidade vem do movimento, não de mudar a estética.
7. **Mundo contínuo ou cenas:** cenas distintas. A página não é uma viagem por um lugar.
8. **Assets existentes:** o simulador. Gravados dele: 48 quadros (desktop) e 32 (celular) de uma meia volta de câmera sobre a cena congelada, tirados do canvas WebGL na resolução nativa (dithering e pixels preservados); três capturas de tela; os pares reais de `runBroadPhase` para 150 cubos (semente 42), em `static/data/broadphase-150.json`.

## Grammar

Filmic one-shot. As outras sete perderam porque o autor pediu para manter o conteúdo e as seções da LP atual: *live surface* proíbe a barra de navegação de marketing e o título sobre imagem que a LP já tem; *chaptered editorial*, *typographic poster*, *gallery* e *split stage* exigem reescrever a estrutura; *continuous world* exige uma viagem por um lugar; *rhythmic cutlist* proíbe `pin`, e o pico precisa segurar a tela.

## Journey

1. Curiosidade: a cena 3D do próprio simulador
2. Reconhecimento: é uma ferramenta real, com painel
3. Virada (pico): o mesmo problema, três custos
4. Substância: o que exatamente é medido
5. Dúvidas respondidas
6. Compromisso: abrir o simulador

## Feeling curve

| Ato | Emoção | O que causa |
|---|---|---|
| 1 Hero | Curiosidade | a câmera dá meia volta e entra na cena de cubos pixelizados sob a mão do visitante |
| 2 Simulador | Reconhecimento | a captura do painel real se abre numa cortina de baixo para cima |
| 3 Estratégias (pico) | Espanto, depois clareza | 11.175 linhas laranja enchem o quadro; a grade cai sobre elas e só 442 ficam; a Octree se subdivide e mostra 3.042 |
| 4 Medição | Confiança | o título se monta linha a linha e o código do cronômetro desliza mais devagar que o texto |
| 5 Perguntas | Calma | respostas curtas entram uma a uma, sem nada fixo |
| 6 Fechamento | Decisão | a tela para, o nome PHYSICS_SIM se fecha e o botão acompanha o cursor |

## Peak

"Rolei e a tela se encheu de onze mil linhas, aí veio a grade e sobraram só 442." Vive no ato 3, que tem o maior span da página (4,5 telas). O ato 2 é calmo de propósito: o silêncio antes do pico.

## Tell-someone

"É o site onde 11 mil linhas somem enquanto você rola e sobram 442."

## Signature move

O colapso de pares: um canvas desenha, a partir do progresso da rolagem, os pares reais que cada estratégia testou nos mesmos 150 cubos (vista de cima), com um contador que mostra exatamente quantas linhas estão na tela. Código da página, lido de `--sc-p`; o motor não foi alterado.

## Silêncio autoral

Nenhum viewport vazio. A calma antes do pico é o ato 2 (um único movimento, uma cortina).

## Notas de produção

- Sem ffmpeg nesta máquina: o hero usa o modo de sequência de imagens do motor (`data-sc-sequence`) em vez de vídeo.
- A suavização do canvas é desligada no JS da página para manter o serrilhado do simulador.

## Feel check (depois do harness, rolando a página inteira)

| Ato | Pretendido | Sentido | Mudança feita |
|---|---|---|---|
| 1 Hero | Curiosidade | Curiosidade | contraste do título reforçado (scrim mais forte) |
| 2 Simulador | Reconhecimento | Reconhecimento | a captura transbordava sobre o pico (altura fixa do kit); corrigido |
| 3 Estratégias | Espanto, depois clareza | Clareza, mas sem espanto na primeira versão: as linhas da força bruta estavam fracas | alfa das linhas 0,085 > 0,18 e cubos menores: agora a força bruta vira uma malha que cobre a cena |
| 4 Medição | Confiança | Confiança | nenhuma |
| 5 Perguntas | Calma | Calma | nenhuma |
| 6 Fechamento | Decisão | Decisão | barra fixa do celular cobria o pé; palco ganhou espaço para ela |

O pico é a maior mudança visual da página e tem o maior span (4,5 telas). O ato anterior é uma cortina só. O fim segura o nome e o botão.

## Verificação

- Harness da skill (desktop 1440x900, celular 390x844, movimento reduzido): sem rolagem morta; contraste de todos os avisos acima de 4.5:1 no pior quadro.
- Único aviso restante, falso positivo: "cue never peaks" na placa do hero; o harness identifica o aviso pelo texto e o contador muda o texto a cada passo. A placa chega a opacidade 1 nos passos 4 a 6.
- Folha de contato não gerada (precisa de ffmpeg completo).
- Não verificado: celular real (decodificação, rolagem por toque), Safari.
