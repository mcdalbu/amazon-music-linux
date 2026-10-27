# Validação — Node.js 0.5.0

A versão 0.5.0 foi reescrita com Node.js 24.22.1, node-gtk 4.1.1, GTK4/libadwaita,
D-Bus em Node.js e CastLabs Electron 44.5.1+wvcus. O código Python anterior permanece
apenas no arquivo local ignorado `build/legacy-python-0.4.4/`.

Ambiente: Fedora 44 x86_64, GNOME/Wayland, Intel Arc, escala 2, monitor reportando
120 Hz. Os testes usam uma página local e sessão temporária, sem a conta Amazon.

## Testes

`./scripts/test.sh` verifica políticas de URLs e IPC, preferências privadas,
limites de texturas e capas, estado do Widevine, taxa do monitor e caminhos seguros
nos arquivos de runtime. O arquivo desktop passa em desktop-file-validate.

`./scripts/run.sh --smoke-test --enable-gpu` e `--disable-gpu` verificam:

- Janela Adw.ApplicationWindow única; zero janelas Electron visíveis; sandbox ativo.
- Pixels reais da página e textura física 2560×1628 com escala 2.
- Preferências nativas, alterações de tema, opção GPU e segundo plano persistidos.
- Entrada Unicode, clique e scroll preciso com resposta da página.
- Capas da sessão de mídia, cache local e troca para próxima/anterior.
- Comandos Play, Pause, Next, Previous e Raise pelo serviço MPRIS real em D-Bus.
- Áudio local em segundo plano, pausa, reabertura e mute.
- Alvos 60/144/120 Hz e transições entre idle 15 e interação 120.
- Fluxo contínuo de frames sem reter leases até o garbage collector JavaScript.
- Encerramento dos processos após o teste, inclusive GPU/Vulkan/Wayland.

Foi corrigido um bloqueio de roundtrip Wayland ao apresentar/destruir uma janela
em uma continuation JavaScript executada pelo binding durante GLib prepare.
Essas operações são despachadas por GLib.idleAdd.

Logs e imagens locais ficam em `build/node-*.log` e `build/node-gpu.png`.

## Limites

O áudio de teste é um WAV local sem DRM. Login e streaming reais da Amazon,
qualidade HD/Ultra HD, outras GPUs/distribuições e ARM64 não foram validados.
A taxa do monitor é um alvo; não se afirma taxa sustentada de 120/144 fps.
Os números de CPU da fixture local não representam a página real da Amazon.

## Resultado do RPM final

O RPM extraído foi executado com seu próprio Node.js e seus módulos, sem usar o
runtime ou node_modules do ambiente de desenvolvimento. Os testes completos
passaram com GPU e software, e ambos encerraram com código 0. O aplicativo manteve
uma janela GTK e nenhuma janela Electron visível. O caminho GPU usou DMA-BUF.

Na amostra ociosa de três segundos da fixture, ambos os modos mediram cerca de
1,3% de um núcleo para a árvore de processos e zero novos frames. É uma amostra
curta e local, não uma estimativa de streaming real. Os logs estão em
`build/node-packaged-gpu.log` e `build/node-packaged-software.log`.

Os 13 testes Node.js passaram, o arquivo desktop foi validado, `rpm -K` confirmou
os digests e os arquivos `app/`, `electron/` e `assets/` do pacote foram comparados
byte a byte com o workspace. As dependências RPM não incluem Python.

O catálogo público foi renderizado em perfil temporário, e a verificação EME
Widevine concluiu com `ready: true`. O teste mostrou GPU ativa e nenhuma janela
Electron visível. Isso não valida streaming com uma conta Amazon. Log local:
`build/node-web-check.log`.

A sensibilidade do scroll aumentou 20% para roda do mouse e touchpad. O teste
unitário verifica movimentos fracionários e direção em ambos os eixos.


# Validação de memória — 0.5.1

A ação manual de redução de memória usa a conexão interna do debugger Electron
para solicitar coleta de lixo e pressão moderada ao Chromium, sem abrir uma porta
de depuração. A ação não recarrega a página nem limpa cookies ou armazenamento.
Uma conexão de debugger já existente é respeitada e a conexão temporária é sempre
removida, inclusive quando a solicitação falha.

A limpeza em segundo plano é uma tentativa única após 15 segundos; reabrir cancela
o timer. O teste integrado verifica áudio ativo depois dessa limpeza, liberação
da textura GTK, zero páginas alocadas no memfd de frames e novo frame com conteúdo
quando a janela é reaberta. O teste manual cria lixo JavaScript temporário; não é
uma simulação do consumo de uma conta Amazon. Em uma execução local, o heap usado
caiu de 26,8 MB para 1,3 MB após a coleta. O resultado não promete a mesma redução
na página real, cujos objetos ainda referenciados não podem ser liberados.

O modo software agora lê o slot compartilhado diretamente em um GBytes nativo,
eliminando o Buffer JavaScript temporário e a cópia adicional por frame. Há um
acknowledgement da pausa de captura antes de descartar todas as páginas do memfd;
isso evita descartar buffers que possam estar em uso durante uma reabertura rápida.
Frames de uma janela oculta são devolvidos sem serem apresentados.

A entrega de frames tem fallback limitado quando o compositor suspende os ticks
de uma janela coberta. Os testes distinguem frames recebidos de frames apresentados
para não confundir oclusão da janela com falha do renderizador. O alvo de interação
e a sensibilidade de scroll aumentada em 20% continuam preservados.


Resultado final 0.5.1: os 16 testes Node.js passaram. O teste completo em software
passou, incluindo entrada, MPRIS, áudio, temas, memória e recuperação de frames.
A suíte específica de memória passou a partir do RPM extraído, com os runtimes do
pacote, tanto em GPU quanto em software. As duas execuções mantiveram áudio ativo,
liberaram a textura e as páginas do memfd enquanto ocultas, restauraram uma imagem
não uniforme ao reabrir, coletaram lixo manualmente e receberam 100 novos frames
de animação após a coleta. Próxima/anterior e pausa continuaram funcionando.

No heap da fixture do RPM, a medição ficou aproximadamente 26,8 MB antes e 1,3 MB
depois. O memfd volta a alocar páginas no modo software quando a janela reaparece;
a liberação verificada é enquanto ela está escondida. Os logs são
`build/memory-packaged-gpu.log` e `build/memory-packaged-software.log`.

Algumas execuções do smoke geral tiveram timeouts intermitentes na etapa de
entrada sintética de texto. O teste específico de memória evita essa etapa e não
serve como validação adicional do teclado. A reprodução e os controles de memória
foram verificados separadamente em ambos os caminhos de renderização.

Para repetir a suíte focada:

```bash
AMZML_MEMORY_TEST=1 ./scripts/run.sh --smoke-test --enable-gpu
AMZML_MEMORY_TEST=1 ./scripts/run.sh --smoke-test --disable-gpu
```
