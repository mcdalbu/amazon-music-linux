# Rolagem GPU e controles do mini player — versão 0.4.3

- A saída GPU agora usa Electron offscreen.useSharedTexture e DMA-BUF. Uma ponte
  Node-API v8 transfere os descritores pelo socket Unix privado com SCM_RIGHTS;
  GTK importa a textura com GdkDmabufTextureBuilder. Sem readback ou upload de
  bitmaps a cada quadro. O download de pixels só ocorre na verificação inicial
  de conteúdo/capturas de diagnóstico. A página continua em sandbox, sem Node.
- Cada textura permanece reservada no Electron até o último consumidor GTK
  terminar; o destroy notify fecha os FDs e confirma a liberação da captura.
  Quadros não apresentados são descartados e liberados. Testes verificam
  duplicação real dos descritores, CLOEXEC, liberação exatamente uma vez e
  ausência de vazamentos ao rejeitar geometria/formato/layout inválidos.
- O renderizador GTK passou a ser Vulkan com GPU e OpenGL com software,
  respeitando GSK_RENDERER do usuário. O GL importava a textura em cerca de
  0,17 ms, mas a apresentação ficava limitada a 34–80 fps neste driver.
  Com Vulkan, o teste final atingiu 115,1 fps / p95 10,5 ms, pixels 2560x1628,
  alvo=120 e relógio GTK=118,2 ticks/s. GPU compositing/rasterization enabled;
  sharedGPU=true. Registro: build/scroll-dmabuf-final-0.4.3.log.
  A medição anterior com Vulkan foi 112,4 fps / p95 15,1 ms.
  A comparação da 0.4.2 com bitmaps GPU/OpenGL era 31,8 fps / p95 61,5 ms.
  Isto melhora o caminho de apresentação; não comprova 120 fps sustentados
  no catálogo autenticado. Medições são sequenciais, com perfil e página locais.
- Compatibilidade: exportação/importação indisponível ou ausência de captura
  inicial recupera a superfície oculta para bitmaps, preservando processo,
  sessão, escala, dimensões e a janela GTK. O teste explícito de recuperação
  passou (build/gpu-fallback-0.4.3.log). Eventos atrasados do renderer anterior
  são ignorados. GTK < 4.14 continua pelo modo bitmap.
  A configuração da taxa de captura aguarda confirmação GTK do primeiro quadro
  com conteúdo, corrigindo a inicialização intermitente observada no smoke test.
- Entrada do touchpad preserva frações, informa hasPreciseScrollingDeltas e
  mantém a conversão de unidades WHEEL/SURFACE. Antes, int(dx/dy) descartava
  movimentos pequenos, e o Chromium recebia todas as entradas como roda.
- MediaSession publica a arte da faixa; URLs HTTPS de hosts Amazon/CDN ou
  pequenas imagens PNG/JPEG data: são validadas. Cache assíncrono, arquivos
  privados, limite de 4 MiB/4096 pixels por imagem e 32 capas; respostas antigas
  não sobrescrevem a faixa atual. MPRIS usa file: local; ícone do app é fallback.
- Next/Previous agora acionam nexttrack/previoustrack da sessão. CanGoNext e
  CanGoPrevious acompanham a disponibilidade dos handlers. Métodos indisponíveis
  retornam NotSupported em vez de aparentar sucesso sem executar uma ação.
- Teste D-Bus real passou com duas faixas e duas capas diferentes: Next e Previous,
  atualização de título/artista/arte, tray, pause/play/mute/quit, áudio em segundo
  plano e ausência de serviço Chromium duplicado. Registro:
  build/gnome-integration-0.4.3.log. A conta Amazon não foi alterada.
- O smoke test em software passou com o backend oculto X11/XWayland e a janela
  GTK nativa Wayland. O dispositivo software podia manter só o fundo vazio com
  Ozone/Wayland; a seleção de X11 quando DISPLAY existe evita esse caso.
  Há também tentativas limitadas de reiniciar a captura após dom-ready, até o
  primeiro quadro com conteúdo. Registro: build/smoke-software-recovery-0.4.3.log.
- O renderer escolhido automaticamente é removido do ambiente ao reiniciar,
  para uma troca de software→GPU selecionar Vulkan; overrides do usuário são
  preservados. Teste regressivo cobre a seleção e GTK sem DMA-BUF.
- 34 testes Python e 6 testes JavaScript passaram. Ponte nativa compilada com
  cabeçalhos oficiais Node.js v24.12.0, licença preservada no RPM.
  O smoke test com Vulkan/DMA-BUF passou, incluindo seletor HTML, redimensionamento,
  temas nativos, Unicode, controles, áudio e atualização das capas.
- RPM final 0.4.3 extraído passou no smoke test com GPU/Vulkan e sharedGPU=true;
  confirmou alvo de 120 Hz, troca 60/144/monitor e duas capas/Next/Previous.
  rpm -K e SHA-256 passaram; 23 arquivos (incluindo ponte e licença) comparados
  byte a byte com a fonte final. Registro: build/packaged-smoke-0.4.3.log.
  O mesmo RPM passou em software, sharedGPU=false, com todos os controles,
  áudio, capas e seletor HTML: build/packaged-smoke-software-0.4.3.log.

Referências: [Electron shared textures](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering),
[DMA-BUF no GTK](https://docs.gtk.org/gdk4/class.DmabufTextureBuilder.html),
[entrada precisa](https://www.electronjs.org/docs/latest/api/structures/mouse-wheel-input-event).

# Mini player do GNOME e rolagem — versão 0.4.2

- Confirmado na instalação 0.4.1: durante a reprodução mostrada pelo usuário,
  o serviço MPRIS anunciava PlaybackStatus=Stopped, Metadata vazio e CanPlay=false.
  O GNOME oculta esse player. O detector anterior só consultava áudio/vídeo no DOM.
- O observador agora acompanha HTMLMediaElement.play no contexto da página,
  incluindo Audio criado antes de DOMContentLoaded e fora do documento, além de
  MediaSession e eventos de reprodução do Chromium. O preload isolado mantém IPC,
  sem expor APIs Electron/Node à página; origem, frame e dados continuam validados.
- Play/pause usam os handlers da sessão de mídia quando disponíveis, com fallback
  ao elemento de áudio acompanhado. Título, artista e álbum são publicados ao MPRIS.
  Mudanças de estado são emitidas imediatamente; uma atualização após o carregamento
  evita perder metadados enviados antes de a janela confirmar a navegação.
- A interface apresenta o documento em dom-ready, sem esperar window.onload
  e todos os recursos de mídia. A fixture usa preload=none antes da reprodução.
  A apresentação também tem fallback a 10 fps enquanto o GTK não recebe ticks
  (carregamento inicial ou janela coberta), retomando a sincronização ao aparecer.
- Fixture regressiva remove o áudio do HTML antes de DOMContentLoaded. O teste integrado
  verifica detecção, CanPlay, Playing/Paused, comandos nativos e metadados. Também
  verifica um player controlado exclusivamente pelos handlers da sessão de mídia.
- O teste D-Bus real no GNOME passou com áudio fora do HTML: StatusNotifierItem,
  Activate, DBusMenu pause/play/mute/quit, MPRIS com ícone e artista, reprodução em
  segundo plano e ausência de um serviço Chromium duplicado.
- Touchpad: deltas GDK_SCROLL_UNIT_SURFACE agora preservam pixels; somente WHEEL
  usa a conversão de distância. Antes, movimentos do touchpad eram multiplicados por 40.
- Removido o limite fixo de 30/60 fps. A saída acompanha o monitor da janela
  via GDK (milli-Hertz), com fallback ao frame clock quando o monitor não informa
  a taxa. Atualização ao mover a janela ou trocar a taxa, sem reiniciar o backend.
  Neste ambiente, eDP-1 informa 120000 mHz: alvo de 120 fps. O modo bitmap do
  Electron aceita até 240 fps. GTK apresenta o quadro mais recente
  em seu frame clock, sem acumular quadros antigos. Três slots memfd privados e
  herdados substituem o envio dos bitmaps completos pelo socket. Um slot só é
  reutilizado após a cópia para a textura GTK ou o descarte explícito do quadro.
- Testes de protocolo cobrem geometria/tamanho/slots inválidos, fragmentação e
  confirmação do slot depois da cópia dos pixels; 26 testes Python e 5 JavaScript passaram.
  Testes de timing cobrem 60/75/90/120/144/165/240 Hz, taxa fracionária, fallback
  ao relógio e limite da API. O teste real muda o Electron para 60 e 144 fps,
  depois restaura automaticamente o alvo de 120 fps detectado pelo GTK.
  O teste integrado do RPM final extraído passou em Wayland com GPU e
  confirmou frameRate=120 no backend, além dos controles do player local.
- Comparação sequencial reproduzível: /usr/bin/python3 build/check-scroll-performance.py
  [caminho da versão]. Mesmo conteúdo com faixas/gradientes, 2560x1628 pixels,
  escala 2, GPU solicitada e fallback software em X11 (medição inicial,
  antes da mudança do alvo de 60 fps para acompanhar o monitor):
  0.4.1 = 18,0 fps / p95 105,1 ms; 0.4.2 = 50,9 fps / p95 29,5 ms.
  Registros: build/scroll-before-0.4.1.log e build/scroll-after-0.4.2.log.
- A taxa do monitor é aplicada fora do callback de pintura, depois do primeiro
  quadro com conteúdo do documento, evitando
  uma falha intermitente de inicialização da captura GPU observada no benchmark.
- Em Wayland, composição/rasterização GPU ficaram enabled e o teste integrado passou.
  Em uma medição anterior com memória compartilhada e página mais simples, foram
  observados 30,6 fps. Na medição final com lista contínua e alvo=120, foram
  medidos 25,5 fps com GPU e p95=79,6 ms (build/scroll-monitor-0.4.2.log).
  Com GSK_RENDERER=gl, a mesma medição atingiu 31,8 fps com GPU (p95=61,5 ms)
  e 47,1 fps com Electron por software (p95=30,4 ms). OpenGL passou a ser o
  padrão da janela GTK, preservando a variável de ambiente do usuário.
  Registros: build/scroll-monitor-gl-gpu-0.4.2.log e build/scroll-monitor-gl-0.4.2.log.
  Em X11, este driver Intel Arc encontrou falhas de GPU e recorreu a software.
  O alvo acompanha os 120 Hz, mas estes testes não atingiram 120 fps efetivos.
  A GPU ainda faz readback para CPU; texturas GPU compartilhadas não foram implementadas.
  Referência: https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering
- RPM 0.4.2 gerado; rpm -K e SHA-256 passaram. Os 18 arquivos da aplicação, assets,
  documentação e fixture extraídos foram comparados byte a byte com a fonte final.

A versão instalada e a conta Amazon não foram alteradas. Os testes de reprodução
usam mídia local. A reprodução autenticada deve ser conferida após atualizar e
reiniciar pelo menu Sair, pois fechar a janela pode manter o processo antigo no tray.

# GNOME: segundo plano, tray e mini player — versão 0.4.1

- Adicionada a preferência persistente Executar em segundo plano, desligada por padrão.
- Fechar a janela oculta a interface e mantém áudio/controles ativos. Sair, Ctrl+Q e
  MPRIS Quit encerram o aplicativo mesmo com segundo plano habilitado.
- Tray Electron/StatusNotifier com Abrir, Reproduzir/Pausar, Silenciar áudio e Sair.
- Detectado o host AppIndicator no GNOME 50.5 deste ambiente. Nenhuma extensão
  foi instalada ou ativada pelo aplicativo.
- Verificação real por D-Bus passou: registro do StatusNotifierItem e seu PNG,
  Activate reabrindo a janela GTK, menu DBusMenu pausando/retomando/silenciando,
  e Sair encerrando o processo em segundo plano.
- Áudio WAV local continuou tocando com a janela fechada e frames suspensos.
  Reabrir retomou a renderização. Desativar a preferência removeu o tray.
- MPRIS publica a identidade DesktopEntry e mpris:artUrl apontando ao PNG azul
  com sorriso, corrigindo a imagem genérica do cartão de mídia do GNOME.
- Publicação MPRIS automática do Chromium desabilitada no backend; o teste com
  MediaSession metadata não encontrou um serviço Chromium duplicado do processo.
- Testes usam um nome MPRIS separado, preservando o serviço da versão instalada.
- 20 testes Python e testes JavaScript passaram; arquivo desktop validado.
- Teste integrado do RPM extraído passou: temas, preferências, HiDPI, entrada,
  recuperação, áudio, segundo plano, ciclo do tray, reabertura e imagem MPRIS.
- RPM 0.4.1 passou em rpm -K e SHA-256; arquivos e ícones extraídos conferidos
  byte a byte com a fonte final. Inclui o PNG em hicolor/512x512 e libappindicator
  como dependência para a integração do tray.
- Verificação D-Bus reproduzível com /usr/bin/python3 build/check-gnome-integration.py.

A instalação existente não foi alterada. Feche o aplicativo antigo e instale o
RPM 0.4.1; depois habilite a opção nas preferências. As limitações de streaming
com conta e qualidade de áudio descritas abaixo continuam aplicáveis.

---

# GTK4/libadwaita + Electron — versão 0.4.0

- CEF substituído por CastLabs Electron 44.5.1+wvcus / Chromium 152.0.7977.130.
- Mantida uma janela GTK4/libadwaita real; Electron offscreen permanece oculto,
  com zero janelas Electron visíveis e renderer em sandbox.
- 18 testes Python passaram: tema, política de navegação, DRM, arquivos de runtime,
  fragmentação do socket, limites de frames e rejeição de pacotes inválidos.
- Testes de política JavaScript passaram no Node incluído no Electron; desktop validado.
- Teste integrado do RPM final extraído passou: temas nativos claro/escuro,
  preferências, persistência GPU, entrada Unicode, cliques, rolagem, erro/retry,
  redimensionamento, decodificação WAV local e reprodução/pausa/mute.
- Corrigida a causa da imagem borrada: GTK usava escala 2 enquanto Electron
  fornecia frames de escala 1. Agora uma viewport lógica de 1280×800 gera
  bitmap 2560×1600, com devicePixelRatio 2 e layout lógico preservado.
- Testados mudança de escala ao vivo (2→1→2), zoom e coordenadas de entrada.
- Teste com --enable-gpu passou; neste ambiente o processo GPU encontrou falhas
  e Chromium continuou por software. A interface distingue aceleração solicitada
  de composição GPU ativa. Não foi comprovada composição GPU neste driver.
- Catálogo público de music.amazon.com.br carregou em resolução física 2560×1628.
- Widevine 4.10.3112.0: requestMediaKeySystemAccess + createMediaKeys passaram.
- Reinício pelo botão real das preferências GTK: perfil preservado, componente
  registrado como new na execução seguinte, EME disponível e aviso de reinício ausente.
- RPM 0.4.0 (106 MiB) passou em rpm -K e SHA-256. Arquivos extraídos conferidos
  byte a byte com fontes, ícones, fixture e documentação finais. CEF excluído do pacote.
- Capturas: build/packaged-electron-dark.png, build/packaged-electron-light.png e
  build/electron-amazon-hidpi.png.
- Electron emite XGetWindowAttributes failed for window 1 no caminho offscreen
  por software neste ambiente; os testes de pixels, entrada e DRM passaram.

A instalação existente não foi alterada. Feche o app antigo e instale o RPM 0.4.0.
As preferências são preservadas. O novo perfil de sessão exige login novamente.
Streaming com conta Amazon, HD/Ultra HD e saída bit-perfect não foram validados.

---

# GTK4/libadwaita + CEF — versão 0.3.0

- Electron substituído por CEF/Chromium 152.0.6, com codecs AAC/H.264.
- Janela GTK4/libadwaita real; CEF off-screen não cria janela nativa (handle zero).
- 13 testes Python passaram; arquivo desktop validado.
- Testes integrados passaram no modo software e com GPU/X11: tema nativo claro/escuro,
  portal de aparência, preferências dentro da janela, GPU persistida, entrada Unicode,
  cliques, rolagem, falha/retry, redimensionamento e ausência de uma segunda janela CEF.
- O teste integrado do RPM final extraído passou. Fontes, ícones e documentação
  extraídos foram conferidos byte a byte com o projeto final.
- RPM 0.3.0 passou em `rpm -K` e SHA-256. Contém libcef.so e cef-helper; não contém Electron.
- Catálogo público de music.amazon.com.br carregou, com frames/pixels visíveis.
- Atualizador CEF baixou Widevine 4.10.3112.0 e retornou sucesso (0).
- Primeira execução: EME indisponível e reinício indicado após instalação concluída.
- Segunda execução do mesmo perfil: requestMediaKeySystemAccess + createMediaKeys
  para áudio AAC protegido passaram; aviso de reinício desapareceu.
- O botão GTK real de reinício também passou: perfil temporário preservado,
  mesma versão do CDM na inicialização seguinte, EME disponível e aviso removido.
- Capturas da barra nativa: build/packaged-native-cef-dark.png e
  build/packaged-native-cef-light.png. Catálogo real: build/cef-amazon.png.
- CEF emite avisos de integração GtkSettings/locale no terminal neste ambiente;
  eles não impediram os testes de renderização, temas, entrada ou DRM.

A instalação existente não foi alterada. Use sudo dnf install do RPM 0.3.0.
A sessão CEF é separada da sessão Electron e exige novo login. Login, streaming
com conta Amazon, HD/Ultra HD e saída bit-perfect não foram validados.

---

# Verificação — 9 de outubro de 2026

## Widevine e tema do sistema — versão 0.2.1

- Confirmado no runtime real: `components.status()` retornou `{}` nas duas
  inicializações; `whenReady()` retornou `updated` na primeira instalação e
  `new` ao registrar o módulo já instalado. O app agora usa esse resultado
  concluído para decidir entre reinício e pronto.
- O ciclo real do botão Reiniciar passou em perfil temporário: `restart`
  na primeira execução e `ready` após reabrir, mantendo o mesmo perfil.
- O teste de reinício revelou SIGTRAP no processo lançado com identidade
  desktop herdada. O reinício interno agora remove `CHROME_DESKTOP`, assim
  como os lançadores externos.
- Electron detectava tema claro, enquanto o portal de aparência do desktop
  informava preferência escura. Um leitor do portal com assinatura de sinais
  agora acompanha o sistema; GNOME/GSettings é fallback.
- 11 testes JavaScript e 6 testes Python passaram. A integração conferiu
  a preferência real do portal e simulou mudanças claro/escuro, verificando
  que Sistema acompanha a mudança e os temas manuais permanecem selecionados.
- O catálogo web mantém a aparência definida pela Amazon; o tema do app
  controla barra, preferências e a preferência nativa do Electron.
- RPM final 0.2.1 conferido com `rpm -K` e SHA-256. Fontes do Widevine,
  aparência, serviço, interface e README extraídas do pacote coincidem com
  os arquivos testados. A integração do pacote também passou.
- Atualização automática não executada: `sudo -n rpm -Uvh` exigiu senha.
  É necessário instalar o RPM 0.2.1 com `sudo dnf install`.

## Janela única e GPU — versão 0.2.0

- 9 testes JavaScript e 3 testes Python passaram; arquivo desktop validado.
- A integração confirmou apenas um `BrowserWindow`, player em
  `WebContentsView` e preferências dentro da mesma janela.
- Região/tema/mute mantêm validação; a opção de GPU é persistida e lida
  antes de `app.ready`. Os testes cobrem o override `--disable-gpu`.
- Controles exercitados pela interface local e seu preload real. Um renderer
  diferente com acesso ao mesmo bridge foi rejeitado pelo processo principal.
  O player não recebe o bridge da interface.
- MPRIS conferido na sessão D-Bus, usando o novo serviço sem janela GTK.
- Player com pixels visíveis nos modos software e `--enable-gpu`. Neste
  computador, o segundo modo informou `gpu_compositing: enabled`.
- Testados falha de carregamento, mensagem visível, Tentar novamente,
  fechamento das preferências e redimensionamento do player.
- RPM 0.2.0 passou em `rpm -K` e SHA-256. Os arquivos extraídos do RPM
  final passaram no mesmo teste integrado.
- Catálogo público de `music.amazon.com.br` abriu no perfil temporário.
  O Widevine foi instalado e o app indicou necessidade de reinício.
- Prévia em `build/single-window-amazon.png`; a imagem combina capturas
  separadas do shell e da view, pois `capturePage` do shell omite a view filha.
- A instalação do sistema ainda estava em 0.1.0; a atualização deve ser
  executada pelo usuário com `sudo dnf install` do RPM 0.2.0.

Login, streaming autenticado, qualidade HD/Ultra HD e saída bit-perfect não
foram validados. A documentação de qualidade e das APIs autorizadas está no
README. A preferência de GPU controla renderização, sem prometer áudio HD.

## Ícone — versão 0.1.2

- SVG atualizado com sorriso branco, fundo azul e cantos arredondados.
- PNG de 512×512 renderizado a partir do SVG para a janela Electron.
- Painel GTK inspecionado em `build/native-preview-0.1.2.png`.
- Teste integrado passou: GTK, preferências, IPC, MPRIS, pixels,
  tela de erro e nova tentativa.
- RPM 0.1.2 passou em `rpm -K` e na verificação SHA-256.
- SVG do menu e PNG do Electron extraídos do RPM conferidos byte a byte
  com os arquivos finais do projeto.

## Player — versão 0.1.1

Versão do aplicativo: 0.1.1. Ambiente: Fedora 44 x86_64, GTK 4.22, libadwaita 1.9 e Electron/CastLabs
44.5.1+wvcus.

- 8 testes JavaScript passaram: política de navegação, validação de preferências,
  estado e comandos de mídia, RPC Unix, fragmentação, limites de entrada e
  detecção de imagens pretas ou transparentes.
- 3 testes Python passaram: extração de arquivos, rejeição de symlinks e
  traversal, cálculo de SHA-256.
- O teste de integração abriu uma janela GTK real e carregou a página local
  de teste no renderer Electron, com sandbox habilitado. Também verificou
  preferências, tema, comunicação IPC e registro MPRIS na sessão D-Bus.
  O teste agora captura os pixels da janela, provoca uma falha de carregamento,
  verifica a tela de erro e aciona o botão de tentar novamente.
- O mesmo teste passou com o aplicativo e runtime extraídos do RPM final.
- A captura do painel foi inspecionada em `build/native-preview.png`.
- O arquivo desktop foi validado com `desktop-file-validate`.
- O RPM passou em `rpm -K`; seu arquivo SHA-256 foi conferido.
- O pacote inclui o helper Chromium com proprietário root e modo 4755.
  O teste sem instalação usa namespaces de usuário, com
  `--disable-setuid-sandbox`, preservando o sandbox dos renderers.

O lançador foi corrigido para remover `CHROME_DESKTOP` herdado de outro app
Electron. O diagnóstico mostrou que essa identidade provocava uma thread de
monitoramento GLib antes da inicialização do sandbox do zygote.

O catálogo real de `music.amazon.com.br` foi carregado em um perfil temporário
com renderização por software e sandbox habilitado. A captura de tela confirmou
o catálogo, a busca e o botão Fazer Login. O primeiro download de Widevine
foi concluído e o app indicou corretamente a necessidade de reiniciar.

O RPM 0.1.1 passou no teste integrado depois de extraído e teve seu SHA-256
conferido. A atualização da instalação do sistema precisa ser executada pelo
usuário com `sudo`; a instalação existente permaneceu na versão 0.1.0.

Login e streaming autenticado não foram testados com uma conta Amazon. HD/Ultra HD e
downloads offline não fazem parte da versão entregue.
