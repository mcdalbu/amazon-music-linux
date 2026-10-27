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
