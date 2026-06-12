// lib/utils.ts
// Funções auxiliares usadas pelo frontend para gerar hash, montar o pacote
// de evidência (.zip) e formatar dados.

/**
 * Calcula o hash SHA-256 de um Blob/File usando a Web Crypto API
 * (disponível nativamente no navegador, não precisa de libs externas).
 * Retorna o hash em hexadecimal (formato padrão usado por
 * OpenTimestamps, RFC 3161, etc.)
 */
export async function sha256Hex(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Converte uma string hex em Uint8Array (necessário para enviar o hash
 * "cru" para o backend, que vai usar o OpenTimestamps).
 */
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/** Coleta metadados do dispositivo/navegador disponíveis no cliente. */
export function getClientMetadata() {
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    platform:
      // navigator.platform está depreciado mas ainda é amplamente suportado
      (navigator as any).platform || 'desconhecido',
    screen: {
      width: window.screen.width,
      height: window.screen.height,
      pixelRatio: window.devicePixelRatio,
    },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    capturedAtClient: new Date().toISOString(),
  };
}

/** Pede a geolocalização do usuário (requer permissão explícita). */
export function getGeolocation(): Promise<{
  latitude: number;
  longitude: number;
  accuracy: number;
} | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}
