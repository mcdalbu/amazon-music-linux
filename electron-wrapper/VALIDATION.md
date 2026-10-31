# Amazon Music 0.7.2 — validação em 2026-10-31

Fedora 44, GNOME/Wayland, x86_64; CastLabs Electron 44.5.1+wvcus, GTK 3.24.52.

A reprodução do bug confirmou que o GNOME e o portal indicavam modo escuro, mas
as cores GTK do processo continuavam claras: menu RGB (246,245,244) e barra de
título (221,218,214), com `gtk-theme-name=Adwaita-dark` e a preferência GTK escura
desativada. Testar apenas `nativeTheme` e a consulta CSS não cobria essas barras.

A ponte Node-API agora sincroniza `gtk-application-prefer-dark-theme` no próprio
processo e normaliza Adwaita-dark para a base Adwaita, permitindo alternar as
variantes clara/escura. O backend é explicitamente GTK3. Nenhuma configuração do
GNOME é alterada. A ponte não é exposta ao renderer web.

O teste ao vivo renderiza os estilos reais GtkMenuBar e GtkHeaderBar em superfícies
Cairo, sem apresentar janelas GTK extras. Verifica os pixels e a preferência GTK
na inicialização escura e nas trocas para claro e escuro, além de verificar a
preferência CSS da página. No modo escuro, menu RGB (53,53,53) e título (40,40,40).

Também verificados:

- Identidade Amazon Music e app ID Wayland correspondente ao lançador.
- Uma janela Electron normal com renderer em sandbox, isolamento de contexto e
  sem integração Node.
- Fechar a janela mantém áudio em segundo plano; a bandeja reabre a janela.
- Registro StatusNotifier e ações DBusMenu de reproduzir/pausar, silenciar e sair.
- MPRIS com metadados, capas PNG, troca de faixa e chamada Raise.
- Testes unitários, sintaxe e validade do arquivo desktop.

Os testes usam um perfil e portal D-Bus temporários; não alteram o tema da sessão
pessoal. O pacote contém o runtime e a ponte nativa compilada. Os IDs internos e
o perfil foram mantidos para preservar o login das versões Electron anteriores.

Streaming autenticado, Widevine e HD/Ultra HD continuam sem validação com conta
real. X11 e a fixação visual no dock não foram exercitados. O teste verifica as
cores dos estilos GTK usados pelas barras; não captura a janela completa do app
instalado. O site da Amazon decide como aplicar cores ao seu próprio conteúdo.
