# Amazon Music — Chromium wrapper

Esta versão abre o site do Amazon Music Brasil em uma janela de aplicativo do
**Chromium do sistema**. Não inclui Electron, GTK, Node.js nem um navegador próprio
no RPM. Pode coexistir com a versão GTK/Electron.

## Instalar e abrir

```bash
sudo dnf install ./dist/amazon-music-pwa-0.6.0-1.fc44.noarch.rpm
amazon-music-pwa
```

O pacote requer Chromium ou Google Chrome estável. Abra **Amazon Music (Chromium)**
no lançador e fixe o ícone no dock/shelf pela janela aberta. O ícone é o sorriso
branco no fundo azul. A identidade Wayland coincide com o arquivo `.desktop`;
`StartupWMClass` cobre X11. Não precisa instalar o site novamente pelo menu do
navegador. Usa o modo `--app` do Chromium; não oferece cache offline próprio.

O perfil fica em `~/.local/share/amazon-music-pwa/chromium/` (ou abaixo de
`XDG_DATA_HOME`). Login e cookies são separados da versão anterior e do navegador
pessoal. É necessário entrar na conta Amazon uma vez. Abrir novamente usa o mesmo
processo/perfil do wrapper. Fechar a última janela encerra o player; para manter a
música, minimize a janela.

## Mini player

O mini player do GNOME e as teclas de mídia usam o MPRIS nativo do Chromium.
Após iniciar uma faixa, o navegador publica os metadados e a arte fornecidos pelo
site. Reproduzir/pausar e próxima/anterior dependem dos controles Media Session
expostos pelo site. Não há extensão, script injetado ou porta de depuração no
aplicativo instalado. O mini player aqui é o controle de mídia do desktop, não uma
segunda janela flutuante criada pelo wrapper.

O MPRIS pertence ao Chromium: o desktop pode identificá-lo como Chromium/Chrome.
O navegador não oferece `Raise` via MPRIS; para reabrir a janela, use o ícone no
dock/shelf. A identidade e o ícone da janela são os do Amazon Music.

Reprodução protegida, codecs e Widevine vêm do navegador instalado. Se o Chromium
não reproduzir sua conta, tente Chrome, que também usa Chromium:

```bash
AMZML_PWA_BROWSER=google-chrome-stable amazon-music-pwa
```

Para escolher permanentemente o navegador, defina `AMZML_PWA_BROWSER` no ambiente
da sessão. Ao alternar entre navegadores, use perfis distintos com
`AMZML_PWA_PROFILE=/caminho/absoluto/para/perfil`. A variável aceita um diretório
absoluto, e `AMZML_PWA_BROWSER` aceita um executável, sem argumentos adicionais.
Não reutilize um perfil do seu navegador pessoal.

## Desenvolvimento e validação

```bash
./scripts/node.sh --test tests/pwa.test.cjs
sh -n pwa/amazon-music-pwa
desktop-file-validate pwa/*.desktop
./scripts/node.sh tests/pwa-live.cjs
./scripts/node.sh scripts/build-pwa.cjs
```

O teste ao vivo requer uma sessão Wayland com D-Bus e Chromium. Cria um perfil
temporário e usa uma faixa sintética para verificar o app ID real e os controles
MPRIS. Somente esse teste habilita depuração local para carregar a fixture, sem
usar cookies pessoais. O log temporário fica em `/tmp/amzml-pwa-live-*/wayland.log`.
Streaming autenticado Amazon e HD/Ultra HD exigem validação com uma conta real.

A implementação do ID segue `GetXdgAppIdForWebApp` e
`CHROME_WEB_APP_DESKTOP_ID_PREFIX` no
[código-fonte do Chromium](https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/browser/shell_integration_linux.cc).
