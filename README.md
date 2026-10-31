# Amazon Music

Cliente independente do Amazon Music para Linux com **Electron incluído**, ícone
na bandeja, reprodução em segundo plano e mini player do GNOME. Não precisa ter
Chrome, Chromium ou Node.js instalado para usar o RPM.

Baixe o RPM e o checksum na [release 0.7.1](https://github.com/mcdalbu/amazon-music-linux/releases/tag/v0.7.1).

```bash
sudo dnf install ./amazon-music-electron-0.7.1-1.fc44.x86_64.rpm
amazon-music-electron
```

O aplicativo aparece no lançador como **Amazon Music**. Feche a versão anterior
pela opção **Sair** antes de atualizar. O perfil e o login da versão Electron
0.7.0 são preservados.

- O tema acompanha a preferência clara/escura do sistema e suas mudanças durante
  o uso, pelo portal de aparência do desktop. Menus nativos, fundo da janela e
  `prefers-color-scheme` da página recebem a preferência; o site da Amazon decide
  como desenhar seu próprio conteúdo.
- O ícone azul com sorriso branco identifica a janela no dock/shelf e na bandeja.
- Fechar a janela mantém a música em segundo plano. A bandeja oferece abrir,
  reproduzir/pausar, próxima/anterior, silenciar e sair.
- O mini player do GNOME mostra metadados e capas, com controles MPRIS e a
  identidade **Amazon Music**.
- Oito regiões no menu. O site inicial é o Amazon Music Brasil.

No GNOME, mostrar ícones de bandeja requer a extensão **AppIndicator and
KStatusNotifierItem Support**. Para encerrar de verdade, use **Sair** ou `Ctrl+Q`.
O app não instala extensões automaticamente.

O RPM inclui CastLabs Electron 44.5.1+wvcus. O atualizador do runtime obtém o
Widevine; o CDM não é redistribuído. Streaming com conta Amazon e HD/Ultra HD
precisam de validação com uma conta real. A qualidade disponível depende da
Amazon, da região, da conta e do plano. Este cliente não é oficial.

[Detalhes da versão atual](electron-wrapper/README.md) ·
[Validação](electron-wrapper/VALIDATION.md) ·
[Wrapper Chromium opcional](pwa/README.md) ·
[Versão GTK anterior](docs/gtk-client.md).

Desenvolvimento, com Node.js 24 e as dependências do projeto instaladas:

```bash
pnpm install --frozen-lockfile
./scripts/node.sh scripts/runtimes.cjs
./scripts/run-electron.sh
./scripts/test.sh
./scripts/node.sh tests/electron-live.cjs
./scripts/node.sh scripts/build-electron.cjs
```

O código de tema consulta `org.freedesktop.portal.Settings` e acompanha
`SettingChanged`; sem portal disponível, usa a detecção nativa do Electron.
Os testes ao vivo usam um portal D-Bus e perfil temporários, sem mudar o tema da
sessão pessoal. O código-fonte é MIT; as licenças do Electron/Chromium e das
bibliotecas são incluídas no pacote. Amazon e Amazon Music são marcas de seus
titulares.
