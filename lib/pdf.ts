// lib/pdf.ts
// Gera o relatório de evidência em PDF, no navegador, usando jsPDF.

import { jsPDF } from 'jspdf';

type CertResult = {
  certificate: any;
  signature: string;
  ots: string | null;
  otsError: string | null;
};

export function buildReportPdf(
  result: CertResult,
  fileName: string,
  hash: string | null
): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const marginX = 16;
  const pageWidth = doc.internal.pageSize.getWidth();
  const maxWidth = pageWidth - marginX * 2;
  let y = 18;

  const addTitle = (text: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(text, marginX, y);
    y += 8;
  };

  const addSectionTitle = (text: string) => {
    if (y > 270) {
      doc.addPage();
      y = 18;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(text, marginX, y);
    y += 6;
  };

  const addLine = (label: string, value: string) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const text = `${label}: ${value}`;
    const lines = doc.splitTextToSize(text, maxWidth);
    for (const line of lines) {
      if (y > 285) {
        doc.addPage();
        y = 18;
      }
      doc.text(line, marginX, y);
      y += 5;
    }
  };

  const addParagraph = (text: string) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const lines = doc.splitTextToSize(text, maxWidth);
    for (const line of lines) {
      if (y > 285) {
        doc.addPage();
        y = 18;
      }
      doc.text(line, marginX, y);
      y += 5;
    }
  };

  const c = result.certificate;

  addTitle('Relatorio de Evidencia Digital');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, marginX, y);
  y += 10;

  addSectionTitle('Arquivo');
  addLine('Nome', fileName);
  addLine('Tamanho', `${c.file?.size ?? '-'} bytes`);
  addLine('Tipo', c.file?.type ?? '-');
  addLine('Hash (SHA-256)', hash ?? c.hash);
  y += 3;

  addSectionTitle('Certificacao do servidor');
  addLine('Recebido em (UTC)', c.server?.receivedAt ?? '-');
  addLine('IP de origem', c.server?.ip ?? '-');
  addLine('Assinatura HMAC-SHA256', result.signature);
  y += 3;

  addSectionTitle('Carimbo de tempo (OpenTimestamps / Bitcoin)');
  if (result.ots) {
    addParagraph(
      'Um carimbo OpenTimestamps foi gerado e esta incluido neste pacote ' +
        '(arquivo .ots). Ele ancora o hash do arquivo na blockchain do ' +
        'Bitcoin. A confirmacao final pode levar algumas horas; use a ' +
        'opcao "Atualizar carimbo" no site para obter a prova completa ' +
        'depois da confirmacao, ou verifique em opentimestamps.org.'
    );
  } else {
    addParagraph(
      'Nao foi possivel gerar o carimbo OpenTimestamps no momento da ' +
        'certificacao' + (result.otsError ? `: ${result.otsError}` : '.')
    );
  }
  y += 3;

  addSectionTitle('Geolocalizacao informada pelo dispositivo');
  if (c.geolocation) {
    addLine('Latitude', String(c.geolocation.latitude));
    addLine('Longitude', String(c.geolocation.longitude));
    addLine('Precisao (m)', String(c.geolocation.accuracy));
  } else {
    addParagraph('Nao informada / nao autorizada pelo usuario.');
  }
  y += 3;

  addSectionTitle('Metadados do dispositivo/navegador');
  if (c.client) {
    addLine('User-Agent', c.client.userAgent ?? '-');
    addLine('Idioma', c.client.language ?? '-');
    addLine('Plataforma', c.client.platform ?? '-');
    addLine(
      'Tela',
      c.client.screen
        ? `${c.client.screen.width}x${c.client.screen.height} (pixelRatio ${c.client.screen.pixelRatio})`
        : '-'
    );
    addLine('Fuso horario', c.client.timezone ?? '-');
    addLine('Capturado em (cliente)', c.client.capturedAtClient ?? '-');
  } else {
    addParagraph('Nao disponivel.');
  }
  y += 3;

  addSectionTitle('Metadados EXIF (se disponivel)');
  if (c.exif) {
    const exifText = JSON.stringify(c.exif, null, 2);
    addParagraph(exifText);
  } else {
    addParagraph('Nenhum dado EXIF encontrado neste arquivo.');
  }
  y += 5;

  addSectionTitle('Como verificar este pacote');
  addParagraph(
    '1. Recalcule o hash SHA-256 do arquivo de imagem e compare com o ' +
      'valor informado acima.'
  );
  addParagraph(
    '2. Se houver um arquivo .ots, verifique-o em opentimestamps.org ' +
      'junto com o arquivo de imagem original.'
  );
  addParagraph(
    '3. A assinatura HMAC comprova que este certificado nao foi alterado ' +
      'apos sua emissao pelo servidor (verificacao requer a chave secreta ' +
      'mantida pelo operador do site).'
  );

  return doc.output('blob');
}
