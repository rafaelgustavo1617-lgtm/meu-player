# Meu Player

**▶ Abrir o app:** https://rafaelgustavo1617-lgtm.github.io/meu-player/

Player de música pessoal que **funciona sem internet**. Você importa as músicas do seu aparelho, elas ficam salvas dentro do app e tocam offline, como um app instalado no celular.

É um PWA (Progressive Web App) feito com HTML, CSS e JavaScript puro, sem frameworks e sem etapa de build.

## Funcionalidades

- Importar músicas (MP3, M4A, FLAC, WAV, OGG) de arquivos ou de uma pasta inteira
- Leitura das tags ID3 (título, artista, álbum e capa) direto do MP3, sem bibliotecas
- Biblioteca com busca e agrupamento por artista e álbum
- **Favoritos**
- Playlists: criar, renomear, excluir, adicionar e remover músicas
- Player completo: tocar/pausar, anterior/próxima, aleatório, repetir (todas/uma) e barra de progresso
- Controles na tela de bloqueio e no fone (Media Session API)
- Funciona 100% offline (Service Worker + IndexedDB)
- Instalável no celular (Android e iPhone)

## Como funciona por dentro

| Parte | Arquivo | O que faz |
|---|---|---|
| Interface | `frontend/js/app.js` | Telas, navegação, menus |
| Player | `frontend/js/player.js` | Fila, aleatório, repetir, Media Session |
| Banco local | `frontend/js/db.js` | IndexedDB: músicas (Blob), metadados e playlists |
| Metadados | `frontend/js/metadata.js` | Parser de ID3v2 escrito do zero |
| Offline | `frontend/sw.js` | Guarda o app em cache para abrir sem internet |
| Instalação | `frontend/manifest.webmanifest` | Nome, ícone e cores do app instalado |

## Rodar no computador

Precisa de um servidor local (service worker não funciona abrindo o arquivo direto):

```bash
cd frontend
python3 -m http.server 5173
# ou: npx serve .
```

Abra http://localhost:5173

## Publicar e instalar no celular

1. Crie um repositório no GitHub e envie este projeto:
   ```bash
   git init
   git add .
   git commit -m "Meu Player: primeira versão"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/meu-player.git
   git push -u origin main
   ```
2. No GitHub, vá em **Settings → Pages** e, em *Source*, escolha **GitHub Actions**.
3. Espere o deploy terminar (aba **Actions**). O site fica em `https://SEU-USUARIO.github.io/meu-player/`.
4. No celular, abra esse endereço:
   - **Android (Chrome):** menu ⋮ → **Instalar app**
   - **iPhone (Safari):** Compartilhar → **Adicionar à Tela de Início**
5. Abra pelo ícone, vá em **Importar** e escolha suas músicas. A partir daí funciona sem Wi-Fi.

> Ao mudar o código, aumente `VERSION` em `frontend/sw.js` para os celulares baixarem a versão nova.

## Observações

- As músicas ficam guardadas no armazenamento do navegador do aparelho. Se você apagar os dados do site/app, elas somem (os arquivos originais continuam no celular).
- No iPhone, o iOS pode pausar o áudio ao bloquear a tela em apps web; no Android funciona normalmente em segundo plano.

## Back-end e banco de dados

O back-end é a biblioteca "principal" que fica no seu computador: guarda os arquivos de áudio e um banco SQLite com músicas, artistas, álbuns, favoritos, playlists, histórico e ajustes. Feito só com Node.js nativo (`node:http` + `node:sqlite`), **sem nenhuma dependência**. Precisa de **Node 22.13 ou mais novo**.

```
backend/
├── data/meu-player.db      ← o banco de dados (criado sozinho)
├── storage/music/          ← os arquivos de áudio
├── storage/covers/         ← as capas extraídas dos MP3
├── src/
│   ├── config.js           ← onde cada coisa é salva
│   ├── db.js               ← tabelas (migrações)
│   ├── repo.js             ← todas as consultas SQL
│   ├── metadata.js         ← leitura das tags ID3 e duração do MP3
│   └── server.js           ← API REST + serve o front-end
├── scripts/import-folder.js
└── test/api.test.js
```

`data/` e `storage/` estão no `.gitignore`: suas músicas não vão para o GitHub.

### Tabelas

| Tabela | Guarda |
|---|---|
| `tracks` | cada música: título, artista, álbum, duração, arquivo, capa, favorito, quantas vezes tocou |
| `artists` | artistas (criados sozinhos a partir das músicas) |
| `albums` | álbuns, ano e capa |
| `playlists` / `playlist_tracks` | suas playlists e a ordem das músicas |
| `plays` | histórico de cada vez que uma música tocou (estatísticas e "Mais tocadas") |
| `settings` | ajustes do app (cor de destaque, equalizador...) |

### Rodar

```bash
cd backend
npm start            # http://localhost:3000 (API + app)
npm test             # roda os testes da API
```

### Adicionar músicas

- **Uma pasta inteira:** `npm run import -- "C:\Users\Rafael\Music"` (Windows) ou `npm run import -- ~/Músicas`
- **Pela API:** envie o arquivo como corpo da requisição
  ```bash
  curl -X POST http://localhost:3000/api/tracks \
    -H "X-File-Name: Banda - Musica.mp3" --data-binary @"Banda - Musica.mp3"
  ```
- O título, artista, álbum, ano, número da faixa e capa são lidos das tags do MP3. Sem tags, usa o nome do arquivo no formato `Artista - Título`.

### Editar informações

```bash
curl -X PATCH http://localhost:3000/api/tracks/ID-DA-MUSICA \
  -H "Content-Type: application/json" \
  -d '{"title": "Novo nome", "artist": "Outro artista", "album": "Álbum", "favorite": true}'
```

Para ver e editar o banco com uma interface, abra `backend/data/meu-player.db` no [DB Browser for SQLite](https://sqlitebrowser.org/).

### Rotas da API

| Método | Rota | O que faz |
|---|---|---|
| GET | `/api/tracks?q=&artist=&album=&favorite=1&sort=title\|recent\|plays` | listar e buscar músicas |
| POST | `/api/tracks` | enviar música (cabeçalho `X-File-Name`) |
| GET / PATCH / DELETE | `/api/tracks/:id` | ver, editar, apagar |
| GET | `/api/tracks/:id/audio` | tocar o áudio (aceita `Range`) |
| GET | `/api/tracks/:id/cover` | capa |
| POST | `/api/tracks/:id/play` | registrar que tocou `{ "seconds": 180 }` |
| GET | `/api/artists`, `/api/artists/:id/tracks` | artistas |
| GET | `/api/albums`, `/api/albums/:id` | álbuns |
| GET | `/api/favorites` | favoritos |
| GET / POST | `/api/playlists` | listar / criar `{ "name": "Pra treinar" }` |
| GET / PATCH / DELETE | `/api/playlists/:id` | ver, renomear/reordenar `{ "name", "trackIds" }`, excluir |
| POST | `/api/playlists/:id/tracks` | adicionar `{ "trackId": "..." }` |
| DELETE | `/api/playlists/:id/tracks/:trackId` | tirar da playlist |
| GET | `/api/playlists/smart/mais-tocadas\|adicionadas-agora\|nunca-tocadas` | playlists automáticas |
| GET | `/api/stats` | tempo ouvido por dia na semana e totais |
| GET / PUT | `/api/settings` | ajustes do app |

## Próximos passos

- Front-end com o novo design (Início, Álbum, Fila, Equalizador, Ajustes)
- Sincronizar o celular com o servidor: baixar músicas para ouvir offline e mandar o histórico quando tiver internet
