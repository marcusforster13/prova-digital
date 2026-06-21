'use client';

import { useRef, useState } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { sha256Hex, getClientMetadata, getGeolocation, formatBytes, blobToBase64, base64ToBlob } from '@/lib/utils';

type CertResult = { certificate: any; signature: string; ots: string | null; otsError: string | null; };
type Tab = 'capturar' | 'oque' | 'comousar' | 'juridico' | 'verificar' | 'faq';

export default function Home() {
  const [tab, setTab] = useState<Tab>('capturar');
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const otsInputRef = useRef<HTMLInputElement>(null);
  const verifyInputRef = useRef<HTMLInputElement>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [mode, setMode] = useState<'idle'|'screen'|'camera'>('idle');
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState('evidencia.png');
  const [exifData, setExifData] = useState<any>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [result, setResult] = useState<CertResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otsFileName, setOtsFileName] = useState<string | null>(null);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  const [upgradeResult, setUpgradeResult] = useState<any>(null);
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
    const video = videoRef.current; const canvas = canvasRef.current; if (!video || !canvas) return;
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
      const res = await fetch('/api/certify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hashHex, fileName, fileSize: blob.size, fileType: blob.type, clientMetadata: getClientMetadata(), geolocation: await getGeolocation(), exif: exifData }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `Erro ${res.status}`); }
      setResult(await res.json());
    } catch (err: any) { setError('Erro ao certificar: ' + err.message); } finally { setLoading(false); }
  }

  async function handleDownloadPackage() {
    if (!blob || !result) return;
    const zip = new JSZip();
    zip.file(fileName, blob);
    zip.file('certificado.json', JSON.stringify({ certificate: result.certificate, signature: result.signature }, null, 2));
    if (result.ots) zip.file(`${fileName}.ots`, Uint8Array.from(atob(result.ots), c => c.charCodeAt(0)));
    try {
      const { buildReportPdf } = await import('@/lib/pdf');
      zip.file('relatorio.pdf', buildReportPdf(result, fileName, hash));
    } catch {
      zip.file('relatorio.txt', `RELATÓRIO\nArquivo: ${fileName}\nHash: ${hash}\nServidor: ${result.certificate.server.receivedAt}\nIP: ${result.certificate.server.ip}`);
    }
    saveAs(await zip.generateAsync({ type: 'blob' }), `evidencia-${Date.now()}.zip`);
  }

  async function handleOtsFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setUpgradeError(null); setUpgradeResult(null); setOtsFileName(file.name); setUpgradeLoading(true);
    try {
      const res = await fetch('/api/upgrade', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ otsBase64: await blobToBase64(file) }) });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      setUpgradeResult(await res.json());
    } catch (err: any) { setUpgradeError('Erro: ' + err.message); } finally { setUpgradeLoading(false); e.target.value = ''; }
  }

  async function handleVerifyFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setVerifyError(null); setVerifyResult(null); setVerifyLoading(true);
    try {
      if (file.name.endsWith('.ots')) {
        const res = await fetch('/api/upgrade', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ otsBase64: await blobToBase64(file) }) });
        const data = await res.json();
        setVerifyResult({ type: 'ots', complete: data.complete, message: data.message });
      } else if (file.name.endsWith('.zip')) {
        const JSZipLib = await import('jszip');
        const zip = await JSZipLib.default.loadAsync(file);
        const certFile = zip.file('certificado.json');
        if (!certFile) throw new Error('certificado.json não encontrado no .zip');
        const cert = JSON.parse(await certFile.async('string'));
        const imgFile = cert.certificate?.file?.name ? zip.file(cert.certificate.file.name) : null;
        let hashMatch = null;
        if (imgFile) {
          const imgBytes = await imgFile.async('arraybuffer');
          const hex = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', imgBytes))).map(b => b.toString(16).padStart(2,'0')).join('');
          hashMatch = hex === cert.certificate?.hash;
        }
        setVerifyResult({ type: 'zip', cert: cert.certificate, signature: cert.signature, hashMatch });
      } else throw new Error('Envie um arquivo .zip ou .ots');
    } catch (err: any) { setVerifyError('Erro: ' + err.message); } finally { setVerifyLoading(false); e.target.value = ''; }
  }

  const tabs: {id: Tab; label: string}[] = [
    {id:'capturar',label:'Capturar'},{id:'oque',label:'O que é'},{id:'comousar',label:'Como usar'},
    {id:'juridico',label:'Validade jurídica'},{id:'verificar',label:'Verificar'},{id:'faq',label:'FAQ'},
  ];

  return (
    <div className="pd-wrap">
      <div className="pd-header">
        <div className="pd-logo">🛡</div>
        <div>
          <div className="pd-brand-name">Prova Digital</div>
          <div className="pd-brand-sub">Evidência Certificada</div>
        </div>
        <div className="pd-status">Sistema operacional</div>
      </div>

      <div className="pd-tabs">
        {tabs.map(t => (
          <button key={t.id} className={`pd-tab${tab===t.id?' active':''}`} onClick={()=>setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {/* CAPTURAR */}
      {tab==='capturar' && (
        <div>
          {error && <div className="pd-alert error"><div className="pd-alert-title">Erro</div>{error}</div>}

          {!blob && mode==='idle' && (
            <div className="pd-cap-grid">
              {[
                {icon:'🖥',title:'Print da tela',desc:'Compartilhe a aba ou monitor atual',action:startScreenCapture},
                {icon:'📷',title:'Foto ao vivo',desc:'Câmera do dispositivo em tempo real',action:startCamera},
                {icon:'📁',title:'Enviar arquivo',desc:'Imagem já existente no dispositivo',action:()=>fileInputRef.current?.click()},
              ].map(c=>(
                <button key={c.title} className="pd-cap-btn" onClick={c.action}>
                  <span className="pd-cap-icon">{c.icon}</span>
                  <div className="pd-cap-title">{c.title}</div>
                  <div className="pd-cap-desc">{c.desc}</div>
                </button>
              ))}
              <input ref={fileInputRef} type="file" accept="image/*" style={{display:'none'}} onChange={handleFileUpload}/>
            </div>
          )}

          {(mode==='screen'||mode==='camera') && !blob && (
            <div style={{marginBottom:'1.25rem'}}>
              <video ref={videoRef} style={{width:'100%',borderRadius:'14px',border:'1px solid var(--border)',background:'#000'}} muted playsInline/>
              <div style={{display:'flex',gap:'8px',marginTop:'12px'}}>
                <button className="pd-btn-primary" onClick={captureFrame}>Capturar agora</button>
                <button className="pd-btn-secondary" onClick={resetCapture}>Cancelar</button>
              </div>
            </div>
          )}

          <canvas ref={canvasRef} style={{display:'none'}}/>

          {blob && (
            <div>
              <img src={previewUrl??''} alt="Pré-visualização" className="pd-preview-img" style={{marginBottom:'6px'}}/>
              <div style={{fontSize:'11px',color:'var(--text3)',marginBottom:'1rem'}}>{fileName} · {formatBytes(blob.size)}</div>

              {!result && (
                <div style={{display:'flex',gap:'8px',marginBottom:'1rem'}}>
                  <button className="pd-btn-primary" onClick={handleCertify} disabled={loading}>
                    {loading ? '⏳ Certificando...' : '🛡 Gerar hash e certificar'}
                  </button>
                  <button className="pd-btn-secondary" onClick={resetCapture}>Recomeçar</button>
                </div>
              )}

              {hash && (
                <div className="pd-hash" style={{marginBottom:'1rem'}}>
                  <div className="pd-hash-label">Hash SHA-256</div>
                  <div className="pd-hash-value">{hash}</div>
                </div>
              )}

              {result && (
                <div className="pd-card" style={{marginBottom:'1rem'}}>
                  <div className="pd-card-head">
                    Certificado de autenticidade
                    <span className="pd-badge-ok" style={{marginLeft:'auto'}}>✓ Assinado</span>
                  </div>
                  <div className="pd-row">
                    <span className="pd-row-icon">🕐</span>
                    <div><div className="pd-row-label">Registrado pelo servidor em</div><div className="pd-row-value">{result.certificate.server.receivedAt}</div></div>
                  </div>
                  <div className="pd-row">
                    <span className="pd-row-icon">📍</span>
                    <div><div className="pd-row-label">IP de origem</div><div className="pd-row-value">{result.certificate.server.ip}</div></div>
                  </div>
                  <div className="pd-row">
                    <span className="pd-row-icon">₿</span>
                    <div>
                      <div className="pd-row-label">Carimbo OpenTimestamps</div>
                      <div className={`pd-row-value ${result.ots?'warn':''}`}>{result.ots?'Gerado — pendente de confirmação na blockchain':'Não disponível no momento'}</div>
                    </div>
                  </div>
                  <div className="pd-row">
                    <span className="pd-row-icon">🔐</span>
                    <div><div className="pd-row-label">Assinatura HMAC-SHA256</div><div className="pd-row-value ok">Certificado assinado e válido</div></div>
                  </div>
                  <div style={{padding:'12px 16px'}}>
                    <button className="pd-btn-primary pd-btn-full" onClick={handleDownloadPackage}>⬇ Baixar pacote de evidência (.zip)</button>
                  </div>
                </div>
              )}

              {result && <button style={{fontSize:'11px',color:'var(--text3)',textDecoration:'underline',background:'none',border:'none',cursor:'pointer'}} onClick={resetCapture}>Nova captura</button>}
            </div>
          )}

          <div className="pd-divider"><span>já tenho um certificado</span></div>

          <div className="pd-upgrade">
            <span className="pd-upgrade-icon">₿</span>
            <div style={{flex:1}}>
              <div className="pd-upgrade-title">Atualizar carimbo de tempo</div>
              <div className="pd-upgrade-sub">Envie o .ots para confirmar a prova na blockchain</div>
            </div>
            <button className="pd-upgrade-btn" onClick={()=>otsInputRef.current?.click()} disabled={upgradeLoading}>
              {upgradeLoading?'Verificando...':'Selecionar .ots'}
            </button>
            <input ref={otsInputRef} type="file" accept=".ots" style={{display:'none'}} onChange={handleOtsFileChange}/>
          </div>

          {upgradeError && <div className="pd-alert error" style={{marginTop:'8px'}}>{upgradeError}</div>}
          {upgradeResult && (
            <div className={`pd-alert ${upgradeResult.complete?'success':'warn'}`} style={{marginTop:'8px'}}>
              <div className="pd-alert-title">{upgradeResult.complete?'✅ Confirmado na blockchain':'⏳ Ainda pendente'}</div>
              <div>{upgradeResult.message}</div>
              <button className="pd-btn-secondary" style={{marginTop:'8px',fontSize:'11px',padding:'6px 12px'}} onClick={()=>upgradeResult&&otsFileName&&saveAs(base64ToBlob(upgradeResult.ots),otsFileName)}>Baixar .ots atualizado</button>
            </div>
          )}
        </div>
      )}

      {/* O QUE É */}
      {tab==='oque' && (
        <div>
          <div className="pd-hero">
            <span className="pd-hero-icon">🛡</span>
            <h2 className="pd-hero-title">O que é o Prova Digital?</h2>
            <p className="pd-hero-desc">Uma plataforma que transforma capturas de tela e fotos em evidências técnicas verificáveis — com hash criptográfico, carimbo de tempo na blockchain do Bitcoin e cadeia de custódia documentada.</p>
          </div>
          <div className="pd-pillars">
            {[
              {icon:'#',title:'Hash SHA-256',desc:'Impressão digital única do arquivo. Qualquer alteração mínima muda o hash completamente.'},
              {icon:'₿',title:'Blockchain Bitcoin',desc:'O hash é ancorado via OpenTimestamps. Prova permanente e verificável por qualquer pessoa.'},
              {icon:'🖥',title:'Servidor independente',desc:'IP, data e hora registrados no servidor — não no navegador do usuário.'},
            ].map(p=>(
              <div key={p.title} className="pd-pillar">
                <div className="pd-pillar-icon">{p.icon}</div>
                <div className="pd-pillar-title">{p.title}</div>
                <div className="pd-pillar-desc">{p.desc}</div>
              </div>
            ))}
          </div>
          <div className="pd-section-label">Conteúdo do pacote de evidência</div>
          <div className="pd-files">
            {[
              ['imagem original','O arquivo capturado, intacto e sem alterações'],
              ['certificado.json','Hash, IP, timestamp e assinatura HMAC'],
              ['relatorio.pdf','Relatório legível para anexar em denúncias'],
              ['arquivo.ots','Carimbo de tempo verificável na blockchain'],
            ].map(([n,d])=>(
              <div key={n} className="pd-file-row">
                <span className="pd-file-name">{n}</span>
                <span className="pd-file-desc">{d}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* COMO USAR */}
      {tab==='comousar' && (
        <div>
          <p style={{fontSize:'13px',color:'var(--text2)',marginBottom:'1.5rem',lineHeight:'1.7'}}>Siga os passos abaixo para gerar uma evidência certificada em menos de um minuto.</p>
          <div className="pd-steps">
            {[
              {n:1,title:'Escolha a origem',desc:'Selecione print da tela, câmera ao vivo ou envio de arquivo já existente.'},
              {n:2,title:'Capture ou confirme a imagem',desc:'Para print e câmera, pré-visualize e clique em "Capturar agora". Para arquivo, é carregado automaticamente.'},
              {n:3,title:'Clique em "Gerar hash e certificar"',desc:'O sistema calcula o SHA-256, coleta metadados, registra IP e data/hora no servidor e solicita o carimbo na blockchain.'},
              {n:4,title:'Baixe o pacote de evidência',desc:'Um .zip com imagem original, certificado.json, relatorio.pdf e o arquivo .ots da blockchain.'},
              {n:5,title:'Atualize o carimbo depois',desc:'Horas após a certificação, volte à aba Capturar e envie o .ots para confirmar a prova completa na blockchain do Bitcoin.'},
            ].map(s=>(
              <div key={s.n} className="pd-step">
                <div className="pd-step-num">{s.n}</div>
                <div className="pd-step-body">
                  <div className="pd-step-title">{s.title}</div>
                  <div className="pd-step-desc">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VALIDADE JURÍDICA */}
      {tab==='juridico' && (
        <div className="pd-juridico">
          <div className="pd-jcard ok">
            <div className="pd-jcard-title">✅ O que este sistema prova</div>
            <ul>{['Que o arquivo existia naquele exato momento (hash + timestamp)','Que não foi alterado após a certificação (hash imutável)','Origem aproximada via IP registrado pelo servidor','Metadados do dispositivo e geolocalização (se autorizada)','Carimbo de tempo verificável na blockchain do Bitcoin'].map(i=><li key={i}>{i}</li>)}</ul>
          </div>
          <div className="pd-jcard no">
            <div className="pd-jcard-title">❌ O que este sistema não prova</div>
            <ul>{['Autoria ou identidade de quem capturou (não há login obrigatório)','Que o conteúdo da imagem é verdadeiro (só prova que o arquivo existia)','Validade jurídica automática — depende do contexto e do juízo'].map(i=><li key={i}>{i}</li>)}</ul>
          </div>
          <div className="pd-jcard tip">
            <div className="pd-jcard-title">💡 Para uso em processos formais</div>
            <ul>{['Combine com ata notarial para maior peso jurídico','Guarde o pacote .zip intacto como cadeia de custódia','Consulte um advogado ou perito digital para seu caso específico'].map(i=><li key={i}>{i}</li>)}</ul>
          </div>
        </div>
      )}

      {/* VERIFICAR */}
      {tab==='verificar' && (
        <div>
          <p style={{fontSize:'13px',color:'var(--text2)',marginBottom:'1.25rem',lineHeight:'1.7'}}>Envie um pacote .zip gerado pelo Prova Digital ou um arquivo .ots para verificar sua autenticidade.</p>
          <div className="pd-drop" onClick={()=>verifyInputRef.current?.click()}>
            <div className="pd-drop-icon">🔍</div>
            <div className="pd-drop-title">Arraste o arquivo aqui ou clique para selecionar</div>
            <div className="pd-drop-sub">Aceita .zip (pacote completo) ou .ots (carimbo individual)</div>
          </div>
          <button className="pd-btn-primary pd-btn-full" onClick={()=>verifyInputRef.current?.click()} disabled={verifyLoading}>
            {verifyLoading?'⏳ Verificando...':'🔍 Selecionar arquivo para verificar'}
          </button>
          <input ref={verifyInputRef} type="file" accept=".zip,.ots" style={{display:'none'}} onChange={handleVerifyFile}/>
          {verifyError && <div className="pd-alert error" style={{marginTop:'12px'}}>{verifyError}</div>}
          {verifyResult && (
            <div className="pd-verify-result">
              <div className="pd-verify-head">Resultado da verificação</div>
              <div className="pd-verify-body">
                {verifyResult.type==='ots' && (
                  <div>
                    <div style={{fontSize:'13px',fontWeight:600,color:verifyResult.complete?'var(--green)':'var(--amber)',marginBottom:'6px'}}>{verifyResult.complete?'✅ Carimbo confirmado na blockchain':'⏳ Carimbo ainda pendente'}</div>
                    <div style={{fontSize:'11px',color:'var(--text3)'}}>{verifyResult.message}</div>
                  </div>
                )}
                {verifyResult.type==='zip' && (
                  <div>
                    <div style={{fontSize:'13px',fontWeight:600,color:verifyResult.hashMatch===true?'var(--green)':verifyResult.hashMatch===false?'var(--red)':'var(--text2)',marginBottom:'8px'}}>
                      {verifyResult.hashMatch===true?'✅ Hash verificado — arquivo íntegro':verifyResult.hashMatch===false?'❌ Hash não confere — arquivo pode ter sido alterado':'⚠️ Não foi possível verificar o hash'}
                    </div>
                    <div style={{fontSize:'11px',color:'var(--text3)',marginBottom:'4px'}}>Emitido em: {verifyResult.cert?.server?.receivedAt}</div>
                    <div style={{fontSize:'11px',color:'var(--text3)'}}>IP de origem: {verifyResult.cert?.server?.ip}</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* FAQ */}
      {tab==='faq' && (
        <div className="pd-faq">
          {[
            {q:'O carimbo na blockchain custa alguma coisa?',a:'Não. O Prova Digital usa o protocolo OpenTimestamps, gratuito e de código aberto. O custo é compartilhado entre milhares de usuários em cada transação.'},
            {q:'Por que o carimbo fica "pendente"?',a:'A confirmação na blockchain do Bitcoin leva algumas horas a um dia. Volte à aba Capturar e use a seção "Atualizar carimbo" para obter a prova final.'},
            {q:'Meus arquivos ficam armazenados no servidor?',a:'Não. Apenas o hash e os metadados são enviados ao servidor. O arquivo original nunca sai do seu dispositivo — o .zip é gerado localmente no navegador.'},
            {q:'Como verifico se o pacote não foi adulterado?',a:'Recalcule o SHA-256 da imagem e compare com o hash no certificado.json. Se baterem, o arquivo está intacto. O .ots pode ser verificado em opentimestamps.org.'},
            {q:'Posso usar como prova em delegacia ou processo judicial?',a:'Sim, como evidência técnica. Para maior peso jurídico, combine com ata notarial ou laudo pericial e consulte um advogado.'},
            {q:'Funciona no celular?',a:'Sim. No celular, a câmera usa a lente traseira. A captura de tela pode ter limitações dependendo do navegador e sistema operacional.'},
          ].map(item=>(
            <div key={item.q} className="pd-faq-item">
              <div className="pd-faq-q">{item.q}</div>
              <div className="pd-faq-a">{item.a}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
