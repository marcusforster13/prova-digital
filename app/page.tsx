'use client';

import { useRef, useState } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import {
  sha256Hex,
  getClientMetadata,
  getGeolocation,
  formatBytes,
} from '@/lib/utils';

type CertResult = {
  certificate: any;
  signature: string;
  ots: string | null;
  otsError: string | null;
};

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [mode, setMode] = useState<'idle' | 'screen' | 'camera'>('idle');
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('evidencia.png');
  const [exifData, setExifData] = useState<any>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [result, setResult] = useState<CertResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function stopStream() {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
  }

  function resetCapture() {
    stopStream();
    setMode('idle');
    setBlob(null);
    setPreviewUrl(null);
    setExifData(null);
    setHash(null);
    setResult(null);
    setError(null);
  }

  // ---------- CAPTURA DE TELA (PRINT) ----------
  async function startScreenCapture() {
    setError(null);
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor' } as any,
      });
      setStream(s);
      setMode('screen');
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        await videoRef.current.play();
      }
    } catch (err: any) {
      setError('Não foi possível iniciar a captura de tela: ' + err.message);
    }
  }

  // ---------- CAPTURA DE FOTO (CÂMERA) ----------
  async function startCamera() {
    setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      setStream(s);
      setMode('camera');
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        await videoRef.current.play();
      }
    } catch (err: any) {
      setError('Não foi possível acessar a câmera: ' + err.message);
    }
  }

  // ---------- TIRA O FRAME ATUAL (PRINT OU FOTO) ----------
  async function captureFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(async (b) => {
      if (!b) return;
      setBlob(b);
      setPreviewUrl(URL.createObjectURL(b));
      setFileName(mode === 'screen' ? 'print-evidencia.png' : 'foto-evidencia.png');
      stopStream();

      // Para fotos da câmera, tenta extrair EXIF (geralmente vazio em
      // capturas via canvas, mas mantemos o fluxo pronto para uploads
      // de arquivos de câmera reais).
      try {
        const exifr = await import('exifr');
        const data = await exifr.parse(b);
        setExifData(data || null);
      } catch {
        setExifData(null);
      }
    }, 'image/png');
  }

  // ---------- UPLOAD DE ARQUIVO JÁ EXISTENTE ----------
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    resetCapture();
    setBlob(file);
    setFileName(file.name);
    setPreviewUrl(URL.createObjectURL(file));

    try {
      const exifr = await import('exifr');
      const data = await exifr.parse(file);
      setExifData(data || null);
    } catch {
      setExifData(null);
    }
  }

  // ---------- CERTIFICAÇÃO (HASH + ENVIO AO SERVIDOR) ----------
  async function handleCertify() {
    if (!blob) return;
    setLoading(true);
    setError(null);
    try {
      const hashHex = await sha256Hex(blob);
      setHash(hashHex);

      const clientMetadata = getClientMetadata();
      const geolocation = await getGeolocation();

      const res = await fetch('/api/certify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hashHex,
          fileName,
          fileSize: blob.size,
          fileType: blob.type,
          clientMetadata,
          geolocation,
          exif: exifData,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Erro ${res.status}`);
      }

      const data: CertResult = await res.json();
      setResult(data);
    } catch (err: any) {
      setError('Erro ao certificar: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  // ---------- MONTA E BAIXA O PACOTE DE EVIDÊNCIA (.zip) ----------
  async function handleDownloadPackage() {
    if (!blob || !result) return;
    const zip = new JSZip();
    zip.file(fileName, blob);
    zip.file(
      'certificado.json',
      JSON.stringify(
        { certificate: result.certificate, signature: result.signature },
        null,
        2
      )
    );
    if (result.ots) {
      const otsBytes = Uint8Array.from(atob(result.ots), (c) => c.charCodeAt(0));
      zip.file(`${fileName}.ots`, otsBytes);
    }

    const report = buildReadableReport(result, fileName, hash);
    zip.file('relatorio.txt', report);

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, `evidencia-${Date.now()}.zip`);
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold text-ink">Captura de Evidência Digital</h1>
      <p className="mt-2 text-sm text-slate-600">
        Tire um print da tela ou uma foto pela câmera, gere o hash, colete os
        metadados e crie um pacote certificado com carimbo de tempo
        verificável (OpenTimestamps).
      </p>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700 border border-red-200">
          {error}
        </div>
      )}

      {/* Passo 1: escolher origem */}
      {!blob && (
        <section className="mt-6 grid gap-3 sm:grid-cols-3">
          <button
            onClick={startScreenCapture}
            className="rounded-lg border border-slate-300 bg-white p-4 text-left hover:border-accent transition"
          >
            <div className="font-semibold">📷 Print da tela</div>
            <div className="text-xs text-slate-500 mt-1">
              Compartilhe a tela/aba e capture o conteúdo atual.
            </div>
          </button>
          <button
            onClick={startCamera}
            className="rounded-lg border border-slate-300 bg-white p-4 text-left hover:border-accent transition"
          >
            <div className="font-semibold">📸 Foto pela câmera</div>
            <div className="text-xs text-slate-500 mt-1">
              Use a câmera do dispositivo em tempo real.
            </div>
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg border border-slate-300 bg-white p-4 text-left hover:border-accent transition"
          >
            <div className="font-semibold">📁 Enviar arquivo</div>
            <div className="text-xs text-slate-500 mt-1">
              Já tenho um print/foto e quero certificá-lo.
            </div>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileUpload}
          />
        </section>
      )}

      {/* Passo 2: pré-visualização ao vivo (print/câmera) */}
      {(mode === 'screen' || mode === 'camera') && !blob && (
        <section className="mt-6">
          <video
            ref={videoRef}
            className="w-full rounded-lg border border-slate-300 bg-black"
            muted
            playsInline
          />
          <div className="mt-3 flex gap-2">
            <button
              onClick={captureFrame}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Capturar agora
            </button>
            <button
              onClick={resetCapture}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
            >
              Cancelar
            </button>
          </div>
        </section>
      )}

      <canvas ref={canvasRef} className="hidden" />

      {/* Passo 3: preview do que foi capturado + certificação */}
      {blob && (
        <section className="mt-6 space-y-4">
          <div>
            <img
              src={previewUrl ?? ''}
              alt="Pré-visualização da evidência"
              className="w-full rounded-lg border border-slate-300"
            />
            <div className="mt-1 text-xs text-slate-500">
              {fileName} • {formatBytes(blob.size)}
            </div>
          </div>

          {!result && (
            <div className="flex gap-2">
              <button
                onClick={handleCertify}
                disabled={loading}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Certificando...' : 'Gerar hash e certificar'}
              </button>
              <button
                onClick={resetCapture}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
              >
                Recomeçar
              </button>
            </div>
          )}

          {hash && (
            <div className="rounded-md bg-slate-100 p-3 text-xs font-mono break-all">
              <div className="font-semibold mb-1 font-sans">Hash SHA-256:</div>
              {hash}
            </div>
          )}

          {result && (
            <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm space-y-2">
              <div className="font-semibold text-green-800">
                ✅ Certificado gerado
              </div>
              <div>Recebido pelo servidor em: {result.certificate.server.receivedAt}</div>
              <div>IP de origem: {result.certificate.server.ip}</div>
              <div>
                Carimbo OpenTimestamps:{' '}
                {result.ots ? 'gerado (pendente de confirmação na blockchain)' : 'não disponível agora'}
              </div>
              {result.otsError && (
                <div className="text-xs text-amber-700">
                  Aviso OpenTimestamps: {result.otsError}
                </div>
              )}
              <button
                onClick={handleDownloadPackage}
                className="mt-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Baixar pacote de evidência (.zip)
              </button>
              <div className="pt-2">
                <button
                  onClick={resetCapture}
                  className="text-xs text-slate-500 underline"
                >
                  Capturar nova evidência
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function buildReadableReport(result: CertResult, fileName: string, hash: string | null) {
  const c = result.certificate;
  return `RELATÓRIO DE EVIDÊNCIA DIGITAL
================================

Arquivo: ${fileName}
Hash SHA-256: ${hash}

Recebido pelo servidor em: ${c.server.receivedAt}
IP de origem: ${c.server.ip}

Assinatura HMAC-SHA256 do certificado: ${result.signature}

Carimbo de tempo OpenTimestamps anexado: ${result.ots ? 'Sim (arquivo .ots incluído neste pacote)' : 'Não'}

Metadados do dispositivo/cliente:
${JSON.stringify(c.client, null, 2)}

Geolocalização:
${JSON.stringify(c.geolocation, null, 2)}

EXIF (se disponível):
${JSON.stringify(c.exif, null, 2)}

---
Como verificar este pacote:
1. Recalcule o SHA-256 do arquivo "${fileName}" e confira se bate com o hash acima.
2. Use o arquivo .ots (se presente) em https://opentimestamps.org/ para
   verificar o carimbo de tempo na blockchain do Bitcoin.
3. A assinatura HMAC comprova que o "certificado.json" não foi alterado
   após emitido pelo servidor (verificação requer a chave SIGNING_SECRET,
   guardada apenas pelo operador do site).
`;
}
