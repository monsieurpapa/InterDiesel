// Camera barcode / QR scanner shown inline (not in a popup). Uses the phone's
// built-in BarcodeDetector (Chrome on Android); on computers without it, a
// WebAssembly reader is downloaded the first time and kept for offline use.
// USB barcode scanners work without this: they type into the search field.
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from './state';
import { Icon } from './ui';

type Detector = { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };

async function makeDetector(): Promise<Detector> {
  const formats = ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code', 'itf'];
  const Native = (globalThis as any).BarcodeDetector;
  if (Native) {
    try {
      const supported: string[] = await Native.getSupportedFormats();
      return new Native({ formats: formats.filter((f) => supported.includes(f)) });
    } catch {}
  }
  const mod = await import('barcode-detector/ponyfill');
  const wasmUrl = (await import('zxing-wasm/reader/zxing_reader.wasm?url')).default;
  mod.prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) } });
  return new mod.BarcodeDetector({ formats: formats as any });
}

export function Scanner(props: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stop = false;
    let last = '';
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no_camera');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
        if (stop) return stream.getTracks().forEach((tr) => tr.stop());
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        const detector = await makeDetector();
        const loop = async () => {
          if (stop) return;
          try {
            const codes = await detector.detect(v);
            const code = codes[0]?.rawValue?.trim();
            if (code && code !== last) {
              last = code;
              navigator.vibrate?.(80);
              props.onCode(code);
              return;
            }
          } catch {}
          setTimeout(loop, 250);
        };
        loop();
      } catch (e) {
        setError((e as Error).name === 'NotAllowedError' ? t('scan.denied') : t('scan.unavailable'));
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  return (
    <div class="scanner stack" style={{ margin: '8px 0' }}>
      {error ? <div class="notice warn">{error}</div> : <video ref={video} playsInline muted />}
      <button class="btn block" onClick={props.onClose}>
        <Icon.x />
        {t('scan.stop')}
      </button>
    </div>
  );
}
