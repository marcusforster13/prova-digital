// app/api/certify/route.ts
//
// Este endpoint roda no servidor (Vercel Function). Ele recebe o HASH
// (SHA-256) do arquivo capturado + metadados do cliente, e devolve um
// "certificado" assinado contendo:
//  - hash do arquivo
//  - data/hora do SERVIDOR (não pode ser falsificada pelo usuário)
//  - IP de origem da requisição
//  - assinatura HMAC-SHA256 (prova que o certificado não foi alterado)
//  - um carimbo de tempo OpenTimestamps (.ots), ancorado na blockchain
//    do Bitcoin, verificável por qualquer pessoa para sempre.
//
// IMPORTANTE: o .ots retornado é um carimbo "pendente". A confirmação
// completa na blockchain leva de algumas horas a ~1 dia. O arquivo .ots
// gerado aqui já é válido como prova de que o hash existia naquele
// momento, mas pode (e deve) ser "atualizado" depois com a ferramenta
// `ots upgrade` (ver README) para anexar a prova final do bloco do Bitcoin.

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { hashHex, fileName, fileSize, fileType, clientMetadata, geolocation, exif } = body;

    if (!hashHex || typeof hashHex !== 'string' || hashHex.length !== 64) {
      return NextResponse.json(
        { error: 'hashHex inválido (esperado SHA-256 em hex, 64 caracteres).' },
        { status: 400 }
      );
    }

    // --- 1. Dados que só o servidor pode fornecer com confiança ---
    const forwardedFor = req.headers.get('x-forwarded-for');
    const ip = forwardedFor ? forwardedFor.split(',')[0].trim() : 'desconhecido';
    const serverTimestamp = new Date().toISOString();

    // --- 2. Monta o certificado ---
    const certificate = {
      version: 1,
      hashAlgorithm: 'SHA-256',
      hash: hashHex,
      file: { name: fileName, size: fileSize, type: fileType },
      server: { receivedAt: serverTimestamp, ip },
      client: clientMetadata ?? null,
      geolocation: geolocation ?? null,
      exif: exif ?? null,
    };

    // --- 3. Assina o certificado com HMAC-SHA256 ---
    // Defina a variável de ambiente SIGNING_SECRET no Vercel
    // (Settings -> Environment Variables) com um valor longo e aleatório.
    const secret = process.env.SIGNING_SECRET || 'CHANGE_ME_DEV_ONLY';
    const certificateString = JSON.stringify(certificate);
    const signature = crypto
      .createHmac('sha256', secret)
      .update(certificateString)
      .digest('hex');

    // --- 4. Carimbo de tempo OpenTimestamps (best-effort) ---
    let otsBase64: string | null = null;
    let otsError: string | null = null;
    try {
      const OpenTimestamps = await import('javascript-opentimestamps');
      const hashBytes = Buffer.from(hashHex, 'hex');

      const detached = OpenTimestamps.DetachedTimestampFile.fromHash(
        new OpenTimestamps.Ops.OpSHA256(),
        hashBytes
      );

      await OpenTimestamps.stamp(detached);

      const otsBytes: Buffer = Buffer.from(detached.serializeToBytes());
      otsBase64 = otsBytes.toString('base64');
    } catch (err: any) {
      // Se os calendários do OpenTimestamps estiverem fora do ar ou a
      // chamada falhar, não queremos quebrar a certificação inteira —
      // o hash + assinatura HMAC + timestamp do servidor já têm valor.
      otsError = String(err?.message || err);
    }

    return NextResponse.json({
      certificate,
      signature,
      ots: otsBase64, // base64 do arquivo .ots (ou null se falhou)
      otsError,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Erro ao processar certificação.', details: String(err?.message || err) },
      { status: 500 }
    );
  }
}
