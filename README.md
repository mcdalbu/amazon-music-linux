# Amazon Music Linux

Cliente independente de Amazon Music para Linux com **GTK4, libadwaita e CastLabs Electron**,
inspirado na arquitetura do [Karere](https://github.com/tobagin/karere).
Na versão 0.4.0, Electron volta como backend. A janela, a barra de título, as bordas,
o menu e as preferências continuam nativos. Há somente uma janela visível.

## Instalar

```bash
sudo dnf install ./dist/amazon-music-linux-0.4.3-1.fc44.x86_64.rpm
amazon-music-linux
```

O RPM inclui CastLabs Electron com codecs AAC/H.264 e suporte Widevine. Depende de
GTK4, libadwaita e PyGObject para a interface; GTK3 e libappindicator são dependências do processo Electron separado. Foi construído no Fedora 44 x86_64. Feche a versão antiga antes
de abrir a nova.

As preferências são preservadas em `~/.config/Amazon Music Linux/settings.json`.
A sessão fica em `~/.local/share/amazon-music-linux/electron/`, em diretório privado.
A sessão CEF da versão 0.3.0 e a sessão Electron da versão 0.2.x são preservadas,
mas não são importadas automaticamente. É necessário fazer login no novo perfil.

## Janela e recursos

- GTK4/libadwaita, incluindo título, bordas e controles de janela.
- Aparência Sistema, Clara ou Escura; acompanhamento do portal do desktop ao vivo.
- Amazon Music integrado, com Electron offscreen e preferências em diálogo na janela.
- Ícone com sorriso branco sobre fundo azul e oito regiões do Amazon Music.
- Navegação, cliques, rolagem, teclado com IME e comandos de copiar/colar.
- HiDPI: frames renderizados na resolução física da superfície GTK, com coordenadas
  de entrada e zoom corrigidos. A escala é atualizada ao mudar de monitor.
- Zoom com Ctrl+mais, Ctrl+menos e Ctrl+0; preferências com Ctrl+vírgula.
- MPRIS com reproduzir/pausar, próxima/anterior, estado, título, artista, álbum e
  capa da faixa. Próxima/anterior seguem as ações disponíveis na sessão de mídia.
  Seek não é anunciado. Abrir e sair também estão disponíveis.
- Erros visíveis com Tentar novamente e persistência de sessão.

A janela usa Python/PyGObject. Um processo Electron separado mantém um
`BrowserWindow` oculto com renderização offscreen. Um socket privado herdado
encaminha entrada e eventos. Um segundo socket transfere os descritores das
texturas GPU por SCM_RIGHTS; no modo bitmap, são usados buffers compartilhados BGRA. Frames pendentes são
substituídos pelo mais recente para limitar uso de memória. Não há segunda janela
Electron na área de trabalho. A arquitetura foi inspirada no Karere; seu código
Rust específico de WhatsApp não foi copiado.

O renderer Electron permanece com sandbox, isolamento de contexto e segurança web
habilitados, sem Node.js na página. Não há porta de depuração ou servidor HTTP local.
Navegações ficam nos domínios Amazon permitidos; outros links HTTPS abrem no navegador.
Popups Amazon são encaminhados ao mesmo player. O preload isolado observa mídia e
verifica EME, sem expor operações privilegiadas à página. Downloads offline e
permissões de microfone/câmera não são implementados.

## Segundo plano e integração com GNOME

Em **Preferências → Integração com o desktop**, ative **Executar em segundo plano**.
A alteração é imediata e fica salva. Fechar a janela mantém o áudio em reprodução;
o ícone na barra superior oferece Abrir Amazon Music, Reproduzir/Pausar, Silenciar
áudio e Sair. Use **Sair** ou **Ctrl+Q** para encerrar de verdade. Ao desativar a opção,
o ícone é removido e fechar a janela volta a encerrar o aplicativo.

No GNOME, o tray requer a extensão
[AppIndicator and KStatusNotifierItem Support](https://extensions.gnome.org/extension/615/appindicator-support/).
O app detecta o host de indicadores e informa sua disponibilidade nas preferências.
Sem a extensão, o segundo plano ainda funciona; reabra pelo lançador do aplicativo
ou pelo player de mídia do GNOME. Nenhuma extensão é instalada ou ativada pelo app.

O mini player do GNOME recebe a arte do álbum por `mpris:artUrl`, além da
identidade correta em `DesktopEntry`. A capa é obtida da sessão de mídia e salva
em um cache local limitado, sem bloquear a interface. Uma resposta atrasada
não substitui a capa de outra faixa. O PNG azul com sorriso é o fallback quando
não há capa disponível. Próxima/anterior acionam nexttrack/previoustrack na página.
O detector acompanha áudio criado pelo JavaScript, inclusive fora do HTML, e usa
a sessão de mídia para título, artista, álbum e ações de reprodução. As mudanças
são publicadas imediatamente ao GNOME, sem esperar a próxima consulta periódica.
A publicação MPRIS automática do Chromium é desabilitada no backend; a integração
nativa controla a identidade e os botões. A renderização de frames é suspensa
enquanto a janela está escondida, preservando áudio e controles de mídia.

## Aceleração de hardware

A janela GTK usa Vulkan para texturas GPU e OpenGL no modo software. Uma definição
explícita de `GSK_RENDERER` continua sendo respeitada; GTK tenta outro renderizador
caso o selecionado não esteja disponível.

Em **Preferências → Desempenho**, altere Aceleração de hardware e clique Reiniciar.
A escolha é salva antes da próxima inicialização do Electron. Software é o padrão.
A disponibilidade de aceleração depende do driver/hardware. A preferência controla
renderização; não define a qualidade do áudio. A taxa de saída acompanha automaticamente
o monitor em que a janela está (inclusive 120/144 Hz), e é atualizada ao mudar
de monitor ou de taxa. A apresentação segue o frame clock do GTK. O app respeita
os pixels fracionários do touchpad e informa ao Chromium que a entrada é precisa.
Com aceleração ativa e GTK ≥ 4.14, o app importa as texturas DMA-BUF diretamente
na GPU, mantendo cada buffer reservado até o GTK terminar de usá-lo. Isso elimina
o readback GPU→CPU e o upload de um bitmap inteiro em cada quadro.

Drivers sem suporte à exportação/importação usam automaticamente o caminho de
compatibilidade por bitmaps, com três buffers privados `memfd`. Software também
usa esse caminho. O alvo acompanha o monitor, até 240 fps; a taxa efetiva depende
da carga e do driver. No teste local HiDPI a 120 Hz, a saída GPU direta atingiu
cerca de 112 fps, contra 32 fps do caminho anterior; não foram comprovados 120 fps
sustentados. As preferências mostram se a aceleração está ativa ou se o Chromium
recorreu a software por falha do driver. `AMZML_SHARED_TEXTURE=0` força o caminho
de compatibilidade para diagnóstico.

No modo software, o backend oculto usa X11/XWayland quando há DISPLAY disponível,
evitando uma superfície vazia observada com software/Wayland neste ambiente.
A janela GTK continua no backend nativo do desktop.

```bash
amazon-music-linux --disable-gpu
amazon-music-linux --enable-gpu
```

`--disable-gpu` tem prioridade sobre a preferência salva. Ao reiniciar pelo aplicativo,
esses overrides são removidos.

## Widevine e qualidade de áudio

O runtime fixado é **CastLabs Electron 44.5.1+wvcus**, com Chromium 152.0.7977.130.
O download é validado com SHA-256 fixado. O app usa o atualizador de componentes
CastLabs para instalar/registrar Widevine. Widevine não está incluído no RPM.

**Disponível** só aparece depois de `requestMediaKeySystemAccess` e `createMediaKeys`
terem sucesso para áudio AAC protegido. A decisão de reiniciar usa o resultado
concluído de `components.whenReady`, não o resultado vazio de `components.status`
durante a inicialização. Um CDM já presente na inicialização não gera novamente
esse aviso. Uma verificação EME bem-sucedida também dispensa reinício. Verificar
CDM permite repetir a verificação de registro e mostra falhas do atualizador.

O catálogo público e a criação de MediaKeys Widevine foram testados. **Login e
streaming com conta Amazon, inclusive HD/Ultra HD, ainda precisam de validação.**
A qualidade é a que o player da Amazon entregar; não há saída bit-perfect, modo
exclusivo ou player próprio via API da Amazon.

## Desenvolvimento

O Node.js está incluído no runtime Electron; não é necessário instalá-lo nem usar npm.

```bash
sudo dnf install rpm-build python3 python3-gobject gtk4 libadwaita gtk3 desktop-file-utils
/usr/bin/python3 scripts/build.py --runtime-only
./scripts/run.sh --preview
./scripts/test.sh
./scripts/run.sh --smoke-test
./scripts/run.sh --smoke-test --enable-gpu
/usr/bin/python3 scripts/build.py
```

O primeiro build baixa o runtime com checksum fixado; os seguintes podem funcionar
sem rede. Um compilador C é necessário para a pequena ponte Node-API, compilada
com os cabeçalhos oficiais fixados em `vendor/node-api/`. O RPM inclui a ponte pronta.
Para ARM64, execute o build em uma máquina aarch64. Apenas x86_64 foi
validado neste ambiente. A saída fica em `dist/`.

Os testes integrados usam perfil temporário e página local. Verificam widgets
nativos, ausência de janela Electron visível, sandbox, temas, preferências, GPU
persistida, HiDPI, entrada Unicode, cliques, rolagem, recuperação, redimensionamento,
áudio em segundo plano, ciclo do tray, troca da capa e controles próxima/anterior.
`--check-web` testa o catálogo/DRM em perfil temporário e encerra após a verificação;
`--diagnostics` permite inspeção manual. As versões anteriores estão preservadas
em `build/legacy-cef-source/`, `build/legacy-electron-source/` e `dist/`.

Referências técnicas: [Electron offscreen](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering),
[CastLabs Electron](https://github.com/castlabs/electron-releases).

## Licenças

Código do projeto: MIT. Electron e Chromium possuem licenças próprias, incluídas em
`runtime/LICENSE` e `runtime/LICENSES.chromium.html`. Os cabeçalhos Node-API têm
sua licença em `vendor/node-api/LICENSE`, incluída no RPM como `electron/LICENSE.Node-API`.
Karere é um projeto independente
sob GPL-3.0-or-later, citado como referência. Amazon e Amazon Music são marcas de
seus titulares. Este cliente não é oficial.
