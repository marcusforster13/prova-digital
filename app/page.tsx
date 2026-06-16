'use client';

import { useRef, useState } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import {
  sha256Hex,
  getClientMetadata,
  getGeolocation,
  formatBytes,
  blobToBase64,
  base64ToBlob,
} from '@/lib/utils';

type CertResult = {
  certificate: any;
  signature: string;
  ots: string | null;
  otsError: string | null;
};

type Tab = 'capturar' | 'oque' | 'comousar' | 'juridico' | 'verificar' | 'faq';

export default function Home() {
  const [tab, setTab] = useState<Tab>('capturar');

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

  const otsInputRef = useRef<HTMLInputElement>(null);
  const [otsFileName, setOtsFileName] = useState<string | null>(null);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  const [upgradeResult, setUpgradeResult] = useState<{ ots: string; complete: boolean; changed: boolean; message: string } | null>(null);

  const verifyInputRef = useRef<HTMLInputElement>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  function stopStream() { stream?.getTracks().forEach(t => t.stop()); setStream(null); }
  function resetCapture() { stopStream(); setMode('idle'); setBlob(null); setPreviewUrl(null); setExifData(null); setHash(null); setResult(null); setError(null); }

  async function startScreenCapture() {
    setError(null);
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'monitor' } as any });
      setStream(s); setMode('screen');
      if (videoRef.current) { videoRef.current.srcObject = s; await videoRef.current.play(); }
    } catch (err: any) { setError('Não foi possível iniciar a captura de tela: ' + err.message); }
  }

  async function startCamera() {
    setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setStream(s); setMode('camera');
      if (videoRef.current) { videoRef.current.srcObject = s; await videoRef.current.play(); }
    } catch (err: any) { setError('Não foi possível acessar a câmera: ' + err.message); }
  }

  async function captureFrame() {
    const video = videoRef.current; const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(async b => {
      if (!b) return;
      setBlob(b); setPreviewUrl(URL.createObjectURL(b));
      setFileName(mode === 'screen' ? 'print-evidencia.png' : 'foto-evidencia.png');
      stopStream();
      try { const exifr = await import('exifr'); setExifData(await exifr.parse(b) || null); } catch { setExifData(null); }
    }, 'image/png');
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    resetCapture(); setBlob(file); setFileName(file.name); setPreviewUrl(URL.createObjectURL(file));
    try { const exifr = await import('exifr'); setExifData(await exifr.parse(file) || null); } catch { setExifData(null); }
  }

  async function handleCertify() {
    if (!blob) return; setLoading(true); setError(null);
    try {
      const hashHex = await sha256Hex(blob); setHash(hashHex);
      const clientMetadata = getClientMetadata();
      const geolocation = await getGeolocation();
      const res = await fetch('/api/certify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hashHex, fileName, fileSize: blob.size, fileType: blob.type, clientMetadata, geolocation, exif: exifData }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `Erro ${res.status}`); }
      setResult(await res.json());
    } catch (err: any) { setError('Erro ao certificar: ' + err.message); } finally { setLoading(false); }
  }

  async function handleDownloadPackage() {
    if (!blob || !result) return;
    const zip = new JSZip();
    zip.file(fileName, blob);
    zip.file('certificado.json', JSON.stringify({ certificate: result.certificate, signature: result.signature }, null, 2));
    if (result.ots) { const b = Uint8Array.from(atob(result.ots), c => c.charCodeAt(0)); zip.file(`${fileName}.ots`, b); }
    let reportBlob: Blob;
    try {
      const { buildReportPdf } = await import('@/lib/pdf');
      reportBlob = buildReportPdf(result, fileName, hash);
    } catch {
      reportBlob = new Blob([`RELATÓRIO\nArquivo: ${fileName}\nHash: ${hash}\nServidor: ${result.certificate.server.receivedAt}\nIP: ${result.certificate.server.ip}`], { type: 'text/plain' });
      zip.file('relatorio.txt', reportBlob);
      saveAs(await zip.generateAsync({ type: 'blob' }), `evidencia-${Date.now()}.zip`);
      return;
    }
    zip.file('relatorio.pdf', reportBlob);
    saveAs(await zip.generateAsync({ type: 'blob' }), `evidencia-${Date.now()}.zip`);
  }

  async function handleOtsFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setUpgradeError(null); setUpgradeResult(null); setOtsFileName(file.name); setUpgradeLoading(true);
    try {
      const base64 = await blobToBase64(file);
      const res = await fetch('/api/upgrade', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ otsBase64: base64 }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `Erro ${res.status}`); }
      setUpgradeResult(await res.json());
    } catch (err: any) { setUpgradeError('Erro: ' + err.message); } finally { setUpgradeLoading(false); e.target.value = ''; }
  }

  function handleDownloadUpgradedOts() {
    if (!upgradeResult || !otsFileName) return;
    saveAs(base64ToBlob(upgradeResult.ots), otsFileName);
  }

  async function handleVerifyFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setVerifyError(null); setVerifyResult(null); setVerifyLoading(true);
    try {
      if (file.name.endsWith('.ots')) {
        const base64 = await blobToBase64(file);
        const res = await fetch('/api/upgrade', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ otsBase64: base64 }) });
        const data = await res.json();
        setVerifyResult({ type: 'ots', complete: data.complete, message: data.message });
      } else if (file.name.endsWith('.zip')) {
        const JSZipLib = await import('jszip');
        const zip = await JSZipLib.default.loadAsync(file);
        const certFile = zip.file('certificado.json');
        if (!certFile) throw new Error('certificado.json não encontrado no .zip');
        const certText = await certFile.async('string');
        const cert = JSON.parse(certText);
        const imgName = cert.certificate?.file?.name;
        const imgFile = imgName ? zip.file(imgName) : null;
        let hashMatch = null;
        if (imgFile) {
          const imgBytes = await imgFile.async('arraybuffer');
          const digest = await crypto.subtle.digest('SHA-256', imgBytes);
          const hex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
          hashMatch = hex === cert.certificate?.hash;
        }
        setVerifyResult({ type: 'zip', cert: cert.certificate, signature: cert.signature, hashMatch });
      } else {
        throw new Error('Envie um arquivo .zip ou .ots');
      }
    } catch (err: any) { setVerifyError('Erro: ' + err.message); } finally { setVerifyLoading(false); e.target.value = ''; }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'capturar', label: 'Capturar' },
    { id: 'oque', label: 'O que é' },
    { id: 'comousar', label: 'Como usar' },
    { id: 'juridico', label: 'Validade jurídica' },
    { id: 'verificar', label: 'Verificar' },
    { id: 'faq', label: 'FAQ' },
  ];

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      {/* HEADER */}
      <div className="flex items-center gap-3 mb-6 pb-5 border-b border-slate-200">
        <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 text-lg">🛡</div>
        <div>
          <div className="font-semibold text-sm tracking-wide text-slate-900">Prova Digital</div>
          <div className="text-xs text-slate-400 tracking-widest uppercase">Evidência Certificada</div>
        </div>
        <span className="ml-auto text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>Sistema operacional
        </span>
      </div>

      {/* TABS */}
      <div className="flex border-b border-slate-200 mb-6 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${tab === t.id ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* === ABA: CAPTURAR === */}
      {tab === 'capturar' && (
        <div>
          {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

          {!blob && mode === 'idle' && (
            <div className="grid grid-cols-3 gap-3 mb-5">
              {[
                { icon: '🖥', title: 'Print da tela', desc: 'Compartilhe a aba ou monitor atual', action: startScreenCapture },
                { icon: '📷', title: 'Foto ao vivo', desc: 'Câmera do dispositivo em tempo real', action: startCamera },
                { icon: '📁', title: 'Enviar arquivo', desc: 'Imagem já existente no dispositivo', action: () => fileInputRef.current?.click() },
              ].map(c => (
                <button key={c.title} onClick={c.action}
                  className="bg-white border border-slate-200 rounded-xl p-4 text-left hover:border-slate-400 transition-colors">
                  <div className="text-2xl mb-2">{c.icon}</div>
                  <div className="text-sm font-medium text-slate-900 mb-1">{c.title}</div>
                  <div className="text-xs text-slate-400 leading-relaxed">{c.desc}</div>
                </button>
              ))}
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
            </div>
          )}

          {(mode === 'screen' || mode === 'camera') && !blob && (
            <div className="mb-5">
              <video ref={videoRef} className="w-full rounded-xl border border-slate-200 bg-black" muted playsInline />
              <div className="mt-3 flex gap-2">
                <button onClick={captureFrame} className="bg-slate-900 text-white rounded-lg px-4 py-2 text-sm font-medium">Capturar agora</button>
                <button onClick={resetCapture} className="border border-slate-200 rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancelar</button>
              </div>
            </div>
          )}

          <canvas ref={canvasRef} className="hidden" />

          {blob && (
            <div className="space-y-4">
              <div>
                <img src={previewUrl ?? ''} alt="Pré-visualização" className="w-full rounded-xl border border-slate-200" />
                <div className="mt-1 text-xs text-slate-400">{fileName} • {formatBytes(blob.size)}</div>
              </div>

              {!result && (
                <div className="flex gap-2">
                  <button onClick={handleCertify} disabled={loading}
                    className="bg-slate-900 text-white rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50 flex items-center gap-2">
                    {loading ? <>⏳ Certificando...</> : <>🛡 Gerar hash e certificar</>}
                  </button>
                  <button onClick={resetCapture} className="border border-slate-200 rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Recomeçar</button>
                </div>
              )}

              {hash && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <div className="text-xs text-slate-400 mb-1 font-medium uppercase tracking-wide">Hash SHA-256</div>
                  <div className="text-xs font-mono text-slate-700 break-all">{hash}</div>
                </div>
              )}

              {result && (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">Certificado de autenticidade</span>
                    <span className="ml-auto text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">✓ Assinado</span>
                  </div>
                  {[
                    { icon: '🕐', label: 'Registrado pelo servidor em', value: result.certificate.server.receivedAt, mono: true },
                    { icon: '📍', label: 'IP de origem', value: result.certificate.server.ip, mono: true },
                    { icon: '₿', label: 'Carimbo OpenTimestamps', value: result.ots ? 'Gerado — pendente de confirmação na blockchain' : 'Não disponível', mono: false, warn: !result.ots },
                  ].map(row => (
                    <div key={row.label} className="flex items-start gap-3 px-4 py-3 border-b border-slate-100 last:border-0">
                      <span className="text-base mt-0.5">{row.icon}</span>
                      <div>
                        <div className="text-xs text-slate-400 mb-0.5">{row.label}</div>
                        <div className={`text-xs ${row.mono ? 'font-mono text-slate-700' : row.warn ? 'text-amber-600' : 'text-emerald-600'}`}>{row.value}</div>
                      </div>
                    </div>
                  ))}
                  <div className="px-4 py-3">
                    <button onClick={handleDownloadPackage}
                      className="w-full bg-slate-900 text-white rounded-lg px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2">
                      ⬇ Baixar pacote de evidência (.zip)
                    </button>
                  </div>
                </div>
              )}

              {result && (
                <button onClick={resetCapture} className="text-xs text-slate-400 underline">Nova captura</button>
              )}
            </div>
          )}

          {/* Upgrade OTS */}
          <div className="mt-8 pt-6 border-t border-slate-100">
            <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl p-4">
              <span className="text-xl">₿</span>
              <div className="flex-1">
                <div className="text-sm font-medium text-slate-900 mb-0.5">Atualizar carimbo de tempo</div>
                <div className="text-xs text-slate-400">Envie o .ots recebido no pacote para confirmar na blockchain</div>
              </div>
              <button onClick={() => otsInputRef.current?.click()} disabled={upgradeLoading}
                className="text-xs font-medium border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap">
                {upgradeLoading ? 'Verificando...' : 'Selecionar .ots'}
              </button>
              <input ref={otsInputRef} type="file" accept=".ots" className="hidden" onChange={handleOtsFileChange} />
            </div>
            {upgradeError && <div className="mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{upgradeError}</div>}
            {upgradeResult && (
              <div className={`mt-2 rounded-lg border p-3 text-sm ${upgradeResult.complete ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                <div className="font-medium mb-1">{upgradeResult.complete ? '✅ Confirmado na blockchain' : '⏳ Ainda pendente'}</div>
                <div className="text-xs">{upgradeResult.message}</div>
                <button onClick={handleDownloadUpgradedOts} className="mt-2 text-xs font-medium bg-white border border-current rounded px-3 py-1">Baixar .ots atualizado</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* === ABA: O QUE É === */}
      {tab === 'oque' && (
        <div>
          <div className="text-center py-6">
            <div className="text-5xl mb-4">🛡</div>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">O que é o Prova Digital?</h2>
            <p className="text-sm text-slate-500 leading-relaxed max-w-lg mx-auto">
              Uma plataforma que transforma capturas de tela e fotos em evidências técnicas verificáveis — com hash criptográfico, carimbo de tempo na blockchain do Bitcoin e cadeia de custódia documentada.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-6">
            {[
              { icon: '#', title: 'Hash SHA-256', desc: 'Impressão digital única do arquivo. Qualquer alteração mínima muda o hash completamente.' },
              { icon: '₿', title: 'Blockchain Bitcoin', desc: 'O hash é ancorado via OpenTimestamps. Prova permanente e verificável por qualquer pessoa.' },
              { icon: '🖥', title: 'Servidor independente', desc: 'IP, data e hora são registrados no servidor — não no navegador do usuário.' },
            ].map(p => (
              <div key={p.title} className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xl font-bold text-slate-300 mb-2">{p.icon}</div>
                <div className="text-sm font-medium text-slate-900 mb-1">{p.title}</div>
                <div className="text-xs text-slate-400 leading-relaxed">{p.desc}</div>
              </div>
            ))}
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
            <div className="text-xs font-medium text-slate-400 uppercase tracking-widest mb-3">O que está no pacote de evidência</div>
            {[
              ['Imagem original', 'O arquivo capturado, intacto'],
              ['certificado.json', 'Hash, IP, timestamp e assinatura HMAC'],
              ['relatorio.pdf', 'Relatório legível para anexar em denúncias'],
              ['arquivo.ots', 'Carimbo de tempo verificável na blockchain'],
            ].map(([name, desc]) => (
              <div key={name} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
                <span className="font-mono text-xs text-slate-500 w-32 shrink-0">{name}</span>
                <span className="text-xs text-slate-400">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* === ABA: COMO USAR === */}
      {tab === 'comousar' && (
        <div>
          <div className="text-sm text-slate-500 mb-6 leading-relaxed">Siga os passos abaixo para gerar uma evidência certificada em menos de um minuto.</div>
          <div className="space-y-0">
            {[
              { n: 1, title: 'Escolha a origem', desc: 'Selecione se quer tirar print da tela, usar a câmera ou enviar um arquivo já existente.' },
              { n: 2, title: 'Capture ou confirme a imagem', desc: 'Para print e câmera, pré-visualize e clique em "Capturar agora". Para arquivo, a imagem é carregada automaticamente.' },
              { n: 3, title: 'Clique em "Gerar hash e certificar"', desc: 'O sistema calcula o SHA-256, coleta metadados do dispositivo, registra IP e data/hora no servidor e solicita o carimbo na blockchain.' },
              { n: 4, title: 'Baixe o pacote de evidência', desc: 'Um .zip com a imagem original, certificado.json, relatorio.pdf e o arquivo .ots da blockchain.' },
              { n: 5, title: 'Atualize o carimbo depois', desc: 'Horas após a certificação, volte à aba Capturar e use a seção de atualização de carimbo para confirmar a prova na blockchain do Bitcoin.' },
            ].map((step, i, arr) => (
              <div key={step.n} className="flex gap-4 relative">
                {i < arr.length - 1 && <div className="absolute left-4 top-9 bottom-0 w-px bg-slate-100" />}
                <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-xs font-medium text-slate-600 shrink-0 z-10">{step.n}</div>
                <div className="pb-6">
                  <div className="text-sm font-medium text-slate-900 mb-1 pt-1">{step.title}</div>
                  <div className="text-xs text-slate-400 leading-relaxed">{step.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* === ABA: VALIDADE JURÍDICA === */}
      {tab === 'juridico' && (
        <div className="space-y-3">
          <div className="bg-white border-l-4 border-emerald-400 border border-slate-200 rounded-xl p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-900 mb-3">✅ O que este sistema prova</div>
            <ul className="space-y-1.5">
              {['Que o arquivo existia naquele exato momento (hash + timestamp)', 'Que não foi alterado após a certificação (hash imutável)', 'Origem aproximada via IP registrado pelo servidor', 'Metadados do dispositivo e geolocalização (se autorizada)', 'Carimbo de tempo verificável na blockchain do Bitcoin'].map(i => (
                <li key={i} className="text-xs text-slate-500 flex gap-2"><span className="text-emerald-500 shrink-0">·</span>{i}</li>
              ))}
            </ul>
          </div>
          <div className="bg-white border-l-4 border-red-400 border border-slate-200 rounded-xl p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-900 mb-3">❌ O que este sistema não prova</div>
            <ul className="space-y-1.5">
              {['Autoria ou identidade de quem capturou (não há login obrigatório)', 'Que o conteúdo da imagem é verdadeiro (só prova que o arquivo existia)', 'Validade jurídica automática — depende do contexto e do juízo'].map(i => (
                <li key={i} className="text-xs text-slate-500 flex gap-2"><span className="text-red-400 shrink-0">·</span>{i}</li>
              ))}
            </ul>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-900 mb-3">💡 Para uso em processos formais</div>
            <ul className="space-y-1.5">
              {['Combine com ata notarial para maior peso jurídico', 'Guarde o pacote .zip intacto como cadeia de custódia', 'Consulte um advogado ou perito digital para seu caso específico'].map(i => (
                <li key={i} className="text-xs text-slate-500 flex gap-2"><span className="text-slate-400 shrink-0">·</span>{i}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* === ABA: VERIFICAR === */}
      {tab === 'verificar' && (
        <div>
          <p className="text-sm text-slate-500 mb-5 leading-relaxed">Envie um pacote .zip gerado pelo Prova Digital ou um arquivo .ots para verificar sua autenticidade.</p>
          <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center mb-4 hover:border-slate-300 transition-colors cursor-pointer" onClick={() => verifyInputRef.current?.click()}>
            <div className="text-3xl mb-2">🔍</div>
            <div className="text-sm font-medium text-slate-900 mb-1">Arraste o arquivo aqui ou clique para selecionar</div>
            <div className="text-xs text-slate-400">Aceita .zip (pacote completo) ou .ots (carimbo individual)</div>
          </div>
          <button onClick={() => verifyInputRef.current?.click()} disabled={verifyLoading}
            className="w-full bg-slate-900 text-white rounded-lg py-2.5 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50">
            {verifyLoading ? '⏳ Verificando...' : '🔍 Selecionar arquivo para verificar'}
          </button>
          <input ref={verifyInputRef} type="file" accept=".zip,.ots" className="hidden" onChange={handleVerifyFile} />
          {verifyError && <div className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{verifyError}</div>}
          {verifyResult && (
            <div className="mt-4 bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 text-sm font-medium text-slate-900">Resultado da verificação</div>
              {verifyResult.type === 'ots' && (
                <div className={`p-4 text-sm ${verifyResult.complete ? 'text-emerald-700' : 'text-amber-700'}`}>
                  <div className="font-medium mb-1">{verifyResult.complete ? '✅ Carimbo confirmado na blockchain' : '⏳ Carimbo ainda pendente'}</div>
                  <div className="text-xs opacity-80">{verifyResult.message}</div>
                </div>
              )}
              {verifyResult.type === 'zip' && (
                <div className="p-4 space-y-2">
                  <div className={`text-sm font-medium ${verifyResult.hashMatch === true ? 'text-emerald-700' : verifyResult.hashMatch === false ? 'text-red-700' : 'text-slate-600'}`}>
                    {verifyResult.hashMatch === true ? '✅ Hash verificado — arquivo íntegro' : verifyResult.hashMatch === false ? '❌ Hash não confere — arquivo pode ter sido alterado' : '⚠️ Não foi possível verificar o hash'}
                  </div>
                  <div className="text-xs text-slate-400">Certificado emitido em: {verifyResult.cert?.server?.receivedAt}</div>
                  <div className="text-xs text-slate-400">IP de origem: {verifyResult.cert?.server?.ip}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* === ABA: FAQ === */}
      {tab === 'faq' && (
        <div className="space-y-3">
          {[
            { q: 'O carimbo na blockchain custa alguma coisa?', a: 'Não. O Prova Digital usa o protocolo OpenTimestamps, que é gratuito e de código aberto. O custo de ancorar na blockchain é compartilhado entre milhares de usuários em cada transação.' },
            { q: 'Por que o carimbo fica "pendente"?', a: 'A confirmação na blockchain do Bitcoin leva de algumas horas a um dia. Volte à aba Capturar e use a seção "Atualizar carimbo" para obter a prova final após esse período.' },
            { q: 'Meus arquivos ficam armazenados no servidor?', a: 'Não. Apenas o hash e os metadados são enviados ao servidor. O arquivo original nunca sai do seu dispositivo — o pacote .zip é gerado localmente no seu navegador.' },
            { q: 'Como verifico se o pacote não foi adulterado?', a: 'Recalcule o SHA-256 do arquivo de imagem e compare com o hash no certificado.json. Se baterem, o arquivo está intacto. O .ots pode ser verificado em opentimestamps.org.' },
            { q: 'Posso usar como prova em delegacia ou processo judicial?', a: 'Sim, como evidência técnica. O material gerado documenta a existência e integridade do conteúdo em determinada data. Para maior peso jurídico, combine com ata notarial ou laudo pericial.' },
            { q: 'Funciona no celular?', a: 'Sim. No celular a opção de câmera usa a câmera traseira do dispositivo. A opção de captura de tela pode ter limitações dependendo do navegador e sistema operacional.' },
          ].map(item => (
            <div key={item.q} className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-sm font-medium text-slate-900 mb-2">{item.q}</div>
              <div className="text-xs text-slate-500 leading-relaxed">{item.a}</div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
