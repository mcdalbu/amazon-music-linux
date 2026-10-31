# Amazon Music 0.7.1 — validação em 2026-10-31

Fedora 44, GNOME/Wayland, x86_64; CastLabs Electron 44.5.1+wvcus.

O teste ao vivo usa um perfil temporário, uma faixa sintética e um serviço D-Bus
de teste com a interface do portal de aparência. Não altera o tema da sessão do
usuário nem utiliza sua conta Amazon.

Verificações:

- Preferência inicial escura e mudanças ao vivo para clara, escura e padrão,
  verificando `nativeTheme`, o fundo da janela e a consulta CSS
  `prefers-color-scheme` no renderer, sem recarregar a página.
- Nome do aplicativo e identidade MPRIS iguais a **Amazon Music**.
- App ID Wayland `io.github.amzml.AmazonMusicElectron`, correspondente ao lançador.
- Uma janela Electron normal, renderer em sandbox, isolamento de contexto e
  integração Node desabilitada.
- Fechar a janela oculta a interface e mantém o áudio.
- Registro da bandeja no host StatusNotifier, pixels do ícone e ação D-Bus
  Activate para reabrir a janela.
- Ações reais DBusMenu de reproduzir, pausar, silenciar e sair.
- MPRIS com DesktopEntry, título/artista, capa PNG válida, controles de faixa,
  troca da capa e chamada Raise, sem serviço Chromium duplicado.
- Testes unitários, sintaxe JavaScript/shell e validade do arquivo desktop.

O pacote inclui seu próprio runtime e as bibliotecas JavaScript de produção para
D-Bus. Não depende de Chrome, Chromium ou Node.js instalado. O arquivo do runtime
é validado pelo SHA-256 fixado antes do empacotamento. Os IDs internos e o caminho
do perfil da versão 0.7.0 foram mantidos para preservar login e associação da
janela ao lançador.

O portal é a fonte da preferência de aparência; sem ele, o aplicativo usa a
detecção nativa do Electron. O site da Amazon decide como aplicar essa preferência
ao seu próprio conteúdo. A validação de tema não aplica CSS que substitua as cores
do site.

Streaming autenticado, Widevine e HD/Ultra HD continuam sem validação com conta
real. X11 e a fixação visual no dock não foram exercitados; o app ID Wayland e os
arquivos de lançador/ícone foram verificados. A bandeja depende de um host
StatusNotifier; no GNOME é necessária a extensão AppIndicator.
