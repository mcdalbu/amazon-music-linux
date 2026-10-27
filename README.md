# Amazon Music Linux

Cliente independente do Amazon Music para Linux, refeito em **Node.js**, com
**GTK4/libadwaita** na interface e **CastLabs Electron** na renderização do player.
A versão 0.5.0 substitui a aplicação Python. A implementação é própria e não usa
código ou base do Karere.

## Instalação

Feche a versão anterior pela opção **Sair** antes de instalar:

```bash
sudo dnf install ./amazon-music-linux-0.5.1-1.fc44.x86_64.rpm
amazon-music-linux
```

O RPM inclui Node.js 24.22.1, os módulos de produção e CastLabs Electron
44.5.1+wvcus. Não é necessário instalar Node.js ou npm para usar o aplicativo.
Construído e testado no Fedora 44 x86_64, GNOME/Wayland. ARM64 não foi validado.

## Interface e integração

- Uma janela visível GTK4/libadwaita, com a estrutura anterior: Início, Recarregar,
  Reproduzir/Pausar, menu e preferências integradas.
- Aparência Sistema, Clara ou Escura, com acompanhamento da aparência do GNOME.
- Ícone azul com sorriso branco, mantendo a identidade visual solicitada.
- Player com escala física HiDPI, zoom e escala atualizados ao mudar de monitor.
- Teclado com composição de texto, Unicode, copiar/colar e rolagem precisa de touchpad,
  com sensibilidade aumentada em 20%.
- Oito regiões do Amazon Music nas preferências.
- Mini player do GNOME via MPRIS: metadados, arte do álbum, reproduzir/pausar e
  próxima/anterior quando disponíveis na sessão de mídia.
- Segundo plano opcional: fechar a janela mantém o áudio; o indicador oferece
  abrir, reproduzir/pausar, silenciar e sair.

No GNOME, o indicador requer a extensão
[AppIndicator and KStatusNotifierItem Support](https://extensions.gnome.org/extension/615/appindicator-support/).
Sem ela, a opção de segundo plano continua disponível; reabra pelo lançador ou
pelo mini player do GNOME. O app não instala extensões automaticamente.

Atalhos: `Ctrl+,` para preferências, `Ctrl+R` para recarregar, `Ctrl+Q` para sair e
`Ctrl++`, `Ctrl+-`, `Ctrl+0` para zoom. Erros de carregamento têm **Tentar novamente**.

As preferências continuam em `~/.config/Amazon Music Linux/settings.json` e a
sessão em `~/.local/share/amazon-music-linux/electron/`. A atualização não apaga a
sessão nem importa perfis de outros clientes. Testes usam diretórios temporários.

## Desempenho e reprodução protegida

Em **Preferências → Desempenho**, habilite aceleração de hardware e reinicie.
A janela GTK usa Vulkan para o caminho GPU; uma definição explícita de
`GSK_RENDERER` é respeitada. Quando a importação de texturas não é suportada,
o aplicativo recorre automaticamente a bitmaps. O modo software também está
presente, com backend oculto X11/XWayland quando disponível.

Durante interação, o alvo acompanha a taxa do monitor, até 240 fps. Após dois
segundos sem interação, a renderização cai para até 15 fps. O GTK só mantém
callbacks de apresentação enquanto há frames chegando. A taxa efetiva depende
do desktop, da carga e dos drivers; não há garantia de 120/144 fps sustentados.
A reprodução de áudio e os controles do GNOME são independentes da taxa visual.

```bash
amazon-music-linux --enable-gpu
amazon-music-linux --disable-gpu
```

O suporte Widevine vem do atualizador do runtime CastLabs; o CDM não é redistribuído
no RPM. O estado disponível exige uma verificação EME concluída. Uma versão do CDM
já presente na inicialização não gera novamente o aviso de reinício. É possível
repetir a verificação em **Preferências → Reprodução protegida**.

A qualidade de áudio é a entregue pelo site da Amazon. Conta, região, plano e DRM
podem limitar HD/Ultra HD. **Streaming com conta Amazon e HD/Ultra HD não foram
validados nesta reescrita.** Não há saída bit-perfect, modo exclusivo ou downloads
offline.

## Reduzir o uso de memória

Use **Menu → Reduzir uso de memória** ou **Preferências → Desempenho → Uso de
memória → Reduzir agora**. A ação solicita coleta de lixo e recuperação de páginas
não utilizadas pelo Chromium. Ela pode causar uma breve pausa visual.

Também é feita uma tentativa de limpeza, uma única vez, após 15 segundos em segundo
plano. Reabrir a janela cancela essa tentativa pendente. O player não é recarregado
e o áudio continua ativo; cookies, login e dados da sessão são preservados.

Enquanto a janela está escondida, a textura GTK e os frames pendentes são liberados,
e as páginas físicas dos buffers compartilhados são descartadas após o backend
confirmar a pausa da captura. Reabrir solicita um novo frame. O modo software lê
os pixels diretamente no buffer nativo GTK, evitando uma cópia intermediária em
Buffer JavaScript a cada frame.

A memória ainda referenciada pelo site da Amazon permanece necessária. A limpeza
não impõe limites artificiais ao JavaScript nem promete um valor fixo de RAM.

## Arquitetura

- `app/main.cjs`: janela GTK4/libadwaita, preferências e entrada em Node.js.
- `app/engine.cjs`: processo Electron e protocolo privado de frames/eventos.
- `app/desktop.cjs`: MPRIS em D-Bus e cache limitado de capas.
- `app/settings.cjs`: preferências e estado de DRM.
- `app/bridge.c`: ponte Node-API para descritores Unix e texturas GTK. Gerencia
  a liberação de DMA-BUFs quando o GTK termina de usá-los, sem depender do GC JavaScript.
- `electron/`: renderizador oculto, políticas e observação isolada da sessão de mídia.
- `scripts/`: preparação dos runtimes, compilação, testes e RPM em Node.js/shell.

O renderer web mantém sandbox, isolamento de contexto e segurança web, sem Node.js
na página. Não há servidor HTTP ou porta de depuração. Links externos HTTPS abrem
no navegador. Capas têm limite de tamanho, domínios permitidos e controle de geração
para evitar que uma resposta atrasada substitua a capa de outra faixa.

Operações de apresentação e encerramento das janelas são agendadas no contexto
de despacho do GTK, evitando roundtrips Wayland dentro da fase de preparação do
loop, onde o binding drena continuations JavaScript.

## Desenvolvimento

Requer Node.js **24.x**, pnpm **11.25.0**, compilador C, headers GTK4 e ferramentas RPM.
O binding `node-gtk` usa binário nativo específico da ABI Node 24. O runtime Node do
RPM é fixado para manter essa ABI. O lockfile contém as versões das dependências.

```bash
sudo dnf install gcc pkgconf-pkg-config gtk4-devel libadwaita gobject-introspection rpm-build desktop-file-utils curl unzip tar xz
pnpm install --frozen-lockfile
node scripts/runtimes.cjs
node scripts/build-native.cjs
./scripts/run.sh --preview
./scripts/test.sh
./scripts/run.sh --smoke-test --disable-gpu
./scripts/run.sh --smoke-test --enable-gpu
node scripts/build.cjs
```

Os runtimes são baixados de suas fontes oficiais com SHA-256 fixado. A saída está
em `dist/`, junto do checksum. Depois da preparação, os builds podem usar o cache
local. O código antigo foi arquivado localmente em `build/legacy-python-0.4.4/` e
não faz parte do novo RPM.

Os testes integrados verificam pixels reais, uma janela visível, HiDPI, temas,
preferências, texto Unicode, cliques, scroll, MPRIS por D-Bus, capas, próxima/anterior,
áudio em segundo plano e a transição entre 15 fps e a taxa do monitor. Consulte
[VALIDATION.md](VALIDATION.md) para resultados e limites da validação.

## Licenças

Código do projeto: MIT. Node.js, Electron/Chromium e as dependências possuem suas
próprias licenças, incluídas no pacote. Os cabeçalhos Node-API têm licença em
`vendor/node-api/LICENSE`. Amazon e Amazon Music são marcas de seus titulares.
Este cliente não é oficial.
