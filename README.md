# Prova Digital — Captura Certificada de Print/Foto

Aplicação Next.js que permite capturar um print de tela ou uma foto pela
câmera, calcular o hash SHA-256, coletar metadados (dispositivo, IP,
geolocalização, EXIF) e gerar um pacote de evidência com:

- **Hash SHA-256** do arquivo original
- **Data/hora do servidor** (não pode ser alterada pelo usuário)
- **IP de origem**
- **Assinatura HMAC-SHA256** do certificado (garante que ele não foi
  adulterado depois de emitido)
- **Carimbo de tempo OpenTimestamps** (ancorado na blockchain do
  Bitcoin, verificável publicamente para sempre)

O resultado é um `.zip` contendo: o arquivo original, `certificado.json`,
`relatorio.txt` e (quando disponível) um arquivo `.ots`.

> ⚠️ **Aviso importante sobre validade jurídica**
> Esse projeto gera **evidência técnica forte** (hash + timestamp +
> metadados + cadeia de custódia documentada), o que aumenta muito a
> credibilidade do material. Mas nenhum site, sozinho, "certifica"
> automaticamente algo como prova legal. Para uso em processos/denúncias
> formais, o ideal é apresentar esse pacote junto com:
> - uma **ata notarial** (cartório) registrando a captura, e/ou
> - um **laudo pericial**, se o caso exigir.
> O pacote gerado aqui serve como base técnica robusta para isso.

---

## 1. Pré-requisitos

- Conta no [GitHub](https://github.com)
- Conta no [Vercel](https://vercel.com) (pode logar com o GitHub)
- Node.js 18+ instalado na sua máquina (para testar localmente — opcional)

---

## 2. Estrutura do projeto

```
prova-digital/
├── app/
│   ├── api/certify/route.ts   # Backend: IP, timestamp, assinatura, OpenTimestamps
│   ├── layout.tsx
│   ├── page.tsx               # Frontend: captura, hash, download do pacote
│   └── globals.css
├── lib/
│   └── utils.ts                # Funções de hash, geolocalização, etc.
├── package.json
├── tailwind.config.ts
├── next.config.mjs
├── tsconfig.json
└── .env.example
```

---

## 3. Rodando localmente (opcional, recomendado antes do deploy)

```bash
npm install
cp .env.example .env.local
# edite .env.local e troque SIGNING_SECRET por um valor gerado com:
# openssl rand -hex 32

npm run dev
```

Abra `http://localhost:3000`.

> Obs: `getDisplayMedia` (captura de tela) e `getUserMedia` (câmera)
> exigem **HTTPS** ou `localhost`. Em `localhost` funciona normalmente.

---

## 4. Subindo para o GitHub

```bash
git init
git add .
git commit -m "primeiro commit: prova digital"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/prova-digital.git
git push -u origin main
```

(Crie o repositório vazio antes em github.com/new — sem README, sem
.gitignore, para não dar conflito.)

---

## 5. Deploy no Vercel

1. Acesse [vercel.com/new](https://vercel.com/new) e importe o
   repositório `prova-digital` do GitHub.
2. O Vercel detecta automaticamente que é um projeto Next.js — não
   precisa mudar nada no "Build Command" nem "Output Directory".
3. Antes de clicar em **Deploy**, abra a seção **Environment Variables**
   e adicione:
   - `SIGNING_SECRET` = (uma string longa e aleatória — gere com
     `openssl rand -hex 32` ou qualquer gerador de senha forte)
4. Clique em **Deploy**. Em ~1-2 minutos seu site estará no ar em uma
   URL tipo `https://prova-digital-seunome.vercel.app`.

Pronto — o site já está funcionando com HTTPS (necessário para a câmera
e captura de tela funcionarem em produção).

---

## 6. Como usar

1. O usuário escolhe: **Print da tela**, **Foto pela câmera** ou
   **Enviar arquivo**.
2. Captura/seleciona a imagem e confere o preview.
3. Clica em **"Gerar hash e certificar"**:
   - O navegador calcula o SHA-256 da imagem.
   - Envia o hash + metadados para `/api/certify`.
   - O servidor registra IP, data/hora, assina tudo com HMAC e tenta
     gerar o carimbo OpenTimestamps.
4. Clica em **"Baixar pacote de evidência (.zip)"** — recebe um arquivo
   com tudo dentro.

---

## 7. Verificando o pacote depois (auditoria)

- **Hash**: recalcule o SHA-256 do arquivo de imagem e compare com o
  campo `hash` em `certificado.json`.
- **Carimbo de tempo**: se houver um arquivo `.ots`, suba-o em
  https://opentimestamps.org/ junto com o arquivo original — o site
  mostra a data confirmada na blockchain do Bitcoin.
  - **Importante**: logo após a geração, o `.ots` costuma estar
    "pendente". A confirmação completa pode levar algumas horas. Para
    atualizar o arquivo `.ots` com a prova final, instale o cliente
    oficial (`pip install opentimestamps-client`) e rode:
    ```bash
    ots upgrade evidencia.png.ots
    ```
- **Assinatura HMAC**: prova que o `certificado.json` não foi editado
  depois de gerado pelo servidor. A verificação exige conhecer o
  `SIGNING_SECRET` (só o operador do site tem acesso).

---

## 8. Próximos passos sugeridos (opcional)

- **Banco de dados**: hoje o site não guarda nada — cada usuário baixa
  seu próprio pacote. Se quiser manter um histórico (ex.: para uma
  empresa registrar denúncias), adicione um banco (Postgres via
  [Vercel Postgres](https://vercel.com/storage/postgres) ou
  [Supabase](https://supabase.com)) e salve `certificado.json` +
  arquivo no `/api/certify`.
- **Geração de PDF**: transformar o `relatorio.txt` em PDF formatado
  (ex. com `pdf-lib` ou `@react-pdf/renderer`) para anexar diretamente
  em denúncias.
- **RFC 3161 (TSA)**: além do OpenTimestamps, é possível adicionar um
  carimbo via [FreeTSA](https://freetsa.org/) para ter um segundo
  selo de tempo independente.
- **Login/autenticação**: se o uso for institucional (ex. equipe de
  segurança), adicionar login (NextAuth) para rastrear quem gerou cada
  evidência.
