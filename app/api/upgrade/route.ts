// app/api/upgrade/route.ts
//
// Endpoint para "completar" um carimbo OpenTimestamps depois que a
// confirmação na blockchain do Bitcoin já tiver acontecido (geralmente
// algumas horas após a certificação inicial).
//
// O usuário sobe o arquivo .ots que recebeu no pacote de evidência.
// Se a blockchain já confirmou, devolvemos um .ots atualizado contendo
// a prova completa (verificável para sempre, sem depender de servidores).
// Se ainda não confirmou, avisamos que precisa tentar novamente mais tarde.

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { otsBase64 } = body;

    if (!otsBase64 || typeof otsBase64 !== 'string') {
      return NextResponse.json(
        { error: 'Envie o arquivo .ots em base64 no campo "otsBase64".' },
        { status: 400 }
      );
    }

    const OpenTimestamps = await import('javascript-opentimestamps');
    const otsBytes = Buffer.from(otsBase64, 'base64');

    const detached = OpenTimestamps.DetachedTimestampFile.deserialize(otsBytes);
    const wasComplete = detached.timestamp.isTimestampComplete();

    let upgraded = false;
    try {
      upgraded = await OpenTimestamps.upgrade(detached);
    } catch (err) {
      // Calendário pode estar indisponível; não é um erro fatal.
    }

    const isComplete = detached.timestamp.isTimestampComplete();
    const newBytes = Buffer.from(detached.serializeToBytes());

    return NextResponse.json({
      ots: newBytes.toString('base64'),
      wasComplete,
      complete: isComplete,
      changed: upgraded,
      message: isComplete
        ? 'Carimbo confirmado na blockchain do Bitcoin! Baixe o .ots atualizado — ele já é uma prova completa e independente.'
        : 'Ainda não confirmado na blockchain. A confirmação pode levar algumas horas a partir da geração do certificado. Tente novamente mais tarde.',
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Erro ao processar o arquivo .ots.', details: String(err?.message || err) },
      { status: 500 }
    );
  }
}
